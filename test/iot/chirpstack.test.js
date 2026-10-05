// Dragino LHT65N-VIB over ChirpStack: envelope parse, object->canonical mapping, and the
// hardware-swap parity + bridge integration (a ChirpStack uplink drives the SAME asset condition
// as a directly-built canonical event). Object fixtures mirror the official codec
// (LHT65N-VIB_v1.4.0_Chirpstack_Decoder): fPort 9 emits g axes as strings; fPort 2 emits numbers.
const { test } = require('node:test');
const assert = require('node:assert');

const chirpstack = require('../../services/iot/chirpstack');
const dragino = require('../../services/iot/draginoLHT65VIB');
const canonical = require('../../services/iot/canonical');
const tts = require('../../services/iot/tts');
const service = require('../../services/iot/service');
const ttnMqtt = require('../../services/iot/ttnMqtt');
const { createBridge } = require('../../services/iot/bridge');

const silentLogger = { log() {}, error() {} };

function mockRepos() {
    const tandemCalls = [], fmSummaries = [], fmEvents = [];
    const tandem = { push: async (a, t, m, h) => { tandemCalls.push({ a, t, m, h }); return { delivered: 'stored' }; },
                     history: () => tandemCalls };
    const fusionManage = {
        upsertConditionSummary: async s => { fmSummaries.push(s); return { written: false, mode: 'dry-run' }; },
        recordConditionEvent: async e => { fmEvents.push(e); return { written: false, mode: 'dry-run' }; },
    };
    return { tandem, fusionManage, tandemCalls, fmSummaries, fmEvents };
}
// g-scale vibration bands (Dragino), unlike the mm/s Netvox defaults.
const gConfig = {
    deviceAssetMap: { 'A84041FFFF123456': 'A84041FFFF123456' },
    thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 }, temperature: { baseline: 40, warn: 60, critical: 75 } },
    conditionBands: { normal: 80, observe: 60, warning: 40 },
};

test('ChirpStack envelope parse: devEui upper-cased, base64 data -> bytes, object passed through', () => {
    const event = chirpstack.buildUplink({
        deviceId: 'a84041ffff123456', fPort: 9, bytes: [0x0C, 0x40, 0x03, 0xE8, 0x00, 0x00, 0x07, 0xD0],
        object: { BatV: 3.14, max_acc_x_g: '1.000' }, fCnt: 7,
    });
    const p = chirpstack.parseUplink(event);
    assert.strictEqual(p.deviceId, 'A84041FFFF123456'); // upper-cased to match FM IOT_DEVICE_ID
    assert.strictEqual(p.fPort, 9);
    assert.strictEqual(p.fCnt, 7);
    assert.strictEqual(p.bytes.length, 8);
    assert.strictEqual(p.object.max_acc_x_g, '1.000');
});

test('ChirpStack parse rejects events missing deviceInfo / devEui', () => {
    assert.throws(() => chirpstack.parseUplink({}), /deviceInfo/);
    assert.throws(() => chirpstack.parseUplink({ deviceInfo: {} }), /devEui/);
});

test('fPort 9 accel object -> vibrationG magnitude + axes (string g coerced)', () => {
    // 1,2,2 g -> magnitude sqrt(1+4+4) = 3
    const object = { BatV: '3.140', max_acc_x_g: '1.000', max_acc_y_g: '2.000', max_acc_z_g: '2.000', Node_type: 'LHT65N-VIB' };
    const ev = dragino.objectToCanonical(object, { deviceId: 'A84041FFFF123456', timestamp: '2026-08-19T10:00:00Z', fPort: 9 });
    assert.strictEqual(ev.deviceType, 'dragino-lht65n-vib');
    assert.strictEqual(ev.metrics.vibrationG, 3);
    assert.strictEqual(ev.metrics.accelerationX, 1);
    assert.strictEqual(ev.metrics.accelerationZ, 2);
    assert.strictEqual(ev.metrics.battery, 3.14);
    assert.ok(!('Node_type' in ev.metrics), 'vendor keys dropped');
    assert.strictEqual(canonical.validate(ev).valid, true);
});

