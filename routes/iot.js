// IoT / Condition Monitoring HTTP surface. Self-contained: serves simulated telemetry, health and
// condition from the shared IoT runtime. No PLM/APS auth required (no tenant data, no secrets in
// responses). Ticking is client-driven (the dashboard polls /tick). The TTS uplink endpoint is the
// same door the future SenseCAP -> The Things Stack webhook will use.

const express = require('express');
const router  = express.Router();
const service = require('../services/iot/service');
const iotConfig = require('../services/iot/config');
const { createFusionManageReadRepository } = require('../services/iot/fusionManageReadRepository');
const { buildContext } = require('../services/iot/ai/contextBuilder');
const { createAiService } = require('../services/iot/ai/aiService');
const { cleanMessage, cleanHistory, createRateLimiter } = require('../services/ai/chat');
const chatAllowed = createRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });   // unauthenticated + paid: bound it per client
const anthropic = require('../services/iot/ai/providers/anthropic');
const { createFusionManageCaseRepository } = require('../services/iot/fusionManageCaseRepository');
const { createFusionManageCaseSearch } = require('../services/iot/fusionManageCaseSearch');
const { createMaintenanceCaseFlow, CONFIRM: CASE_CONFIRM } = require('../services/iot/maintenanceCaseFlow');
let fmReadRepository;
let aiService;
let caseFlow;

// Controlled demo mapping. Keep the reader GET-only; generalize to CONDITION_EVENT_ID lookup later.
const DEMO_CASE_BY_ASSET = Object.freeze({ '30057': { workspaceId: '907', dmsId: '33979' } });
// /iot/asset reads with privileged 2-legged creds, so it is an allowlist, never a generic FM read proxy.
const DEMO_ASSETS = Object.freeze({ '904': ['30057'] });

function findField(details, fieldId) {
    for (const section of (details && details.sections) || []) {
        for (const field of section.fields || []) {
            if ((field.__self__ || '').endsWith('/fields/' + fieldId)) return field;
        }
    }
    return null;
}

function fieldValue(details, fieldId) {
    const field = findField(details, fieldId);
    if (!field || field.value == null) return null;
    if (typeof field.value !== 'object') return String(field.value);
    return field.value.title || field.value.name || field.value.descriptor || null;
}

// Reference to a linked record (e.g. SENSORS_LIST -> Sensors 968) so the UI can open it in Fusion Manage.
// Only the API link and its title leave the server, never the linked record's content.
function fieldRecordLink(details, fieldId) {
    const field = findField(details, fieldId);
    const value = field && field.value;
    const link = value && typeof value === 'object' ? String(value.link || '') : '';
    return /^\/api\/v3\/workspaces\/\d+\/items\/\d+$/.test(link) ? { link, title: value.title || null } : null;
}

function stateValue(details) {
    const state = details && (details.currentState || details.workflowState
        || (details.workflow && details.workflow.currentState));
    if (!state) return null;
    return typeof state === 'object' ? (state.title || state.name || null) : String(state);
}

function getFmReadRepository() {
    if (!fmReadRepository) fmReadRepository = createFusionManageReadRepository(iotConfig);
    return fmReadRepository;
}

function itemUrl(req, workspaceId, dmsId) {
    const tenant = String(req.app.locals.tenant || '').toUpperCase();
    const urn = 'urn`adsk,plm`tenant,workspace,item`' + tenant + ',' + workspaceId + ',' + dmsId;
    return req.app.locals.tenantLink + '/plm/workspaces/' + workspaceId + '/items/itemDetails'
        + '?view=full&tab=detail&mode=view&itemId=' + encodeURIComponent(urn);
}

function sanitizeCase(req, details, workspaceId, dmsId) {
    return {
        workspaceId,
        dmsId,
        itemUrl: itemUrl(req, workspaceId, dmsId),
        caseId: fieldValue(details, 'ID'),
        source: fieldValue(details, 'SOURCE'),
        workflow: stateValue(details),
        urgency: fieldValue(details, 'URGENCY'),
        assessment: fieldValue(details, 'ASSESSMENT'),
        confirmedCause: fieldValue(details, 'CONFIRMED_CAUSE'),
        anomalyAtDetection: fieldValue(details, 'ANOMALY_AT_DETECTION'),
        primaryDriver: fieldValue(details, 'PRIMARY_DRIVER'),
        conditionEventId: fieldValue(details, 'CONDITION_EVENT_ID'),
    };
}

