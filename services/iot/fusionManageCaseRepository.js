// Fusion Manage Maintenance Case writer (Phase 2A-5B, Gate 2). Projects a local Maintenance Case onto
// Asset Services (ws 907) and — ONLY when gated ON — writes it. DRY-RUN is first-class: with the gate
// off, every op returns the exact projected FM mutation and performs ZERO HTTP calls.
//
// Gate: config.fusionManageCaseWrites (default false), INDEPENDENT from config.fusionManageWrites.
//
// Serialization is EVIDENCE-BASED (read-only GETs of live items, 2026-10-06):
//   - Float  -> string capped to precision            (proven: fusionManageRepository)
//   - Date   -> yyyy-MM-dd                             (proven: routes/plm.js getFieldValue 'date')
//   - single-select reference (ASSET) -> { link: '/api/v3/workspaces/904/items/<dmsId>' }
//   - static Pick List (SOURCE/PRIMARY_DRIVER/ASSESSMENT/AFFECTED_COMPONENT_TYPE)
//       -> { link: '/api/v3/lookups/<LOOKUP>/options/<id>' }   (NOT a plain string)
//   - text/paragraph -> raw; null/'' skipped (never clobber)
//
// Field links: CREATE uses WORKSPACE-level links ('/api/v3/workspaces/907/views/1/fields/<id>' and
// section '/api/v3/workspaces/907/sections/<id>'); PATCH uses ITEM-level links
// ('/api/v3/workspaces/907/items/<dmsId>/views/1/fields/<id>' and '.../views/1/sections/<id>') — matching
// the two proven code paths (routes/plm.js /create vs fusionManageRepository PATCH).
//
// Never infers diagnosis, never writes raw telemetry, never writes ID, never creates a Learning Case,
// never transitions the workflow except via the explicit transition() op (which Gate-2 only projects).

const C = require('./maintenanceCase');
const { ACTION_FAMILY, PREDICTIVE_SOURCE, FM_907_WORKSPACE_ID, ASSET_WORKSPACE_ID } = require('./fm907Mapping');
const { createFmTransport } = require('./fmTransport');

// Verified value -> lookup-option link maps (contelosuxdemo, read-only 2026-10-06). Tenant-specific option
// ids, so overridable via deps.pickListOptions. A pick-list value with no mapping is NEVER sent.
const PICKLIST_OPTIONS = Object.freeze({
    SOURCE: {
        CONDITION_EVENT: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_SOURCE/options/2',
        MANUAL_SERVICE:  '/api/v3/lookups/CUSTOM_LOOKUP_IOT_SOURCE/options/1',
    },
    PRIMARY_DRIVER: {
        vibration:   '/api/v3/lookups/CUSTOM_LOOKUP_IOT_DRIVER/options/2',
        temperature: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_DRIVER/options/1',
    },
    ASSESSMENT: {
        FALSE_POSITIVE:         '/api/v3/lookups/CUSTOM_LOOKUP_IOT_ASSESSMENT/options/1',
        CONFIRMED_ISSUE:        '/api/v3/lookups/CUSTOM_LOOKUP_IOT_ASSESSMENT/options/2',
        UNKNOWN:                '/api/v3/lookups/CUSTOM_LOOKUP_IOT_ASSESSMENT/options/3',
        OPERATING_STATE_CHANGE: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_ASSESSMENT/options/4',
    },
    AFFECTED_COMPONENT_TYPE: {
        MOTOR:   '/api/v3/lookups/CUSTOM_LOOKUP_IOT_COMPONENT_TYPE/options/1',
        SENSOR:  '/api/v3/lookups/CUSTOM_LOOKUP_IOT_COMPONENT_TYPE/options/2',
        CONTROL: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_COMPONENT_TYPE/options/3',
        ITEM:    '/api/v3/lookups/CUSTOM_LOOKUP_IOT_COMPONENT_TYPE/options/4',
    },
    // URGENCY is a REUSED 907 pick list that is MANDATORY on create. Its lookup
    // (CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY) and option ids are tenant-specific and NOT hard-coded here:
    // inject the verified logical-value -> option-link map via config.urgencyOptions AFTER a read-only
    // live inspection of that lookup. Empty default = unresolved => any URGENCY value is UNMAPPED and a
    // live create is blocked (never guess the option id, never derive urgency from anomalyScore).
    URGENCY: {},
});
const PICKLIST_FIELDS = new Set(Object.keys(PICKLIST_OPTIONS));
const CHECKBOX_FIELDS = new Set(['TELEMETRY_IMPROVED', 'MAINTENANCE_PERFORMED', 'REPAIR_PERFORMED', 'INSPECTION_PERFORMED', 'CALIBRATION_PERFORMED', 'MODIFICATION_PERFORMED']);

