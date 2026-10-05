// Tandem time-series repository. Tandem is the time-series / digital-twin layer — it takes every
// reading, Fusion Manage does not. It keeps a fast in-memory ring and can append every sample to
// durable daily files. When TANDEM_ENABLED and a real TANDEM_INGESTION_URL are configured it also
// posts to that stream.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const axios = require('axios').create({ timeout: 15000 });

function createTandemRepository(config, logger = console) {
    const series = new Map();        // assetId -> [{ t, metrics, healthScore }]
    const limit = (config.simulation && config.simulation.historyLimit) || 2000;
    const persistenceEnabled = !!config.telemetryPersistenceEnabled;
    const storeRoot = path.resolve(config.telemetryStorePath || 'storage/iot/telemetry');

    if (persistenceEnabled) fs.mkdirSync(storeRoot, { recursive: true });

    function assetDirectory(assetId) {
        const key = crypto.createHash('sha256').update(String(assetId)).digest('hex');
        return path.join(storeRoot, key);
    }

    function pointFile(assetId, timestamp) {
        const day = new Date(timestamp).toISOString().slice(0, 10);
        return path.join(assetDirectory(assetId), day + '.ndjson');
    }

    function persist(assetId, point) {
        if (!persistenceEnabled) return;
        const file = pointFile(assetId, point.t);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify(Object.assign({ assetId: String(assetId) }, point)) + '\n', 'utf8');
    }

    function readPersisted(assetId, sinceMs) {
        if (!persistenceEnabled) return [];
        const dir = assetDirectory(assetId);
        if (!fs.existsSync(dir)) return [];
        const cutoff = sinceMs ? Date.now() - sinceMs : 0;
        const cutoffDay = cutoff ? new Date(cutoff).toISOString().slice(0, 10) : '';
        const files = fs.readdirSync(dir)
            .filter(name => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name) && (!cutoffDay || name.slice(0, 10) >= cutoffDay))
            .sort();
        const points = [];
        for (const name of files) {
            const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/);
            for (const line of lines) {
                if (!line) continue;
                try {
                    const point = JSON.parse(line);
                    if (String(point.assetId) !== String(assetId)) continue;
                    if (!cutoff || new Date(point.t).getTime() >= cutoff) points.push(point);
                } catch (err) {
                    logger.log(' IoT/Telemetry: ignored malformed history line in ' + name);
                }
            }
        }
        return points;
    }

    async function push(assetId, timestamp, metrics, healthScore, metadata = {}) {
        const point = {
            t: timestamp,
            metrics: Object.assign({}, metrics),
            healthScore,
            deviceId: metadata.deviceId || null,
            deviceType: metadata.deviceType || null,
            source: metadata.source || null,
            fPort: Number.isInteger(metadata.fPort) ? metadata.fPort : null,
            vibrationModel: metadata.vibrationModel || null,
            activityInference: metadata.activityInference || null,
            observedMetrics: Array.isArray(metadata.observedMetrics) ? metadata.observedMetrics.slice() : [],
            condition: metadata.condition || null,
            conditionEvent: metadata.conditionEvent || null,
            vibration: (metadata.vibration == null) ? null : metadata.vibration,
        };
        const arr = series.get(assetId) || [];
        arr.push(point);
        if (arr.length > limit) arr.splice(0, arr.length - limit);
        series.set(assetId, arr);

        try {
            persist(assetId, point);
        } catch (err) {
            logger.log(' IoT/Telemetry: persistence failed - ' + err.message);
        }

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
        const cutoff = sinceMs ? Date.now() - sinceMs : 0;
        const persisted = readPersisted(assetId, sinceMs);
        const memory = (series.get(assetId) || []).filter(p => !cutoff || new Date(p.t).getTime() >= cutoff);
        const unique = new Map();
        for (const point of persisted.concat(memory)) {
            const key = String(point.t) + '|' + String(point.deviceId || '');
            unique.set(key, point);
        }
        return Array.from(unique.values()).sort((a, b) => new Date(a.t) - new Date(b.t));
    }

    function latest(assetId) {
        const points = history(assetId, 0);
        return points.length ? points[points.length - 1] : null;
    }

    return { push, history, latest };
}

function buildStreamPayload(assetId, timestamp, metrics, healthScore) {
    return [{ id: assetId, ts: new Date(timestamp).getTime(), ...metrics, healthScore }];
}

module.exports = { createTandemRepository };
