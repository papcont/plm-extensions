// Tandem time-series repository. Tandem is the time-series / digital-twin layer — it takes every
// reading, Fusion Manage does not. For the MVP this keeps an in-memory ring buffer per asset that
// feeds the UI charts (the "time-series layer" stand-in). When TANDEM_ENABLED and a real
// TANDEM_INGESTION_URL are configured it ALSO POSTs to that stream. No endpoint is invented: with
// no URL configured it only stores locally.

const axios = require('axios').create({ timeout: 15000 });

function createTandemRepository(config, logger = console) {
    const series = new Map();        // assetId -> [{ t, metrics, healthScore }]
    const limit = (config.simulation && config.simulation.historyLimit) || 2000;

    async function push(assetId, timestamp, metrics, healthScore) {
        const arr = series.get(assetId) || [];
        arr.push({ t: timestamp, metrics, healthScore });
        if (arr.length > limit) arr.splice(0, arr.length - limit);
        series.set(assetId, arr);

        let delivered = 'stored';
        if (config.tandemEnabled && config.tandemIngestionUrl) {
            try {
                // Stream ingestion shape is a flat {name:value} sample keyed by the stream/asset.
                // Kept behind the flag; real facility/stream mapping supplied by config, not hardcoded.
                await axios.post(config.tandemIngestionUrl, buildStreamPayload(assetId, timestamp, metrics, healthScore));
                delivered = 'ingested';
            } catch (err) {
                logger.log(' IoT/Tandem: ingestion failed - ' + err.message);
                delivered = 'error';
            }
        }
        return { delivered, points: (series.get(assetId) || []).length };
    }

    function history(assetId, sinceMs) {
        const arr = series.get(assetId) || [];
        if (!sinceMs) return arr.slice();
        const cutoff = Date.now() - sinceMs;
        return arr.filter(p => new Date(p.t).getTime() >= cutoff);
    }

    return { push, history };
}

function buildStreamPayload(assetId, timestamp, metrics, healthScore) {
    return [{ id: assetId, ts: new Date(timestamp).getTime(), ...metrics, healthScore }];
}

module.exports = { createTandemRepository };