function sanitizeAsset(details, workspaceId, dmsId) {
    return {
        workspaceId,
        dmsId,
        id: fieldValue(details, 'ID') || String(dmsId),
        title: details && details.title || fieldValue(details, 'TITLE'),
        description: fieldValue(details, 'DESCRIPTION'),
        customer: fieldValue(details, 'CUSTOMER'),
        operational: fieldValue(details, 'IS_OPERATIONAL'),
        sensor: fieldRecordLink(details, 'SENSORS_LIST'),
    };
}

function getAiService() {
    if (!aiService) {
        // ponytail: one provider today; add a providers/<name>.js + this switch when a second is needed.
        if (iotConfig.ai.provider !== 'anthropic') throw new Error('AI_PROVIDER_UNKNOWN');
        const provider = anthropic.createAnthropicProvider(iotConfig.ai);
        aiService = createAiService({ config: iotConfig.ai, provider });
    }
    return aiService;
}

// Operator-gated Maintenance Case flow (preview + create). Built lazily from the shared runtime's durable
// event store/link store, the FM read repository (asset title, business-key search) and the AI service's
// last results (supporting context only). FM write gate: iotConfig.fusionManageCaseWrites (default false).
function getCaseFlow() {
    if (!caseFlow) {
        const rt = service.getShared();
        const search = createFusionManageCaseSearch(iotConfig);
        caseFlow = createMaintenanceCaseFlow({
            config: iotConfig, events: rt.events, linkStore: rt.caseLinks, caseRepo: rt.cases,
            fmCaseRepo: createFusionManageCaseRepository(iotConfig),
            getState: id => rt.getState(id),
            readAsset: async id => sanitizeAsset(await getFmReadRepository().getItem(iotConfig.assetWorkspaceId || '904', id), iotConfig.assetWorkspaceId || '904', id),
            searchByEventId: search.configured() ? search.searchByConditionEventId : null,
            lastInsight: (mode, assetId) => (aiService ? aiService.lastInsight(mode, assetId) : null),
        });
    }
    return caseFlow;
}

function readErrorStatus(error) {
    return error && error.message === 'FM_READ_NOT_CONFIGURED' ? 503 : 502;
}

// Non-secret config the UI needs to render bands/labels. Never expose ingestion URLs/keys.
router.get('/config', function(req, res) {
    const rt = service.getShared();
    res.json({ success: true, data: {
        deviceId          : rt.deviceId,
        monitoredAssets   : DEMO_ASSETS,
        source            : rt.config.source,
        tandemEnabled     : rt.config.tandemEnabled,
        telemetryPersistenceEnabled: rt.config.telemetryPersistenceEnabled,
        fusionManageWrites: rt.config.fusionManageWrites,
        thresholds        : rt.config.thresholds,
        conditionBands    : rt.config.conditionBands,
        analytics         : rt.config.analytics ? {
            enabled          : rt.config.analytics.enabled,
            minimumSamples   : rt.config.analytics.minimumSamples,
            observeThreshold : rt.config.analytics.observeThreshold,
            warningThreshold : rt.config.analytics.warningThreshold,
            criticalThreshold: rt.config.analytics.criticalThreshold,
        } : null,
        aiCredentialConfigured: anthropic.hasAnthropicCredential(),
    }});
});

