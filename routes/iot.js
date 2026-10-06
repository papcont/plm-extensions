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
let fmReadRepository;
let aiService;

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
    };
}

function getAiService() {
    if (!aiService) {
        // ponytail: one provider today; add a providers/<name>.js + this switch when a second is needed.
        if (iotConfig.ai.provider !== 'anthropic') throw new Error('AI_PROVIDER_UNKNOWN');
        const provider = require('../services/iot/ai/providers/anthropic').createAnthropicProvider(iotConfig.ai);
        aiService = createAiService({ config: iotConfig.ai, provider });
    }
    return aiService;
}

function readErrorStatus(error) {
    return error && error.message === 'FM_READ_NOT_CONFIGURED' ? 503 : 502;
}

// Non-secret config the UI needs to render bands/labels. Never expose ingestion URLs/keys.
router.get('/config', function(req, res) {
    const rt = service.getShared();
    res.json({ success: true, data: {
        deviceId          : rt.deviceId,
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

router.get('/maintenance-case', async function(req, res) {
    const ref = DEMO_CASE_BY_ASSET[String(req.query.assetId || '')];
    if (!ref) return res.status(404).json({ success: false, message: 'No maintenance case mapping for asset' });
    try {
        const details = await getFmReadRepository().getItem(ref.workspaceId, ref.dmsId);
        res.json({ success: true, data: sanitizeCase(req, details, ref.workspaceId, ref.dmsId) });
    } catch (error) {
        res.status(readErrorStatus(error)).json({ success: false, message: 'Maintenance Case could not be read' });
    }
});

// AI Insight, read-only. The server builds the context from its own sanitized reads; nothing from the
// browser goes into the prompt except the allowlisted asset id. One handler per mode, same guards.
function aiRoute(mode, serviceFn) {
    return async function(req, res) {
        const body = req.body;
        if (!body || typeof body !== 'object' || Object.keys(body).join() !== 'assetId' || typeof body.assetId !== 'string') {
            return res.status(400).json({ success: false, message: 'Body must be exactly { assetId }' });
        }
        const dmsId = body.assetId;
        const workspaceId = Object.keys(DEMO_ASSETS).find(ws => DEMO_ASSETS[ws].includes(dmsId));
        if (!workspaceId) return res.status(403).json({ success: false, message: 'Asset not enabled for monitoring' });
        if (!iotConfig.ai.enabled) return res.status(503).json({ success: false, message: 'AI Insight is disabled' });
        try {
            const caseRef = DEMO_CASE_BY_ASSET[dmsId];
            const repo = getFmReadRepository();
            const [assetDetails, caseDetails] = await Promise.all([
                repo.getItem(workspaceId, dmsId),
                caseRef ? repo.getItem(caseRef.workspaceId, caseRef.dmsId) : null,
            ]);
            const context = buildContext({
                state: service.getShared().getState(dmsId),
                asset: sanitizeAsset(assetDetails, workspaceId, dmsId),
                kase: caseDetails ? sanitizeCase(req, caseDetails, caseRef.workspaceId, caseRef.dmsId) : null,
            });
            const insight = await serviceFn(getAiService(), context);
            res.json({ success: true, data: { mode, insight } });
        } catch (error) {
            console.log(' /iot/ai (' + mode + ') failed: ' + (error && (error.status || '') + ' ' + error.message));
            res.status(502).json({ success: false, message: 'AI Insight could not be generated' });
        }
    };
}
router.post('/ai/explain', aiRoute('explain_asset_state', (ai, ctx) => ai.explainAssetState(ctx)));
router.post('/ai/technician-briefing', aiRoute('technician_briefing', (ai, ctx) => ai.technicianBriefing(ctx)));

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
