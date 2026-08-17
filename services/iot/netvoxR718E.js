// Netvox R718E device adapter: raw LoRaWAN payload -> validated device values -> canonical event.
// Decode is a faithful port of the official Netvox codec (see netvox-r718e-spec.md); encode is the
// inverse, used only to build fixtures and drive the simulator through the real decode path.

const bfloat16 = require('./bfloat16');
const canonical = require('./canonical');

const DEVICE_TYPE = 0x1C;          // R718E
const DEVICE_NAME = 'netvox-r718e';
const DATA_FPORT  = 6;
const REPORT = { INFO: 0x00, ACCEL: 0x01, VELOCITY_TEMP: 0x02 };

// Decode raw device values from an 11-byte data frame on fPort 6.
// Returns { reportType, ...values } or throws on malformed / unsupported input.
function decode(fPort, bytes) {
    if (fPort !== DATA_FPORT) throw new Error('unsupported fPort: ' + fPort);
    if (!Array.isArray(bytes) && !Buffer.isBuffer(bytes)) throw new Error('bytes required');
    const b = Array.from(bytes);
    if (b.length !== 11) throw new Error('R718E data frame must be 11 bytes, got ' + b.length);
    if (b[1] !== DEVICE_TYPE) throw new Error('not an R718E frame (deviceType 0x' + b[1].toString(16) + ')');

    const reportType = b[2];
    if (reportType === REPORT.ACCEL) {
        const lowBattery = (b[3] & 0x80) !== 0;
        return {
            reportType,
            battery       : (lowBattery ? (b[3] & 0x7F) : b[3]) / 10,
            lowBattery,
            accelerationX : round6(bfloat16.decode((b[5] << 8) | b[4])),
            accelerationY : round6(bfloat16.decode((b[7] << 8) | b[6])),
            accelerationZ : round6(bfloat16.decode((b[9] << 8) | b[8])),
        };
    }
    if (reportType === REPORT.VELOCITY_TEMP) {
        const rawTemp = (b[9] << 8) | b[10];
        const temperature = (b[9] & 0x80) ? -(0x10000 - rawTemp) / 10 : rawTemp / 10;
        return {
            reportType,
            velocityX : round6(bfloat16.decode((b[4] << 8) | b[3])),
            velocityY : round6(bfloat16.decode((b[6] << 8) | b[5])),
            velocityZ : round6(bfloat16.decode((b[8] << 8) | b[7])),
            temperature,
        };
    }
    throw new Error('unsupported R718E reportType: 0x' + reportType.toString(16));
}

// Inverse of decode. reading: { velocityX, velocityY, velocityZ, temperature } for VELOCITY_TEMP,
// or { accelerationX/Y/Z, battery } for ACCEL. Returns { fPort, bytes } (an 11-byte frame).
function encode(reportType, reading) {
    const b = new Array(11).fill(0);
    b[0] = 0x01;            // version
    b[1] = DEVICE_TYPE;
    b[2] = reportType;
    if (reportType === REPORT.VELOCITY_TEMP) {
        putWordLE(b, 3, bfloat16.encode(reading.velocityX || 0));
        putWordLE(b, 5, bfloat16.encode(reading.velocityY || 0));
        putWordLE(b, 7, bfloat16.encode(reading.velocityZ || 0));
        const t = Math.round((reading.temperature || 0) * 10);
        const raw = t < 0 ? (0x10000 + t) : t;
        b[9] = (raw >> 8) & 0xFF;
        b[10] = raw & 0xFF;
    } else if (reportType === REPORT.ACCEL) {
        b[3] = Math.max(0, Math.min(0x7F, Math.round((reading.battery || 3.6) * 10)));
        putWordLE(b, 4, bfloat16.encode(reading.accelerationX || 0));
        putWordLE(b, 6, bfloat16.encode(reading.accelerationY || 0));
        putWordLE(b, 8, bfloat16.encode(reading.accelerationZ || 0));
    } else {
        throw new Error('encode: unsupported reportType');
    }
    return { fPort: DATA_FPORT, bytes: b };
}

// Decoded device values -> canonical event. Maps only known metrics; nothing vendor-specific leaks.
function toCanonical(decoded, { deviceId, assetId, timestamp, source, meta } = {}) {
    const metrics = {};
    for (const k of ['velocityX', 'velocityY', 'velocityZ', 'temperature',
                     'accelerationX', 'accelerationY', 'accelerationZ', 'battery']) {
        if (typeof decoded[k] === 'number') metrics[k] = decoded[k];
    }
    return canonical.createEvent({
        deviceId, assetId, timestamp,
        deviceType : DEVICE_NAME,
        source     : source || DEVICE_NAME,
        metrics,
        meta       : Object.assign({ reportType: decoded.reportType }, meta),
    });
}

function putWordLE(b, offset, word) { b[offset] = word & 0xFF; b[offset + 1] = (word >> 8) & 0xFF; }
function round6(n) { return parseFloat(n.toFixed(6)); }

module.exports = { DEVICE_TYPE, DEVICE_NAME, DATA_FPORT, REPORT, decode, encode, toCanonical };
