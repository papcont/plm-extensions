// Fusion Manage condition repository. Fusion Manage is NOT a time-series DB — it stores only the
// business-relevant state: the current asset condition summary. Writes are gated by
// config.fusionManageWrites (default OFF). When off (dev/MVP) it records the intended writes in memory
// so the pipeline and UI work end to end without touching a tenant.
//
// When ON, the summary is written to the asset's "IoT" section (6 fields) via the v3 REST PATCH, using
// the same nested sections/fields shape routes/plm.js `/edit` builds — a raw flat PATCH fails with
// "Abschnitt null". An inbound uplink has no user session, so this authenticates 2-legged with the
// deployment's admin app (config.adminClientId/Secret). Discrete condition events stay dry-run (no
// events workspace is modeled yet — see fusion-manage-mapping.md).

const axios = require('axios');
const { createBearer } = require('./fmAuth');

// Fixed field ids on the Assets IoT section (created via the admin UI). Values map from the summary.
// PLM v3 rejects bare numbers for Float fields ("Invalid field value") — they must be sent as STRINGS,
// capped to the field's decimal precision (a string with MORE decimals than the field allows is also
// rejected). Integers accept a number. Condition/timestamps are strings. `kind` drives the formatting;
// float precision is config-driven so it matches each tenant field.
const FIELD = {
    IOT_CONDITION      : { title: 'IOT Condition',      kind: 'raw',      pick: s => s.condition },
    IOT_HEALTH_SCORE   : { title: 'IOT Health Score',   kind: 'int',      pick: s => s.healthScore },
    IOT_VIBRATION      : { title: 'IOT Vibration',      kind: 'float',    pick: s => s.vibration },
    IOT_TEMPERATURE    : { title: 'IOT Temperature',    kind: 'float',    pick: s => s.temperature },
    IOT_HUMIDITY       : { title: 'IOT Humidity',       kind: 'float',    pick: s => s.humidity },
    IOT_LAST_TELEMETRY : { title: 'IOT Last Telemetry', kind: 'datetime', pick: s => s.lastTelemetry },
    IOT_LAST_ALERT     : { title: 'IOT Last Alert',     kind: 'datetime', pick: s => s.lastEvent },
};

// ponytail: German locale / Berlin tz hardcoded (this tenant's profile: dateFormat dd.MM.yyyy,
// tz Europe/Berlin). Make configurable if a non-DE tenant ever uses this.
const DATE_FMT = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
function fmtDateDE(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;                        // not a date -> leave as-is
    const p = {};
    for (const part of DATE_FMT.formatToParts(d)) p[part.type] = part.value;
    return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}:${p.second}`;   // dd.MM.yyyy HH:mm:ss (24h)
}

// Format a summary value for its field kind. Float -> string capped to `decimals` (trailing zeros
// stripped), Integer -> rounded number, datetime -> German dd.MM.yyyy HH:mm:ss, raw -> passed through.
// null/undefined -> null (skipped).
function formatValue(kind, raw, decimals) {
    if (raw === undefined || raw === null) return null;
    if (kind === 'int')      return Math.round(Number(raw));
    if (kind === 'float')    return String(parseFloat(Number(raw).toFixed(decimals)));
    if (kind === 'datetime') return fmtDateDE(raw);
    return raw;
}

function decimalsForField(config, id) {
    const configured = config.floatDecimalsByField && config.floatDecimalsByField[id];
    return (configured == null) ? ((config.floatDecimals == null) ? 2 : config.floatDecimals) : Number(configured);
}

function createFusionManageRepository(config, logger = console, http = axios) {
    const summaries = new Map();   // assetId -> latest summary object
    const events = [];             // recorded condition events (newest last)
    const lastWriteAt = new Map(); // assetId -> ms of last live write (throttle)
    const lastWrittenSignature = new Map(); // assetId -> last business state sent to FM

    const bearer = createBearer(config, http);

    function liveConfigured() {
        return config.fusionManageWrites && config.adminClientId && config.adminClientSecret
            && config.tenantLink && config.assetWorkspaceId && config.conditionSectionId
            && config.impersonateUser;   // 2-legged writes must impersonate a real user
    }

    async function patchAsset(summary) {
        const prefix = '/api/v3/workspaces/' + config.assetWorkspaceId + '/items/' + summary.assetId;
        const sectionLink = prefix + '/views/1/sections/' + config.conditionSectionId;
        const fields = [];
        for (const [id, def] of Object.entries(FIELD)) {
            const value = formatValue(def.kind, def.pick(summary), decimalsForField(config, id));
            if (value === undefined || value === null) continue;   // don't clobber with blanks
            fields.push({ __self__: prefix + '/views/1/fields/' + id, title: def.title, value });
        }
        const body = { sections: [{ link: sectionLink, fields }] };
        await http.patch(config.tenantLink + prefix, body, {
            headers: {
                Authorization : 'Bearer ' + await bearer(),
                'X-user-id'   : config.impersonateUser,   // 2-legged apps write by impersonating this user
                Accept        : 'application/json',
                'Content-Type': 'application/json',
            },
        });
    }

    // Upsert the asset's current condition summary. Throttled: FM is not a time-series store.
    async function upsertConditionSummary(summary) {
        summaries.set(summary.assetId, summary);
        if (!config.fusionManageWrites) return { written: false, mode: 'dry-run', summary };
        if (!liveConfigured()) {
            logger.log(' IoT/FM: live writes enabled but mapping/creds not configured - skipping');
            return { written: false, mode: 'blocked-no-mapping', summary };
        }
        // Last telemetry changes on every uplink and must not turn Fusion Manage into a time-series
        // store. Compare the formatted business values instead, using the same precision as the PATCH.
        // The timestamp is still included whenever another value causes a real write.
        const signature = JSON.stringify(Object.entries(FIELD)
            .filter(([id]) => id !== 'IOT_LAST_TELEMETRY')
            .map(([id, def]) => [id, formatValue(def.kind, def.pick(summary), decimalsForField(config, id))]));
        if (lastWrittenSignature.get(summary.assetId) === signature) {
            return { written: false, mode: 'unchanged', summary };
        }
        const now = Date.now();
        const last = lastWriteAt.get(summary.assetId) || 0;
        if (now - last < (config.writeMinIntervalMs || 0)) return { written: false, mode: 'throttled', summary };
        try {
            await patchAsset(summary);
            lastWriteAt.set(summary.assetId, now);
            lastWrittenSignature.set(summary.assetId, signature);
            return { written: true, mode: 'live', summary };
        } catch (e) {
            // never break ingestion on a write error; surface it in the log
            const detail = e.response ? (e.response.status + ' ' + JSON.stringify(e.response.data).slice(0, 200)) : e.message;
            logger.log(' IoT/FM: asset condition write failed - ' + detail);
            return { written: false, mode: 'error', message: detail, summary };
        }
    }

    // Discrete condition events: no events workspace modeled yet -> record in memory only.
    async function recordConditionEvent(event) {
        events.push(event);
        return { written: false, mode: 'dry-run', event };
    }

    return {
        upsertConditionSummary,
        recordConditionEvent,
        getSummary : assetId => summaries.get(assetId) || null,
        getEvents  : assetId => events.filter(e => !assetId || e.assetId === assetId),
    };
}

module.exports = { createFusionManageRepository };