test('fPort 2 temp/humidity/count object -> temperature + humidity + vibrationCount', () => {
    const object = { BatV: 3.14, vib_count: 42, TempC_SHT: 24.3, Hum_SHT: 55.0, Alarm: 'FALSE', Node_type: 'LHT65N-VIB' };
    const ev = dragino.objectToCanonical(object, { deviceId: 'A84041FFFF123456', timestamp: '2026-08-19T10:00:00Z', fPort: 2 });
    assert.strictEqual(ev.metrics.temperature, 24.3);
    assert.strictEqual(ev.metrics.humidity, 55);
    assert.strictEqual(ev.metrics.vibrationCount, 42);
    assert.ok(!('vibrationG' in ev.metrics), 'no accel in this frame');
    assert.strictEqual(canonical.validate(ev).valid, true);
});

test('canonical vibrationMagnitude prefers velocity, falls back to vibrationG', () => {
    assert.strictEqual(canonical.vibrationMagnitude({ velocityX: 3, velocityY: 4, velocityZ: 0 }), 5);
    assert.strictEqual(canonical.vibrationMagnitude({ vibrationG: 3.7 }), 3.7);
    assert.strictEqual(canonical.vibrationMagnitude({ accelerationX: 3, accelerationY: 4, accelerationZ: 0 }), 5);
});

test('HARDWARE SWAP: a ChirpStack uplink and a direct canonical event yield the same metrics', () => {
    const deviceId = 'A84041FFFF123456', timestamp = '2026-08-19T10:00:00Z';
    const object = { BatV: '3.140', max_acc_x_g: '1.000', max_acc_y_g: '2.000', max_acc_z_g: '2.000' };

    // Path A: real gateway uplink over ChirpStack.
    const parsed = chirpstack.parseUplink(chirpstack.buildUplink({ deviceId, fPort: 9, object, time: timestamp }));
    const hwEvent = dragino.objectToCanonical(parsed.object, { deviceId, timestamp, source: 'chirpstack', fPort: 9 });

    // Path B: the same numbers built directly as canonical.
    const direct = canonical.createEvent({ deviceId, timestamp, deviceType: 'dragino-lht65n-vib', source: 'x',
        metrics: { battery: 3.14, accelerationX: 1, accelerationY: 2, accelerationZ: 2, vibrationG: 3 } });

    assert.deepStrictEqual(hwEvent.metrics, direct.metrics);
    assert.strictEqual(canonical.validate(hwEvent).valid, true);
});

test('isDraginoObject discriminates Dragino decoded objects from Netvox/other', () => {
    assert.strictEqual(dragino.isDraginoObject({ Node_type: 'LHT65N-VIB' }), true);
    assert.strictEqual(dragino.isDraginoObject({ max_acc_x_g: '1.000' }), true);
    assert.strictEqual(dragino.isDraginoObject({ TempC_SHT: 22 }), true);
    assert.strictEqual(dragino.isDraginoObject({ velocityX: 1 }), false); // Netvox-shaped
    assert.strictEqual(dragino.isDraginoObject(null), false);
});

test('ingestUplink routes a Dragino-over-TTS uplink (decoded_payload) to the Dragino mapper', async () => {
    // TTS with a payload formatter set: uplink carries decoded_payload (the Dragino codec output).
    const runtime = service.createRuntime({
        deviceAssetMap: { 'A84041FFFF123456': '30057' },
        thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 }, temperature: { baseline: 40, warn: 60, critical: 75 } },
    });
    const envelope = {
        end_device_ids: { device_id: 'A84041FFFF123456' },
        received_at: '2026-08-19T10:00:00Z',
        uplink_message: { f_port: 9, decoded_payload: { Node_type: 'LHT65N-VIB', BatV: 3.13, max_acc_x_g: '1.000', max_acc_y_g: '2.000', max_acc_z_g: '2.000' } },
    };
    const r = await runtime.ingestUplink(envelope);
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.assetId, '30057');
    assert.strictEqual(r.summary.vibration, 3); // sqrt(1+4+4) g
    // live-dashboard read path: getState(assetId) returns THIS asset; an unbound asset is null
    // (dashboard shows "waiting for first uplink").
    assert.strictEqual(runtime.getState('30057').summary.assetId, '30057');
    assert.strictEqual(runtime.getState('NO-SUCH-ASSET'), null);
});