// Advance one simulated sample through the full pipeline.
router.post('/tick', async function(req, res) {
    try {
        const r = await service.getShared().tick();
        res.json({ success: true, data: r });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// Current asset condition summary + recent condition events. Pass ?assetId=<id> to read a specific
// asset (the live-sensor dashboard mode); omit for the simulator's demo asset.
router.get('/state', function(req, res) {
    res.json({ success: true, data: service.getShared().getState(req.query.assetId || null) });
});

// Trusted server-side FM reads. The browser receives only sanitized business data.
router.get('/asset', async function(req, res) {
    const workspaceId = String(req.query.wsId || '');
    const dmsId = String(req.query.assetId || '');
    if (!workspaceId || !dmsId) return res.status(400).json({ success: false, message: 'Asset context required' });
    if (!(DEMO_ASSETS[workspaceId] || []).includes(dmsId)) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    try {
        const details = await getFmReadRepository().getItem(workspaceId, dmsId);
        res.json({ success: true, data: sanitizeAsset(details, workspaceId, dmsId) });
    } catch (error) {
        res.status(readErrorStatus(error)).json({ success: false, message: 'Asset could not be read' });
    }
});

// Parts of the asset's Service BOM (SERVICE_BOM) so the dashboard can hand a part to Intelligent Sourcing.
// Same allowlist as /asset; only title + record ids leave the server.
router.get('/asset-parts', async function(req, res) {
    const workspaceId = String(req.query.wsId || iotConfig.assetWorkspaceId || '904');
    const dmsId = String(req.query.assetId || '');
    if (!(DEMO_ASSETS[workspaceId] || []).includes(dmsId)) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    try {
        const repo = getFmReadRepository();
        const bom = fieldRecordLink(await repo.getItem(workspaceId, dmsId), 'SERVICE_BOM');
        const m = bom && bom.link.match(/workspaces\/(\d+)\/items\/(\d+)$/);
        if (!m) return res.json({ success: true, data: { bom: null, parts: [] } });
        const parts = (await repo.getBomChildren(m[1], m[2])).map(i => {
            const p = String(i.link || '').match(/workspaces\/(\d+)\/items\/(\d+)$/);
            return p && { workspaceId: p[1], dmsId: p[2], title: i.title || '', url: itemUrl(req, p[1], p[2]) };
        }).filter(Boolean);
        res.json({ success: true, data: { bom: { workspaceId: m[1], dmsId: m[2], title: bom.title }, parts } });
    } catch (error) {
        res.status(readErrorStatus(error)).json({ success: false, message: 'Asset parts could not be read' });
    }
});

// A case created from a real durable event (link store) outranks the static demo mapping.
router.get('/maintenance-case', async function(req, res) {
    const assetId = String(req.query.assetId || '');
    const link = assetId ? service.getShared().caseLinks.latestForAsset(assetId) : null;
    const ref = link ? { workspaceId: String(link.fmWorkspaceId || iotConfig.caseWorkspaceId || '907'), dmsId: String(link.fmDmsId) } : DEMO_CASE_BY_ASSET[assetId];
    if (!ref) return res.status(404).json({ success: false, message: 'No maintenance case mapping for asset' });
    try {
        const details = await getFmReadRepository().getItem(ref.workspaceId, ref.dmsId);
        res.json({ success: true, data: Object.assign(sanitizeCase(req, details, ref.workspaceId, ref.dmsId), { linkedConditionEventId: link ? link.eventId : null }) });
    } catch (error) {
        res.status(readErrorStatus(error)).json({ success: false, message: 'Maintenance Case could not be read' });
    }
});

// Non-mutating preview of the case the operator is about to create from a durable ESCALATION event.
router.get('/maintenance-case/preview', async function(req, res) {
    const assetId = String(req.query.assetId || ''), eventId = String(req.query.eventId || '');
    if (!Object.keys(DEMO_ASSETS).some(ws => DEMO_ASSETS[ws].includes(assetId))) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    try {
        const r = await getCaseFlow().preview({ assetId, eventId });
        if (r.error) return res.status(r.status || 400).json({ success: false, message: r.error });
        res.json({ success: true, data: r });
    } catch (error) {
        console.log(' /iot/maintenance-case/preview failed: ' + (error && error.message));
        res.status(502).json({ success: false, message: 'Preview could not be generated' });
    }
});

// The ONLY mutating path: exact body { assetId, eventId, confirm: 'CREATE_MAINTENANCE_CASE' }, allowlisted
// asset, gate ON, no existing case for the event. The server rebuilds every field from its own stores;
// nothing from the browser reaches Fusion Manage.
router.post('/maintenance-case/create', async function(req, res) {
    const b = req.body;
    if (!b || typeof b !== 'object' || Object.keys(b).sort().join() !== 'assetId,confirm,eventId'
        || [b.assetId, b.eventId, b.confirm].some(v => typeof v !== 'string')) {
        return res.status(400).json({ success: false, message: 'Body must be exactly { assetId, eventId, confirm }' });
    }
    if (!Object.keys(DEMO_ASSETS).some(ws => DEMO_ASSETS[ws].includes(b.assetId))) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    if (b.confirm !== CASE_CONFIRM) return res.status(400).json({ success: false, message: 'Explicit confirmation required' });
    try {
        const r = await getCaseFlow().create({ assetId: b.assetId, eventId: b.eventId, confirm: b.confirm });
        if (r.error) return res.status(r.status || 400).json(Object.assign({ success: false, message: r.error }, r.writeEnabled === false ? { writeEnabled: false } : {}));
        res.json({ success: true, data: r });
    } catch (error) {
        console.log(' /iot/maintenance-case/create failed: ' + (error && error.message));
        res.status(502).json({ success: false, message: 'Maintenance case could not be created' });
    }
});

// The ONLY data the model sees for an asset: server-side sanitized reads, never anything from the browser.
async function buildAiContext(req, workspaceId, dmsId) {
    const caseRef = DEMO_CASE_BY_ASSET[dmsId];
    const repo = getFmReadRepository();
    const [assetDetails, caseDetails] = await Promise.all([
        repo.getItem(workspaceId, dmsId),
        caseRef ? repo.getItem(caseRef.workspaceId, caseRef.dmsId) : null,
    ]);
    return buildContext({
        state: service.getShared().getState(dmsId),
        asset: sanitizeAsset(assetDetails, workspaceId, dmsId),
        kase: caseDetails ? sanitizeCase(req, caseDetails, caseRef.workspaceId, caseRef.dmsId) : null,
    });
}

// AI Insight, read-only. The server builds the context from its own sanitized reads; nothing from the
// browser goes into the prompt except the allowlisted asset id. One handler per mode, same guards.
function aiRoute(mode) {
    return async function(req, res) {
        const body = req.body;
        if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'assetId' || typeof body.assetId !== 'string') {
            return res.status(400).json({ success: false, message: 'Body must be exactly { assetId }' });
        }
        const dmsId = body.assetId;
        const workspaceId = Object.keys(DEMO_ASSETS).find(ws => DEMO_ASSETS[ws].includes(dmsId));
        if (!workspaceId) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
        if (!iotConfig.ai.enabled) return res.status(503).json({ success: false, message: 'AI Insight is disabled' });
        if (iotConfig.ai.provider === 'anthropic' && !anthropic.hasAnthropicCredential()) {
            return res.status(503).json({ success: false, message: 'AI credential is not configured' });
        }
        try {
            const context = await buildAiContext(req, workspaceId, dmsId);
            const r = await getAiService().run(mode, context);
            // Provenance for the UI (live vs cached, which model). Never the key, never the context.
            res.json({ success: true, data: { mode, insight: r.insight, cached: r.cached, latencyMs: r.latencyMs,
                provider: iotConfig.ai.provider, model: iotConfig.ai.model } });
        } catch (error) {
            console.log(' /iot/ai (' + mode + ') failed: ' + (error && (error.status || '') + ' ' + error.message));
            res.status(502).json({ success: false, message: 'AI Insight could not be generated' });
        }
    };
}
router.post('/ai/explain', aiRoute('explain_asset_state'));
router.post('/ai/technician-briefing', aiRoute('technician_briefing'));

// Free-text chat about one asset. Body: exactly { assetId, message, history? }. Same context as the other modes; message and
// history are sanitized and reach the model only as untrusted DATA inside it. Read-only, no tools, rate limited per client.
router.post('/ai/chat', async function(req, res) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).every(k => ['assetId', 'message', 'history'].includes(k)) || typeof body.assetId !== 'string') {
        return res.status(400).json({ success: false, message: 'Body must be { assetId, message, history? }' });
    }
    const message = cleanMessage(body.message), history = cleanHistory(body.history);
    if (message === null) return res.status(400).json({ success: false, message: 'message must be 1-500 characters' });
    if (history === null) return res.status(400).json({ success: false, message: 'history must be [{ role: "user"|"assistant", text }]' });
    const dmsId = body.assetId;
    const workspaceId = Object.keys(DEMO_ASSETS).find(ws => DEMO_ASSETS[ws].includes(dmsId));
    if (!workspaceId) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    if (!iotConfig.ai.enabled) return res.status(503).json({ success: false, message: 'AI Insight is disabled' });
    if (iotConfig.ai.provider === 'anthropic' && !anthropic.hasAnthropicCredential()) return res.status(503).json({ success: false, message: 'AI credential is not configured' });
    if (!chatAllowed(req.ip)) return res.status(429).json({ success: false, message: 'Too many chat requests, try again later' });
    try {
        const context = Object.assign(await buildAiContext(req, workspaceId, dmsId), { userQuestion: message, conversation: history });
        const r = await getAiService().run('chat_asset', context);
        res.json({ success: true, data: { insight: r.insight, cached: r.cached, latencyMs: r.latencyMs, provider: iotConfig.ai.provider, model: iotConfig.ai.model } });
    } catch (error) {
        console.log(' /iot/ai/chat failed: ' + (error && (error.status || '') + ' ' + error.message));
        res.status(502).json({ success: false, message: 'AI Insight could not be generated' });
    }
});

