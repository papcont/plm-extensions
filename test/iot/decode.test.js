// Decoding / canonical layer: bfloat16, Netvox R718E decode+encode, TTS envelope, canonical model.
const { test } = require('node:test');
const assert = require('node:assert');

const bfloat16 = require('../../services/iot/bfloat16');
const netvox = require('../../services/iot/netvoxR718E');
const tts = require('../../services/iot/tts');
const canonical = require('../../services/iot/canonical');

test('bfloat16 decodes the official Netvox example words', () => {
    assert.strictEqual(bfloat16.decode(0x40B3), 5.59375);
    assert.strictEqual(bfloat16.decode(0xC0B2), -5.5625);
    assert.ok(Math.abs(bfloat16.decode(0x3E6A) - 0.228515625) < 1e-9);
});

test('bfloat16 encode is the exact inverse for representable values', () => {
    assert.strictEqual(bfloat16.encode(5.59375), 0x40B3);
    for (const v of [0, 1.2, -3.4, 11.0, 48.25]) {
        assert.ok(Math.abs(bfloat16.decode(bfloat16.encode(v)) - v) <= Math.max(0.05, Math.abs(v) * 0.01));
    }
});

test('Netvox R718E decodes the official acceleration example vector', () => {
    const bytes = [0x01, 0x1C, 0x01, 0x24, 0xB3, 0x40, 0xB2, 0xC0, 0x6A, 0x3E, 0x00];
    const d = netvox.decode(6, bytes);
    assert.strictEqual(d.reportType, 0x01);
    assert.strictEqual(d.battery, 3.6);
    assert.strictEqual(d.lowBattery, false);
    assert.strictEqual(d.accelerationX, 5.59375);
    assert.strictEqual(d.accelerationY, -5.5625);
    assert.strictEqual(d.accelerationZ, 0.228516);
});

test('Netvox R718E decodes negative temperature per the codec (FF97 -> -10.5)', () => {
    const frame = netvox.encode(netvox.REPORT.VELOCITY_TEMP, { velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 0 });
    frame.bytes[9] = 0xFF; frame.bytes[10] = 0x97;
    const d = netvox.decode(6, frame.bytes);
    assert.strictEqual(d.temperature, -10.5);
});

test('Netvox R718E encode/decode round-trips velocity + temperature', () => {
    const reading = { velocityX: 2.5, velocityY: 1.1, velocityZ: 0.8, temperature: 47.3 };
    const frame = netvox.encode(netvox.REPORT.VELOCITY_TEMP, reading);
    const d = netvox.decode(frame.fPort, frame.bytes);
    assert.strictEqual(d.reportType, 0x02);
    assert.ok(Math.abs(d.velocityX - 2.5) < 0.05);
    assert.ok(Math.abs(d.velocityY - 1.1) < 0.05);
    assert.ok(Math.abs(d.velocityZ - 0.8) < 0.05);
    assert.strictEqual(d.temperature, 47.3); // temp is int16/10, exact
});

test('Netvox R718E rejects malformed / unsupported frames', () => {
    assert.throws(() => netvox.decode(1, new Array(11).fill(0)), /fPort/);
    assert.throws(() => netvox.decode(6, [0x01, 0x1C, 0x01]), /11 bytes/);
    assert.throws(() => netvox.decode(6, [0x01, 0xAA, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]), /not an R718E/);
    assert.throws(() => netvox.decode(6, [0x01, 0x1C, 0x09, 0, 0, 0, 0, 0, 0, 0, 0]), /reportType/);
});

test('Netvox toCanonical maps only known metrics and validates', () => {
    const d = netvox.decode(6, netvox.encode(netvox.REPORT.VELOCITY_TEMP, { velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 30 }).bytes);
    const event = netvox.toCanonical(d, { deviceId: 'MOTOR-DEMO-001', timestamp: '2026-08-12T10:00:00Z' });
    assert.strictEqual(event.schemaVersion, '1.0');
    assert.strictEqual(event.deviceType, 'netvox-r718e');
    assert.strictEqual(event.assetId, 'MOTOR-DEMO-001');
    assert.deepStrictEqual(Object.keys(event.metrics).sort(), ['temperature', 'velocityX', 'velocityY', 'velocityZ']);
    assert.strictEqual(canonical.validate(event).valid, true);
});

test('TTS envelope build -> parse round-trips raw bytes + deviceId', () => {
    const bytes = netvox.encode(netvox.REPORT.VELOCITY_TEMP, { velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 25 }).bytes;
    const uplink = tts.buildUplink({ deviceId: 'DEV-1', fPort: 6, bytes, fCnt: 42 });
    const parsed = tts.parseUplink(uplink);
    assert.strictEqual(parsed.deviceId, 'DEV-1');
    assert.strictEqual(parsed.fPort, 6);
    assert.strictEqual(parsed.fCnt, 42);
    assert.deepStrictEqual(parsed.bytes, bytes);
});

test('TTS parse rejects envelopes missing device id or uplink_message', () => {
    assert.throws(() => tts.parseUplink({}), /uplink_message/);
    assert.throws(() => tts.parseUplink({ uplink_message: { f_port: 6 } }), /device_id/);
});

test('canonical rejects unknown metrics and invalid events', () => {
    assert.throws(() => canonical.createEvent({ deviceId: 'x', metrics: { bogus: 1 } }), /unknown metric/);
    const bad = { schemaVersion: '9.9', deviceId: '', assetId: 'a', source: 's', timestamp: 'nope', metrics: {} };
    const res = canonical.validate(bad);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.length >= 3);
});

test('canonical vibrationMagnitude is the 3-axis velocity magnitude', () => {
    assert.strictEqual(canonical.vibrationMagnitude({ velocityX: 3, velocityY: 4, velocityZ: 0 }), 5);
});
