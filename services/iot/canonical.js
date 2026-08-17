// Canonical telemetry event — the single internal format every source normalizes to.
// Nothing past the device adapter may depend on the transport/vendor. Versioned via SCHEMA_VERSION.

const crypto = require('node:crypto');

const SCHEMA_VERSION = '1.0';

// Core condition-monitoring metrics (from the Netvox R718E 0x02 velocity+temp frame).
const CORE_METRICS = ['velocityX', 'velocityY', 'velocityZ', 'temperature'];
// Optional detail metrics (0x01 accel+battery frame).
const DETAIL_METRICS = ['accelerationX', 'accelerationY', 'accelerationZ', 'battery'];
const KNOWN_METRICS = [...CORE_METRICS, ...DETAIL_METRICS];

// Build a canonical event. Unknown metric keys are rejected so a bad adapter can't leak a
// vendor field downstream.
function createEvent({ deviceId, deviceType, assetId, source, timestamp, metrics, meta }) {
    const event = {
        schemaVersion : SCHEMA_VERSION,
        eventId       : crypto.randomUUID(),
        deviceId      : String(deviceId),
        deviceType    : deviceType || 'unknown',
        assetId       : String(assetId != null ? assetId : deviceId),
        source        : source || 'unknown',
        timestamp     : normalizeTimestamp(timestamp),
        metrics       : {},
    };
    for (const [key, value] of Object.entries(metrics || {})) {
        if (!KNOWN_METRICS.includes(key)) throw new Error('unknown metric: ' + key);
        if (typeof value !== 'number' || !Number.isFinite(value)) continue; // skip missing/NaN
        event.metrics[key] = value;
    }
    if (meta && typeof meta === 'object') event.meta = meta;
    return event;
}

function normalizeTimestamp(ts) {
    if (ts == null) return new Date().toISOString();
    const d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) throw new Error('invalid timestamp: ' + ts);
    return d.toISOString();
}

// Validate an event that arrived from outside (untrusted input). Returns { valid, errors }.
function validate(event) {
    const errors = [];
    if (!event || typeof event !== 'object') return { valid: false, errors: ['event not an object'] };
    if (event.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion must be ' + SCHEMA_VERSION);
    for (const f of ['deviceId', 'assetId', 'source', 'timestamp']) {
        if (typeof event[f] !== 'string' || event[f] === '') errors.push(f + ' required');
    }
    if (typeof event.timestamp === 'string' && isNaN(new Date(event.timestamp).getTime())) {
        errors.push('timestamp not parseable');
    }
    if (!event.metrics || typeof event.metrics !== 'object') {
        errors.push('metrics required');
    } else {
        for (const [k, v] of Object.entries(event.metrics)) {
            if (!KNOWN_METRICS.includes(k)) errors.push('unknown metric: ' + k);
            else if (typeof v !== 'number' || !Number.isFinite(v)) errors.push('metric ' + k + ' not finite');
        }
        if (!CORE_METRICS.some(k => k in event.metrics)) errors.push('at least one core metric required');
    }
    return { valid: errors.length === 0, errors };
}

// Overall vibration velocity magnitude (mm/s) — one understandable number for UI/health.
function vibrationMagnitude(metrics) {
    const x = metrics.velocityX || 0, y = metrics.velocityY || 0, z = metrics.velocityZ || 0;
    return Math.sqrt(x * x + y * y + z * z);
}

module.exports = {
    SCHEMA_VERSION, CORE_METRICS, DETAIL_METRICS, KNOWN_METRICS,
    createEvent, validate, vibrationMagnitude,
};