// Time series for the charts. range in ms (default 1h of sim time is many points; UI slices).
router.get('/history', function(req, res) {
    const rangeMs = Number(req.query.rangeMs) || 0;
    const points = service.getShared().getHistory(rangeMs, req.query.assetId || null).map(function(p) {
        return {
            t: p.t, healthScore: p.healthScore, metrics: p.metrics,
            deviceId: p.deviceId, condition: p.condition, conditionEvent: p.conditionEvent,
            vibration: p.vibration,
        };
    });
    res.json({ success: true, data: points });
});

// Durable condition events for an asset (escalation/recovery), NEWEST-FIRST, bounded by ?limit
// (default 50, capped to eventHistoryLimit). Survives restarts when event persistence is enabled;
// FM is not involved. Echoes the resolved assetId.
router.get('/events', function(req, res) {
    const feed = service.getShared().getEventsFeed(req.query.assetId || null, req.query.limit);
    res.json({ success: true, assetId: feed.assetId, events: feed.events });
});

// Operator re-baseline (localhost-only control). Gated OFF by default (IOT_REBASELINE_ENABLED), loopback
// peers only, allowlisted assets, exact body { assetId, confirm:'REBASELINE', reason? }. Never automatic.
router.post('/admin/rebaseline', function(req, res) {
    if (!iotConfig.rebaselineEnabled) return res.status(404).json({ success: false, message: 'Not found' });
    const peer = req.socket && req.socket.remoteAddress;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) return res.status(403).json({ success: false, message: 'Local access only' });
    const b = req.body;
    const keys = b && typeof b === 'object' ? Object.keys(b) : [];
    if (!keys.length || keys.some(k => !['assetId', 'confirm', 'reason'].includes(k)) || typeof b.assetId !== 'string'
        || b.confirm !== 'REBASELINE' || (b.reason !== undefined && typeof b.reason !== 'string')) {
        return res.status(400).json({ success: false, message: 'Body must be { assetId, confirm: "REBASELINE", reason? }' });
    }
    if (!Object.keys(DEMO_ASSETS).some(ws => DEMO_ASSETS[ws].includes(b.assetId))) {
        return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
    }
    try {
        const r = service.getShared().rebaseline(b.assetId, { reason: b.reason });
        res.json({ success: true, data: { assetId: b.assetId, baselineEpoch: r.baselineEpoch } });
    } catch (e) {
        console.log(' /iot/admin/rebaseline failed: ' + e.message);
        if (e.message === 'REBASELINE_NOT_DURABLE') return res.status(409).json({ success: false, message: 'Re-baseline requires telemetry persistence (not durable)' });
        res.status(500).json({ success: false, message: 'Re-baseline failed' });
    }
});

router.post('/reset', function(req, res) {
    service.getShared().reset();
    res.json({ success: true });
});

// Unattended server ticker on/off. The dashboard's pause button uses this so pausing also stops
// the background writes, not just the client poll. GET reports current state.
router.get('/ticker', function(req, res) {
    const rt = service.getShared();
    const configured = !!(rt.config.serverTickMs && rt.config.serverTickMs > 0);
    res.json({ success: true, data: { running: service.isServerTickerRunning(), configured: configured } });
});
router.post('/ticker', function(req, res) {
    const running = req.body && (req.body.running === true || req.body.running === 'true');
    if (running) service.startServerTicker(); else service.stopServerTicker();
    res.json({ success: true, data: { running: service.isServerTickerRunning() } });
});

// Ingest a The Things Stack uplink (raw frm_payload). Untrusted input — decode errors are 400.
router.post('/uplink', async function(req, res) {
    try {
        const r = await service.getShared().ingestUplink(req.body);
        res.json({ success: r.accepted, data: r });
    } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

module.exports = router;
