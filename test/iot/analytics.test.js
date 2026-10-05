// Learned-baseline analytics: baseline learning, robust anomaly scoring, the update gate that protects
// the baseline from faults, condition hysteresis, history bootstrap, units, and the full learned arc.
const { test } = require('node:test');
const assert = require('node:assert');

const analytics = require('../../services/iot/analytics');
const canonical = require('../../services/iot/canonical');
const { createBridge } = require('../../services/iot/bridge');
const baseConfig = require('../../services/iot/config');

const A = baseConfig.analytics;

// ---------------- baseline ----------------

test('baseline: median + MAD + normal bounds from a sample set', () => {
    const samples = [1, 2, 3, 4, 5].map(v => ({ vibration: v }));
    const b = analytics.computeBaseline(samples, A);
    assert.strictEqual(b.vibration.median, 3);
    assert.strictEqual(b.vibration.mad, 1);                 // devs [2,1,0,1,2] -> median 1
    assert.ok(b.vibration.lower < 3 && b.vibration.upper > 3);
    assert.strictEqual(b.vibration.n, 5);
});

test('baseline: LEARNING below minimumSamples, READY at/above', () => {
    const few = analytics.computeBaseline(Array.from({ length: A.minimumSamples - 1 }, () => ({ vibration: 1 })), A);
    assert.strictEqual(few.modelState, 'LEARNING');
    const enough = analytics.computeBaseline(Array.from({ length: A.minimumSamples }, (_, i) => ({ vibration: 1 + i * 0.01 })), A);
    assert.strictEqual(enough.modelState, 'READY');
    assert.strictEqual(enough.sampleCount, A.minimumSamples);
});

test('baseline: missing metrics are tolerated (null metric, no throw)', () => {
    const b = analytics.computeBaseline([{ vibration: 1 }, { vibration: 2 }], A);
    assert.strictEqual(b.temperature, null);                // no temperature anywhere
    assert.ok(b.vibration);
    assert.strictEqual(analytics.computeBaseline([], A).vibration, null);
});

// ---------------- anomaly scoring ----------------

test('scoreFromZ is monotone 0..1 across zLow..zHigh', () => {
    assert.strictEqual(analytics.scoreFromZ(0, A), 0);
    assert.strictEqual(analytics.scoreFromZ(A.zLow, A), 0);
    assert.strictEqual(analytics.scoreFromZ(A.zHigh, A), 1);
    assert.strictEqual(analytics.scoreFromZ(A.zHigh + 5, A), 1);
    const mid = analytics.scoreFromZ((A.zLow + A.zHigh) / 2, A);
    assert.ok(mid > 0 && mid < 1);
    assert.ok(analytics.scoreFromZ(4, A) < analytics.scoreFromZ(6, A));   // monotone
});

test('anomaly: normal -> low, moderate -> increased, strong -> high; vibration is primary', () => {
    const baseline = { vibration: { median: 1, mad: 0.1 }, temperature: { median: 30, mad: 1 } };
    const low = analytics.evaluate({ vibration: 1.0, temperature: 30 }, baseline, A);
    const mod = analytics.evaluate({ vibration: 1.5, temperature: 30 }, baseline, A);
    const high = analytics.evaluate({ vibration: 2.0, temperature: 30 }, baseline, A);
    assert.strictEqual(low.score, 0);
    assert.ok(mod.score > low.score, 'moderate > normal');
    assert.ok(high.score > mod.score, 'strong > moderate');
    assert.strictEqual(high.primaryDriver, 'vibration');
    assert.ok(high.drivers.vibration.z > 0);
});

test('anomaly: a temperature-only deviation is attributed to temperature', () => {
    const baseline = { vibration: { median: 1, mad: 0.1 }, temperature: { median: 30, mad: 1 } };
    const r = analytics.evaluate({ vibration: 1.0, temperature: 40 }, baseline, A);
    assert.strictEqual(r.primaryDriver, 'temperature');
    assert.ok(r.score > 0);
});