test('dragino.decode: fPort-7 VIBMOD=4 XYZ frame (real TTN capture) -> acc_*_g', () => {
    // Real frame off lht65n-vib-01 (FPort 7): 0C8D 03F1 FF60 FFB5
    const bytes = [0x0C, 0x8D, 0x03, 0xF1, 0xFF, 0x60, 0xFF, 0xB5];
    const o = dragino.decode(7, bytes);
    assert.strictEqual(o.BatV, 3.213);
    assert.strictEqual(o.acc_x_g, '1.009');   // 0x03F1/1000
    assert.strictEqual(o.acc_y_g, '-0.160');  // 0xFF60 signed
    assert.strictEqual(o.acc_z_g, '-0.075');  // 0xFFB5 signed
    const event = dragino.objectToCanonical(o, {
        deviceId: 'A8404198D65F3D36', timestamp: '2026-08-19T10:00:00Z', fPort: 7,
    });
    assert.strictEqual(event.metrics.vibrationG, 0.024); // remove Earth's static ~1 g
    assert.strictEqual(event.meta.vibrationModel, 'dynamic-magnitude-minus-1g');
    assert.strictEqual(event.meta.activityInference, 'unsupported');
    const still = dragino.objectToCanonical(
        { acc_x_g: '1.000', acc_y_g: '0.000', acc_z_g: '0.000' },
        { deviceId: 'A8404198D65F3D36', timestamp: '2026-08-19T10:00:01Z', fPort: 7 });
    assert.strictEqual(still.metrics.vibrationG, 0);
    // multi-group: peak-magnitude group wins (2nd group here is larger)
    const two = dragino.decode(7, [0x0C, 0x8D, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x0B, 0xB8, 0x00, 0x00, 0x00, 0x00]);
    assert.strictEqual(two.acc_x_g, '3.000');  // 0x0BB8=3000 > 0x0064=100
    assert.strictEqual(dragino.decode(7, [0x0C, 0x8D, 0x00]), null); // wrong length -> not decoded
});

test('VIBMOD=4 low sample stays NORMAL because one sample cannot prove machine OFF', async () => {
    const runtime = service.createRuntime({
        deviceAssetMap: { 'A8404198D65F3D36': '30057' },
        thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 }, temperature: { baseline: 40, warn: 60, critical: 75 } },
    });
    const envelope = {
        end_device_ids: { device_id: 'A8404198D65F3D36' },
        received_at: '2026-08-19T10:00:00Z',
        uplink_message: {
            f_port: 7,
            frm_payload: Buffer.from([0x0C, 0x44, 0x03, 0xE8, 0, 0, 0, 0]).toString('base64'),
        },
    };
    const result = await runtime.ingestUplink(envelope);
    assert.strictEqual(result.summary.vibration, 0);
    assert.strictEqual(result.condition.condition, 'NORMAL');
    assert.strictEqual(result.conditionEvent, null);
});

test('dragino.decode: raw fPort-9 accel frame -> codec object shape', () => {
    // bat 3.140, accel 1/2/2 g: 3140=0x0C44, 1000=0x03E8, 2000=0x07D0
    const bytes = [0x0C, 0x44, 0x03, 0xE8, 0x07, 0xD0, 0x07, 0xD0];
    const o = dragino.decode(9, bytes);
    assert.strictEqual(o.Node_type, 'LHT65N-VIB');
    assert.strictEqual(o.BatV, 3.14);
    assert.strictEqual(o.max_acc_x_g, '1.000');
    assert.strictEqual(o.max_acc_z_g, '2.000');
    assert.strictEqual(dragino.decode(6, bytes), null); // Netvox port -> not a Dragino frame
});

