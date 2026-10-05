// Dragino LHT65N-VIB device adapter. Unlike the Netvox adapter (which decodes raw bytes itself), the
// LHT65N-VIB rides ChirpStack, which already decodes with the official Dragino codec. So this adapter
// maps ChirpStack's decoded `object` -> canonical metrics. Field names mirror the official codec
// (LHT65N-VIB_v1.4.0_Chirpstack_Decoder): fPort 2 -> BatV / TempC_SHT / Hum_SHT / vib_count;
// fPort 9 -> BatV / max_acc_{x,y,z}_g; fPort 10 -> acc_{x,y,z}_g. Codec emits g values as strings.
// fPort 7 -> VIBMOD=4 realtime XYZ (BAT + N groups of X,Y,Z); mapped to acc_{x,y,z}_g (peak group).
//
// Vibration signal: the sensor reports acceleration per axis (g), NOT velocity (mm/s). VIBMOD=4
// includes Earth's static ~1 g acceleration, so its scored amplitude is |magnitude - 1 g|. Peak modes
// keep their raw 3-axis magnitude. The axes are retained as detail for later analysis.
// This device gives amplitude + event counts, not an ISO-10816 velocity spectrum — good for trend/
// threshold monitoring, not bearing-fault spectral diagnostics. Thresholds are g-scale (config).

const canonical = require('./canonical');

const DEVICE_NAME = 'dragino-lht65n-vib';

// ChirpStack codec numbers may arrive as strings (toFixed) — coerce, drop non-finite.
function num(v) {
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return (typeof n === 'number' && Number.isFinite(n)) ? n : undefined;
}
function round3(n) { return parseFloat(n.toFixed(3)); }

// Decoded ChirpStack object -> canonical event. Maps only known metrics; vendor-specific keys
// (Node_type, work_min, Alarm, state-change flags, config echoes) are intentionally dropped.
function objectToCanonical(object, { deviceId, assetId, timestamp, source, fPort, meta } = {}) {
    const o = object || {};
    const metrics = {};

    const t = num(o.TempC_SHT);  if (t !== undefined) metrics.temperature    = t;
    const h = num(o.Hum_SHT);    if (h !== undefined) metrics.humidity       = h;
    const c = num(o.vib_count);  if (c !== undefined) metrics.vibrationCount  = c;
    const b = num(o.BatV);       if (b !== undefined) metrics.battery         = b;

    // Peak acceleration per axis (g). fPort 9 = max_acc_*, fPort 10 = real-time acc_*; prefer the peak.
    const ax = num(o.max_acc_x_g) ?? num(o.acc_x_g);
    const ay = num(o.max_acc_y_g) ?? num(o.acc_y_g);
    const az = num(o.max_acc_z_g) ?? num(o.acc_z_g);
    if (ax !== undefined) metrics.accelerationX = ax;
    if (ay !== undefined) metrics.accelerationY = ay;
    if (az !== undefined) metrics.accelerationZ = az;
    if (ax !== undefined || ay !== undefined || az !== undefined) {
        const magnitude = Math.sqrt((ax || 0) ** 2 + (ay || 0) ** 2 + (az || 0) ** 2);
        metrics.vibrationG = round3(fPort === 7 ? Math.abs(magnitude - 1) : magnitude);
    }

    return canonical.createEvent({
        deviceId, assetId, timestamp,
        deviceType : DEVICE_NAME,
        source     : source || DEVICE_NAME,
        metrics,
        meta       : Object.assign({
            fPort,
            vibrationModel: fPort === 7 ? 'dynamic-magnitude-minus-1g' : 'vector-magnitude',
            activityInference: fPort === 7 ? 'unsupported' : 'available',
        }, meta),
    });
}

// Data ports that carry condition telemetry (vs config/info ports 5/12/14). fPort 7 = VIBMOD=4
// realtime three-axis vibration (BAT + N groups of X,Y,Z), verified against the device on this tenant.
const DATA_PORTS = [2, 7, 9, 10];