// Maintenance-case float fields carry their OWN precision, independent of the global config.floatDecimals
// (a summary-writer setting a deployment may run at 1). The 907 anomaly fields are precision-2, so keep
// them at 2 even under floatDecimals=1 — otherwise 0.91 would write as "0.9". Overridable per field via
// config.caseFloatDecimalsByField. This NEVER touches the summary writer (fusionManageRepository).
const CASE_FLOAT_DECIMALS = Object.freeze({ ANOMALY_AT_DETECTION: 2, ANOMALY_AFTER: 2 });

function floatStr(v, decimals) { return String(parseFloat(Number(v).toFixed(decimals))); }
function dateYMD(iso) {
    if (iso == null || iso === '') return null;
    const d = new Date(iso); if (isNaN(d)) return null;
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}
function put(fields, id, value) { if (value !== null && value !== undefined && value !== '') fields[id] = value; }

function createFusionManageCaseRepository(config = {}, deps = {}) {
    const logger = deps.logger || console;
    const now = deps.now || (() => new Date().toISOString());
    const decimals = (config.floatDecimals == null) ? 2 : Number(config.floatDecimals);
    const caseFloatBy = Object.assign({}, CASE_FLOAT_DECIMALS, config.caseFloatDecimalsByField || {});
    const decimalsFor = id => (caseFloatBy[id] != null ? Number(caseFloatBy[id]) : decimals);
    const caseWsId = String(config.caseWorkspaceId || FM_907_WORKSPACE_ID);
    const assetWsId = String(config.assetWorkspaceId || ASSET_WORKSPACE_ID);
    // URGENCY option ids are tenant-specific + unverified in source: they come from config.urgencyOptions
    // (set after a read-only live lookup inspection), never hard-coded. Other pick lists keep their defaults.
    const pickOptions = Object.assign({}, deps.pickListOptions || PICKLIST_OPTIONS,
        config.urgencyOptions ? { URGENCY: config.urgencyOptions } : {});

    // Lazy: build the real auth-capable transport only when a live write actually runs. Never in dry-run.
    let _transport = deps.transport || null;
    function transport() { if (!_transport) _transport = createFmTransport(config); return _transport; }

    const resolveAssetRef = deps.resolveAssetRef || function (assetId) {
        return /^\d+$/.test(String(assetId || '')) ? { link: '/api/v3/workspaces/' + assetWsId + '/items/' + String(assetId) } : null;
    };
    const searchByConditionEventId = deps.searchByConditionEventId || null;

    function gateOn() { return config.fusionManageCaseWrites === true; }
    function result(operation, extra) {
        return Object.assign({ ok: true, dryRun: !gateOn(), operation, workspaceId: caseWsId, fmDmsId: null, projectedFields: {}, error: null }, extra);
    }

    // ---- PROJECTIONS (pure; logical values for human review; no HTTP) ----------------------------
    function projectCreate(kase) {
        const assetRef = resolveAssetRef(kase.assetId);
        const fields = {};
        put(fields, 'SOURCE', PREDICTIVE_SOURCE);
        put(fields, 'CONDITION_EVENT_ID', kase.conditionEventId);
        if (kase.anomalyAtDetection != null) put(fields, 'ANOMALY_AT_DETECTION', floatStr(kase.anomalyAtDetection, decimalsFor('ANOMALY_AT_DETECTION')));
        put(fields, 'PRIMARY_DRIVER', kase.primaryDriver);
        put(fields, 'URGENCY', config.caseDefaultUrgency);   // mandatory on 907 create; configurable, never anomaly-derived
        const references = {};
        if (assetRef) references.ASSET = assetRef;
        return { fields, references, assetResolved: !!assetRef };
    }
    function projectFinding(kase) {
        const fields = {};
        put(fields, 'ASSESSMENT', kase.assessment);
        if (kase.assessment === C.ASSESSMENT.CONFIRMED_ISSUE) put(fields, 'CONFIRMED_CAUSE', kase.confirmedCause);
        const comp = kase.affectedComponent || {};
        put(fields, 'AFFECTED_COMPONENT_TYPE', comp.type);
        put(fields, 'AFFECTED_COMPONENT_ID', comp.id || comp.label);
        return { fields };
    }
    function projectAction(kase) {
        const a = kase.action || {};
        const fields = {}; let unmapped = false;
        const fam = a.type ? ACTION_FAMILY[String(a.type).toUpperCase()] : null;
        if (fam) { fields[fam.performed] = true; put(fields, fam.comments, a.description); }
        else if (a.type || a.description) { unmapped = true; put(fields, 'REMARKS', (a.type ? ('[' + a.type + '] ') : '') + (a.description || '')); }
        put(fields, 'COMPLETED_BY', a.performedBy);
        put(fields, 'COMPLETION_DATE', dateYMD(a.performedAt));
        return { fields, unmapped };
    }
    function projectOutcome(kase) {
        const o = kase.outcome || {};
        const fields = {};
        if (o.telemetryImproved != null) fields.TELEMETRY_IMPROVED = !!o.telemetryImproved;
        if (o.anomalyAfter != null) put(fields, 'ANOMALY_AFTER', floatStr(o.anomalyAfter, decimalsFor('ANOMALY_AFTER')));
        return { fields };
    }

    // ---- WIRE serialization (logical projected value -> FM v3 value) -----------------------------
    // Throws on an unmappable pick-list value so a bad option is never written.
    function toWireValue(id, value, references) {
        if (references && references[id] !== undefined) return references[id];       // ASSET reference { link }
        if (PICKLIST_FIELDS.has(id)) {
            const link = (pickOptions[id] || {})[value];
            if (!link) throw new Error('UNMAPPED_PICKLIST_VALUE ' + id + '=' + value);
            return { link };
        }
        if (CHECKBOX_FIELDS.has(id)) return value === true || value === 'true';       // ponytail: boolean; confirm at first finding/outcome write
        return value;                                                                // text / float-string / date / paragraph
    }
    // A field is grouped under its REAL section (matching the proven /create route): reused 907 fields
    // (e.g. ASSET lives in Header) keep their section; the new IoT fields default to
    // caseSectionId ("Condition / IoT"). config.reusedFieldSections maps reused fieldId -> section id.
    function sectionOf(id, fallback) { return (config.reusedFieldSections && config.reusedFieldSections[id]) || fallback; }
    // Group projected fields by real section, build { sections:[{link, fields:[{__self__, value}]}] }.
    // linkBase builds the field __self__ (workspace-level for create, item-level for patch); sectionLink
    // builds the section container link.
    function groupBody(projection, defaultSectionId, linkBase, sectionLink) {
        const bySection = {};
        const add = (id, raw) => {
            const sid = sectionOf(id, defaultSectionId);
            (bySection[sid] = bySection[sid] || []).push({ __self__: linkBase + '/views/1/fields/' + id, value: toWireValue(id, raw, projection.references) });
        };
        for (const [id, raw] of Object.entries(projection.fields)) add(id, raw);
        for (const id of Object.keys(projection.references || {})) if (!(id in projection.fields)) add(id, undefined);
        return { sections: Object.entries(bySection).map(([sid, fields]) => ({ link: sectionLink(sid), fields })) };
    }
    // CREATE: workspace-level field links (item does not exist yet).
    function createBody(projection, sectionId) {
        const wsBase = '/api/v3/workspaces/' + caseWsId;
        return groupBody(projection, sectionId, wsBase, sid => wsBase + '/sections/' + sid);
    }
    // PATCH: item-level links (matches the proven summary PATCH).
    function patchBody(dmsId, projection, sectionId) {
        const itemBase = '/api/v3/workspaces/' + caseWsId + '/items/' + dmsId;
        return groupBody(projection, sectionId, itemBase, sid => itemBase + '/views/1/sections/' + sid);
    }

    function writeHeaders() { return { 'X-user-id': config.impersonateUser, Accept: 'application/json', 'Content-Type': 'application/json' }; }
    function fmtErr(e) { return e && e.response ? (e.response.status + ' ' + JSON.stringify(e.response.data).slice(0, 200)) : (e && e.message) || 'error'; }
    function setSync(kase, patch) { const s = Object.assign({ fmWorkspaceId: caseWsId, fmDmsId: null, fmItemUrl: null, lastSyncedAt: null, syncStatus: 'NONE', syncError: null }, kase.sync || {}, patch); if (kase) kase.sync = s; return s; }

    // LIVE_CREATE preconditions (strict; no auto-retry). Returns null if allowed, else a reason string.
    function liveCreateBlocker(kase, projection) {
        if (!gateOn()) return 'GATE_OFF';
        if (kase.sync && kase.sync.fmDmsId) return 'ALREADY_CREATED';
        if (!kase.conditionEventId) return 'NO_CONDITION_EVENT_ID';
        if (!projection.assetResolved) return 'UNRESOLVED_ASSET';
        if (!config.caseSectionId) return 'NO_SECTION_ID';
        try { createBody(projection, config.caseSectionId); } catch (e) { return e.message; }   // proves every PROJECTED pick-list value (incl. a configured URGENCY) maps
        if (!config.caseDefaultUrgency) return 'NO_URGENCY';                                     // 907 requires URGENCY; it is not projected when unset, so check presence explicitly
        return null;
    }

    // ---- PUBLIC API ------------------------------------------------------------------------------
    async function create(kase) {
        const p = projectCreate(kase);
        const res = result('create', { projectedFields: p.fields, references: p.references, retry: false });
        if (!p.assetResolved) { res.ok = false; res.error = 'UNRESOLVED_ASSET'; return res; }
        if (!gateOn()) return res;                                                   // DRY-RUN: zero HTTP

        if (kase.sync && kase.sync.fmDmsId) { res.fmDmsId = kase.sync.fmDmsId; res.reason = 'already-created'; return res; }

        if (searchByConditionEventId) {
            let matches;
            try { matches = await searchByConditionEventId(kase.conditionEventId); }
            catch (e) { res.ok = false; res.error = 'RECONCILE_FAILED: ' + (e.message || e); setSync(kase, { syncStatus: 'ERROR', syncError: res.error }); return res; }
            if (Array.isArray(matches) && matches.length > 1) { res.ok = false; res.error = 'ERROR_DUPLICATE_BUSINESS_KEY'; return res; }
            if (Array.isArray(matches) && matches.length === 1) { res.fmDmsId = matches[0]; res.reason = 'reconciled'; setSync(kase, { fmDmsId: matches[0], syncStatus: 'SYNCED', lastSyncedAt: now(), syncError: null }); return res; }
        } else {
            res.reconcile = 'RECONCILE_PATH_UNAVAILABLE';
        }

        const blocker = liveCreateBlocker(kase, p);
        if (blocker) { res.ok = false; res.error = 'LIVE_CREATE_BLOCKED: ' + blocker; return res; }

        // Single attempt. No automatic retry: an ambiguous POST must be reconciled read-only, not re-sent,
        // while the custom-field search path is unresolved (would risk a duplicate case).
        try {
            const loc = await transport().create(config.tenantLink + '/api/v3/workspaces/' + caseWsId + '/items', createBody(p, config.caseSectionId), writeHeaders());
            res.fmDmsId = (loc || '').split('/').pop() || null;
            setSync(kase, { fmDmsId: res.fmDmsId, fmItemUrl: loc, syncStatus: 'SYNCED', lastSyncedAt: now(), syncError: null });
        } catch (e) { res.ok = false; res.error = fmtErr(e); setSync(kase, { syncStatus: 'ERROR', syncError: res.error }); }
        return res;
    }

    function patchOp(operation, kase, projection) {
        const res = result(operation, { projectedFields: projection.fields });
        if (projection.unmapped) res.unmapped = true;
        if (!gateOn()) return Promise.resolve(res);
        const dmsId = kase.sync && kase.sync.fmDmsId;
        if (!dmsId) { res.ok = false; res.error = 'NO_FM_ITEM'; return Promise.resolve(res); }
        if (!config.caseSectionId) { res.ok = false; res.error = 'NO_SECTION_ID'; return Promise.resolve(res); }
        res.fmDmsId = dmsId;
        return (async () => {
            try {
                await transport().patch(config.tenantLink + '/api/v3/workspaces/' + caseWsId + '/items/' + dmsId, patchBody(dmsId, projection, config.caseSectionId), writeHeaders());
                setSync(kase, { syncStatus: 'SYNCED', lastSyncedAt: now(), syncError: null });
            } catch (e) { res.ok = false; res.error = fmtErr(e); setSync(kase, { syncStatus: 'ERROR', syncError: res.error }); }
            return res;
        })();
    }
    function updateFinding(kase) { return patchOp('updateFinding', kase, projectFinding(kase)); }
    function updateAction(kase)  { return patchOp('updateAction',  kase, projectAction(kase)); }
    function updateOutcome(kase) { return patchOp('updateOutcome', kase, projectOutcome(kase)); }

    async function transition(kase, targetState) {
        if (!C.STATE[targetState]) return { ok: false, operation: 'transition', error: 'UNKNOWN_STATE', dryRun: !gateOn() };
        const fmState = C.FM_907_STATE[targetState];
        const res = result('transition', { targetState, fmState, projectedFields: {} });
        const sync = kase && kase.sync;
        if (gateOn() && sync && sync.fmDmsId && typeof deps.readFmState === 'function') {
            let current;
            try { current = await deps.readFmState(sync.fmDmsId); } catch (e) { res.ok = false; res.error = fmtErr(e); return res; }
            res.currentFmState = current;
            if (current === fmState) { res.idempotent = true; return res; }
            res.wouldTransition = true;
        }
        res.note = 'transition projected only (Gate-2 performs no real workflow transition)';
        return res;
    }

    return {
        create, updateFinding, updateAction, updateOutcome, transition,
        projectCreate, projectFinding, projectAction, projectOutcome,
        // exposed for review/tests:
        createBody, patchBody, PICKLIST_OPTIONS: pickOptions,
    };
}

module.exports = { createFusionManageCaseRepository, PICKLIST_OPTIONS };