// ---------------- update gate / baseline protection ----------------

test('update gate: learns while LEARNING; after READY only when normal and quiet', () => {
    assert.strictEqual(analytics.shouldLearn('LEARNING', 'WARNING', 0.9, A), true);  // still learning
    assert.strictEqual(analytics.shouldLearn('READY', 'NORMAL', 0.1, A), true);      // normal + quiet
    assert.strictEqual(analytics.shouldLearn('READY', 'WARNING', 0.8, A), false);    // fault -> frozen
    assert.strictEqual(analytics.shouldLearn('READY', 'NORMAL', A.learningThreshold + 0.01, A), false); // too anomalous
});

// ---------------- hysteresis ----------------

test('hysteresis: single spike does not escalate; persistence does; recovery needs stability', () => {
    const st = { anomalyCandidate: null, anomalyCandidateCount: 0 };
    // one CRITICAL reading -> still NORMAL (escalationSamples not met)
    let s = analytics.stabilize('NORMAL', 'CRITICAL', st, A);
    assert.strictEqual(s, 'NORMAL', 'single spike holds');
    // sustained -> escalates once escalationSamples consecutive readings agree
    for (let i = 1; i < A.escalationSamples; i++) s = analytics.stabilize('NORMAL', 'CRITICAL', st, A);
    assert.strictEqual(s, 'CRITICAL', 'persistent anomaly escalates');
    // one normal reading -> still CRITICAL (recoverySamples not met)
    s = analytics.stabilize('CRITICAL', 'NORMAL', st, A);
    assert.strictEqual(s, 'CRITICAL', 'single quiet sample does not recover');
    for (let i = 1; i < A.recoverySamples; i++) s = analytics.stabilize('CRITICAL', 'NORMAL', st, A);
    assert.strictEqual(s, 'NORMAL', 'sustained normal recovers');
});

test('trend: STABLE / DEGRADING / IMPROVING from a window of scores', () => {
    assert.strictEqual(analytics.trendFrom([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], A), 'STABLE');
    assert.strictEqual(analytics.trendFrom([0.0, 0.0, 0.0, 0.5, 0.6, 0.7], A), 'DEGRADING');
    assert.strictEqual(analytics.trendFrom([0.7, 0.6, 0.5, 0.0, 0.0, 0.0], A), 'IMPROVING');
});

// ---------------- units ----------------

test('vibration unit follows the device: Netvox mm/s, Dragino g', () => {
    assert.strictEqual(canonical.vibrationUnit({ velocityX: 1, velocityY: 0, velocityZ: 0 }), 'mm/s');
    assert.strictEqual(canonical.vibrationUnit({ vibrationG: 0.5 }), 'g');
    assert.strictEqual(canonical.vibrationUnit({ accelerationX: 0.1 }), 'g');
});

// ---------------- bridge pipeline: the full learned arc ----------------

function mockRepos() {
    const tandem = { push: async () => ({ delivered: 'stored', points: 1 }), history: () => [], latest: () => null };
    const fusionManage = {
        upsertConditionSummary: async s => ({ written: false, mode: 'dry-run', summary: s }),
        recordConditionEvent: async e => ({ written: false, mode: 'dry-run', event: e }),
    };
    return { tandem, fusionManage };
}
let seq = 0;
function velEvent(mag, temp) {
    return canonical.createEvent({
        deviceId: 'MOTOR-DEMO-001', deviceType: 'netvox-r718e', source: 'test',
        timestamp: new Date(Date.UTC(2026, 0, 1) + (seq++) * 60000).toISOString(),
        metrics: { velocityX: mag, velocityY: 0, velocityZ: 0, temperature: temp },
    });
}