test('ingestUplink: raw Dragino-over-TTS (no formatter) decodes via fPort routing', async () => {
    const runtime = service.createRuntime({
        deviceAssetMap: { 'A8404198D65F3D36': '30057' },
        thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 }, temperature: { baseline: 40, warn: 60, critical: 75 } },
    });
    const bytes = [0x0C, 0x44, 0x03, 0xE8, 0x07, 0xD0, 0x07, 0xD0]; // accel 1/2/2 g -> mag 3
    const envelope = {
        end_device_ids: { device_id: 'A8404198D65F3D36' },
        received_at: '2026-08-19T10:00:00Z',
        uplink_message: { f_port: 9, frm_payload: Buffer.from(bytes).toString('base64') }, // NO decoded_payload
    };
    const r = await runtime.ingestUplink(envelope);
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.assetId, '30057');
    assert.strictEqual(r.summary.vibration, 3);
});

test('ingestUplink: short Dragino fPort-2 status frame is ignored without a decoder error', async () => {
    const runtime = service.createRuntime({ deviceAssetMap: { 'A8404198D65F3D36': '30057' } });
    const result = await runtime.ingestUplink({
        end_device_ids: { device_id: 'A8404198D65F3D36' },
        received_at: '2026-08-19T10:00:00Z',
        uplink_message: { f_port: 2, frm_payload: Buffer.from([0x0C, 0x47, 0x12]).toString('base64') },
    });
    assert.deepStrictEqual(result, { accepted: false, stage: 'decode', reason: 'unsupported Dragino frame' });
});

test('ttnMqtt.handleMessage: valid TTN uplink JSON is parsed and ingested', async () => {
    const seen = [];
    const bytes = [0x0C, 0x44, 0x03, 0xE8, 0x07, 0xD0, 0x07, 0xD0];
    const raw = JSON.stringify({
        end_device_ids: { device_id: 'A8404198D65F3D36' },
        received_at: '2026-08-19T10:00:00Z',
        uplink_message: { f_port: 9, frm_payload: Buffer.from(bytes).toString('base64') },
    });
    const r = await ttnMqtt.handleMessage(Buffer.from(raw), async evt => { seen.push(evt); return { accepted: true }; }, silentLogger);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].uplink_message.f_port, 9);
});

test('ttnMqtt.handleMessage: bad JSON and ingest errors never throw', async () => {
    const bad = await ttnMqtt.handleMessage(Buffer.from('not json'), async () => {}, silentLogger);
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.reason, 'json');
    const errored = await ttnMqtt.handleMessage(Buffer.from('{}'), async () => { throw new Error('boom'); }, silentLogger);
    assert.strictEqual(errored.ok, false);
    assert.strictEqual(errored.reason, 'ingest');
});

test('ttnMqtt.start returns null when gated off or misconfigured', () => {
    assert.strictEqual(ttnMqtt.start({ ttnMqtt: { enabled: false } }, async () => {}, silentLogger), null);
    assert.strictEqual(ttnMqtt.start({ ttnMqtt: { enabled: true } }, async () => {}, silentLogger), null); // no creds
});

test('bridge: high-g ChirpStack uplink escalates condition, low-g is NORMAL (g-scale thresholds)', async () => {
    const m = mockRepos();
    const bridge = createBridge({ config: gConfig, ...m });
    const deviceId = 'A84041FFFF123456';

    const calm = dragino.objectToCanonical({ max_acc_x_g: '0.200', max_acc_y_g: '0.100', max_acc_z_g: '0.100' },
        { deviceId, timestamp: '2026-08-19T10:00:00Z', source: 'chirpstack', fPort: 9 });
    const r1 = await bridge.ingest(calm);
    assert.strictEqual(r1.accepted, true);
    assert.strictEqual(r1.condition.condition, 'NORMAL');

    const shaking = dragino.objectToCanonical({ max_acc_x_g: '3.000', max_acc_y_g: '3.000', max_acc_z_g: '2.000' },
        { deviceId, timestamp: '2026-08-19T10:01:00Z', source: 'chirpstack', fPort: 9 }); // mag ~4.69 g > critical 4
    const r2 = await bridge.ingest(shaking);
    assert.strictEqual(r2.accepted, true);
    assert.notStrictEqual(r2.condition.condition, 'NORMAL');
    assert.ok(r2.conditionEvent && r2.conditionEvent.type === 'ESCALATION', 'escalation event emitted');
});
