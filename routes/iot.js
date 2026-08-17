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

// Current asset condition summary + recent condition events.
router.get('/state', function(req, res) {
    res.json({ success: true, data: service.getShared().getState() });
});

// Time series for the charts. range in ms (default 1h of sim time is many points; UI slices).
router.get('/history', function(req, res) {
    const rangeMs = Number(req.query.rangeMs) || 0;
    const points = service.getShared().getHistory(rangeMs).map(function(p) {
        return { t: p.t, healthScore: p.healthScore, metrics: p.metrics };
    });
    res.json({ success: true, data: points });
});

router.post('/reset', function(req, res) {
    service.getShared().reset();
    res.json({ success: true });
});

// Ingest a The Things Stack uplink (raw frm_payload). Untrusted input — decode errors are 400.
router.post('/uplink', async function(req, res) {
    try {
        const r = await service.getShared().ingestUplink(req.body);
        res.json({ success: r.accepted, data: r });
    } catch (e) { res.status(400).json({ success: false, message: e.message }); }
});

module.exports = router;