// Faithful port of the official Dragino LHT65N-VIB codec for the DATA ports only (2/7/9/10). Used when
// an uplink carries raw bytes but NO decoded object — e.g. The Things Stack without a payload
// formatter set. Returns the same object shape the codec emits (which objectToCanonical maps), or
// null for unsupported/config frames. g values are strings (toFixed) exactly like the codec.
function decode(fPort, bytes) {
    const b = Array.from(bytes || []);
    const d = { Node_type: 'LHT65N-VIB' };
    if (fPort === 2 && b.length === 11) {
        d.BatV = (b[0] << 8 | b[1]) / 1000;
        const mod = (b[2] >> 2) & 0x07;
        if (mod === 1) {
            d.vib_count = (b[3] << 8 | b[4] << 8 | b[5] << 8 | b[6]) >>> 0;
            d.work_min  = (b[7] << 8 | b[8] << 8 | b[9] << 8 | b[10]) >>> 0;
        } else if (mod === 2) {
            d.vib_count = (b[3] << 8 | b[4] << 8 | b[5] << 8 | b[6]) >>> 0;
            d.TempC_SHT = parseFloat(((b[7] << 24 >> 16 | b[8]) / 100).toFixed(2));
            d.Hum_SHT   = parseFloat((((b[9] << 8 | b[10]) & 0xFFF) / 10).toFixed(1));
        } else if (mod === 3) {
            d.TempC_SHT = parseFloat(((b[3] << 24 >> 16 | b[4]) / 100).toFixed(2));
            d.Hum_SHT   = parseFloat((((b[5] << 8 | b[6]) & 0xFFF) / 10).toFixed(1));
            d.work_min  = (b[7] << 8 | b[8] << 8 | b[9] << 8 | b[10]) >>> 0;
        }
        d.Alarm = (b[2] & 0x01) ? 'TRUE' : 'FALSE';
        return d;
    }
    if (fPort === 7 && b.length >= 8 && (b.length - 2) % 6 === 0) {
        // VIBMOD=4 (manual 2.4.4): BAT(2) + N groups of X,Y,Z (int16 signed two's complement, /1000 g).
        // Emit the peak-magnitude group as realtime accel (acc_*_g) — that group drives vibrationG.
        // ponytail: peak over groups, not per-group detail; add per-group emission if temporal/spectral
        // analysis is ever needed (our config sends 1 group / 8 bytes).
        d.BatV = (b[0] << 8 | b[1]) / 1000;
        let best = { m: -1, x: 0, y: 0, z: 0 };
        for (let i = 2; i + 6 <= b.length; i += 6) {
            const x = (b[i]     << 24 >> 16 | b[i + 1]) / 1000;
            const y = (b[i + 2] << 24 >> 16 | b[i + 3]) / 1000;
            const z = (b[i + 4] << 24 >> 16 | b[i + 5]) / 1000;
            const m = x * x + y * y + z * z;
            if (m > best.m) best = { m, x, y, z };
        }
        d.acc_x_g = best.x.toFixed(3);
        d.acc_y_g = best.y.toFixed(3);
        d.acc_z_g = best.z.toFixed(3);
        return d;
    }
    if (fPort === 9 && b.length === 8) {
        d.BatV = (b[0] << 8 | b[1]) / 1000;
        d.max_acc_x_g = ((b[2] << 24 >> 16 | b[3]) / 1000).toFixed(3);
        d.max_acc_y_g = ((b[4] << 24 >> 16 | b[5]) / 1000).toFixed(3);
        d.max_acc_z_g = ((b[6] << 24 >> 16 | b[7]) / 1000).toFixed(3);
        return d;
    }
    if (fPort === 10 && b.length === 11) {
        d.BatV = (b[0] << 8 | b[1]) / 1000;
        d.acc_x_g = ((b[2] << 24 >> 16 | b[3]) / 1000).toFixed(3);
        d.acc_y_g = ((b[4] << 24 >> 16 | b[5]) / 1000).toFixed(3);
        d.acc_z_g = ((b[6] << 24 >> 16 | b[7]) / 1000).toFixed(3);
        return d;
    }
    return null;
}

// Does a decoded object look like it came from the Dragino LHT65N-VIB codec? Used to route a TTS
// uplink (whose decoded_payload could be from any device) to this mapper vs the Netvox raw-byte path.
// The official codec stamps Node_type on every port; the metric keys are the fallback signal.
function isDraginoObject(o) {
    if (!o || typeof o !== 'object') return false;
    if (o.Node_type === 'LHT65N-VIB') return true;
    return ['TempC_SHT', 'Hum_SHT', 'vib_count', 'max_acc_x_g', 'acc_x_g'].some(k => k in o);
}

module.exports = { DEVICE_NAME, DATA_PORTS, decode, objectToCanonical, isDraginoObject };