test('PIPELINE: LEARNING -> READY -> learned anomaly escalates BELOW the absolute threshold -> recovery', async () => {
    seq = 0;
    const bridge = createBridge({ config: baseConfig, ...mockRepos() });

    // Phase 1: learn this asset's normal (~1.2 mm/s, small jitter). Well below warn (4.5).
    let last;
    for (let i = 0; i < A.minimumSamples + 5; i++) last = await bridge.ingest(velEvent(1.2 + (i % 5) * 0.02, 30));
    assert.strictEqual(last.analytics.modelState, 'READY', 'model becomes READY after learning');
    assert.strictEqual(last.condition.condition, 'NORMAL');
    assert.ok(last.analytics.anomalyScore < A.observeThreshold, 'quiet while normal, score ' + last.analytics.anomalyScore);
    const learnedMedian = last.analytics.baseline.vibration.median;

    // Phase 2: a single spike must NOT escalate.
    const spike = await bridge.ingest(velEvent(2.6, 30));
    assert.strictEqual(spike.condition.condition, 'NORMAL', 'single spike holds at NORMAL');

    // Phase 3: sustained elevation at 2.6 mm/s — still BELOW the absolute warn threshold (4.5), so the
    // old threshold path alone stays NORMAL, but it is far from THIS asset's learned baseline.
    let elevated;
    for (let i = 0; i < 6; i++) elevated = await bridge.ingest(velEvent(2.6, 30));
    assert.ok(canonical.vibrationMagnitude({ velocityX: 2.6 }) < baseConfig.thresholds.vibration.warn,
        'test premise: 2.6 is below the absolute warn threshold');
    assert.ok(analytics.ORDER.indexOf(elevated.condition.condition) >= analytics.ORDER.indexOf('OBSERVE'),
        'learned baseline escalates despite no absolute-threshold crossing, got ' + elevated.condition.condition);
    assert.ok(elevated.analytics.anomalyScore > A.observeThreshold);
    assert.strictEqual(elevated.analytics.primaryDriver, 'vibration');

    // baseline protection: the fault must not have been learned as normal.
    assert.ok(Math.abs(elevated.analytics.baseline.vibration.median - learnedMedian) < 0.2,
        'baseline did not drift toward the fault');

    // Phase 4: recovery to normal. Needs sustained normal readings (hysteresis), then clears.
    let recovered;
    for (let i = 0; i < 6; i++) recovered = await bridge.ingest(velEvent(1.2 + (i % 5) * 0.02, 30));
    assert.strictEqual(recovered.condition.condition, 'NORMAL', 'recovers after sustained normal');
    assert.ok(recovered.analytics.anomalyScore < A.observeThreshold);
});

test('HISTORY BOOTSTRAP: a restart restores READY from persisted normal history (no relearn from 0)', async () => {
    // Tandem stub returning prior NORMAL points + one stored CRITICAL point that must NOT be learned.
    const points = [];
    for (let i = 0; i < A.minimumSamples + 2; i++) {
        points.push({ t: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
            metrics: { velocityX: 1.2, temperature: 30 }, vibration: 1.2, healthScore: 98, condition: 'NORMAL' });
    }
    points.push({ t: new Date(Date.UTC(2026, 0, 2)).toISOString(),
        metrics: { velocityX: 12, temperature: 70 }, vibration: 12, healthScore: 5, condition: 'CRITICAL' });
    const tandem = { push: async () => ({ delivered: 'stored' }), history: () => points, latest: () => points[points.length - 1] };
    const fusionManage = {
        upsertConditionSummary: async s => ({ mode: 'dry-run', summary: s }),
        recordConditionEvent: async e => ({ mode: 'dry-run', event: e }),
    };
    const bridge = createBridge({ config: baseConfig, tandem, fusionManage });
    const st = bridge.getAssetState('MOTOR-DEMO-001');
    assert.ok(st && st.analytics, 'cold read has an analytics snapshot');
    assert.strictEqual(st.analytics.modelState, 'READY', 'bootstrapped straight to READY');
    // The CRITICAL point was filtered out of the learned window, so learned normal stays ~1.2.
    assert.ok(Math.abs(st.analytics.baseline.vibration.median - 1.2) < 0.3, 'fault point not learned');
});
