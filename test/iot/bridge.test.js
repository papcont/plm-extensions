// Integration: simulator -> bridge -> (mocked) Tandem + Fusion Manage, dedupe, validation,
// the Healthy->Warning->Critical->Recovery E2E arc, and the hardware-swap parity proof.
const { test } = require('node:test');
const assert = require('node:assert');

const { createBridge } = require('../../services/iot/bridge');
const service = require('../../services/iot/service');
const netvox = require('../../services/iot/netvoxR718E');
const tts = require('../../services/iot/tts');
const canonical = require('../../services/iot/canonical');
const baseConfig = require('../../services/iot/config');

function mockRepos() {
    const tandemCalls = [], fmSummaries = [], fmEvents = [];
    const tandem = { push: async (a, t, m, h) => { tandemCalls.push({ a, t, m, h }); return { delivered: 'stored', points: tandemCalls.length }; },
                     history: () => tandemCalls };
    const fusionManage = {
        upsertConditionSummary: async s => { fmSummaries.push(s); return { written: false, mode: 'dry-run', summary: s }; },
        recordConditionEvent: async e => { fmEvents.push(e); return { written: false, mode: 'dry-run', event: e }; },
        getSummary: () => null, getEvents: () => fmEvents,
    };
    return { tandem, fusionManage, tandemCalls, fmSummaries, fmEvents };
}

function event(metrics, timestamp) {
    return canonical.createEvent({ deviceId: 'MOTOR-DEMO-001', deviceType: 'netvox-r718e', source: 'test', timestamp, metrics });
}

test('bridge ingests a canonical event and calls both repositories', async () => {
    const m = mockRepos();
    const bridge = createBridge({ config: baseConfig, ...m });
    const res = await bridge.ingest(event({ velocityX: 1.2, velocityY: 0.7, velocityZ: 0.6, temperature: 35 }, '2026-08-12T10:00:00Z'));
    assert.strictEqual(res.accepted, true);
    assert.strictEqual(res.condition.condition, 'NORMAL');
    assert.strictEqual(m.tandemCalls.length, 1);
    assert.strictEqual(m.fmSummaries.length, 1);
});

test('bridge rejects invalid events and drops duplicate timestamps', async () => {
    const m = mockRepos();
    const bridge = createBridge({ config: baseConfig, ...m });
    const bad = await bridge.ingest({ schemaVersion: 'x', deviceId: '', metrics: {} });
    assert.strictEqual(bad.accepted, false);
    assert.strictEqual(bad.stage, 'validation');

    const ts = '2026-08-12T10:00:00Z';
    await bridge.ingest(event({ velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 30 }, ts));
    const dup = await bridge.ingest(event({ velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 30 }, ts));
    assert.strictEqual(dup.accepted, false);
    assert.strictEqual(dup.stage, 'dedupe');
});

test('bridge emits a condition event when severity changes', async () => {
    const m = mockRepos();
    const bridge = createBridge({ config: baseConfig, ...m });
    await bridge.ingest(event({ velocityX: 1.2, velocityY: 0.7, velocityZ: 0.6, temperature: 35 }, '2026-08-12T10:00:00Z'));
    const warn = await bridge.ingest(event({ velocityX: 5.5, velocityY: 2.0, velocityZ: 1.5, temperature: 55 }, '2026-08-12T10:01:00Z'));
    assert.strictEqual(warn.condition.condition, 'WARNING'); // magnitude ~6.04 mm/s: past warn 4.5, below critical 7.1
    assert.ok(warn.conditionEvent, 'a condition event was emitted');
    assert.strictEqual(warn.conditionEvent.type, 'ESCALATION');
    assert.strictEqual(m.fmEvents.length, 1);
});

test('E2E: simulator drives Healthy -> Warning -> Critical -> Recovery through the runtime', async () => {
    const runtime = service.createRuntime({
        simulation: Object.assign({}, baseConfig.simulation, { timeScale: 10 }),
    }); // 10-s samples make the 60-s evidence window observable
    const total = require('../../services/iot/simulator').totalTicks(require('../../services/iot/simulator').DEFAULT_SCENARIO);

    const conditions = [];
    const escalations = [], recoveries = [];
    let minHealth = 100, endHealth = 100;
    for (let i = 0; i < total; i++) {
        const r = await runtime.tick();
        conditions.push(r.condition.condition);
        minHealth = Math.min(minHealth, r.health.score);
        endHealth = r.health.score;
        if (r.conditionEvent && r.conditionEvent.type === 'ESCALATION') escalations.push(r.conditionEvent.severity);
        if (r.conditionEvent && r.conditionEvent.type === 'RECOVERY') recoveries.push(r.conditionEvent.severity);
    }

    assert.ok(conditions.includes('NORMAL'), 'reached NORMAL');
    assert.ok(conditions.includes('WARNING'), 'reached WARNING');
    assert.ok(conditions.includes('CRITICAL'), 'reached CRITICAL');

    const firstWarning = conditions.indexOf('WARNING');
    const firstCritical = conditions.indexOf('CRITICAL');
    assert.ok(firstWarning < firstCritical, 'WARNING appears before CRITICAL');

    const lastCritical = conditions.lastIndexOf('CRITICAL');
    assert.ok(conditions.slice(lastCritical).includes('NORMAL'), 'recovers to NORMAL after CRITICAL');

    assert.ok(minHealth < 40, 'health drops during CRITICAL, was ' + minHealth);
    assert.ok(endHealth >= 80, 'health recovers by the end, was ' + endHealth);
    assert.ok(escalations.length >= 1 && recoveries.length >= 1, 'both escalation and recovery events emitted');
});

test('HARDWARE SWAP: a simulator reading and a raw Netvox uplink yield the same canonical structure', () => {
    const reading = { velocityX: 2.5, velocityY: 1.1, velocityZ: 0.8, temperature: 47.3 };
    const deviceId = 'MOTOR-DEMO-001';
    const timestamp = '2026-08-12T10:00:00Z';

    // Path A: simulator source (goes through Netvox encode/decode inside the runtime helper).
    const simEvent = service.readingToCanonical(reading, { deviceId, timestamp, source: 'simulator' });

    // Path B: a "real" sensor uplink — raw bytes arriving over TTS, decoded by the same adapter.
    const rawFrame = netvox.encode(netvox.REPORT.VELOCITY_TEMP, reading); // what the physical R718E would emit
    const uplink = tts.buildUplink({ deviceId, fPort: rawFrame.fPort, bytes: rawFrame.bytes, receivedAt: timestamp });
    const parsed = tts.parseUplink(uplink);
    const decoded = netvox.decode(parsed.fPort, parsed.bytes);
    const hwEvent = netvox.toCanonical(decoded, { deviceId, timestamp, source: 'netvox-r718e' });

    // Same schema, device type, asset, and IDENTICAL metrics — only the source label differs.
    assert.strictEqual(simEvent.schemaVersion, hwEvent.schemaVersion);
    assert.strictEqual(simEvent.deviceType, hwEvent.deviceType);
    assert.strictEqual(simEvent.assetId, hwEvent.assetId);
    assert.deepStrictEqual(simEvent.metrics, hwEvent.metrics);
    assert.strictEqual(canonical.validate(hwEvent).valid, true);
    assert.notStrictEqual(simEvent.source, hwEvent.source); // the only intended difference
});
