// IoT / Condition Monitoring HTTP surface. Self-contained: serves simulated telemetry, health and
// condition from the shared IoT runtime. No PLM/APS auth required (no tenant data, no secrets in
// responses). Ticking is client-driven (the dashboard polls /tick). The TTS uplink endpoint is the
// same door the future SenseCAP -> The Things Stack webhook will use.

const express = require('express');
const router  = express.Router();
const service = require('../services/iot/service');

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
