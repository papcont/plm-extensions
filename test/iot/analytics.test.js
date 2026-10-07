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

test('update gate: learns through READY until the baseline is frozen', () => {
    assert.strictEqual(analytics.shouldLearn('LEARNING', 'WARNING', 0.9, A), false); // guardrail/anomaly is not learned
    assert.strictEqual(analytics.shouldLearn('LEARNING', 'NORMAL', 0.1, A), true);    // valid learning sample
    assert.strictEqual(analytics.shouldLearn('READY', 'NORMAL', 0.1, A), true);        // READY still matures
    assert.strictEqual(analytics.shouldLearn('READY', 'NORMAL', 0.1, A, true), false); // frozen means no learning
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

test('learned evidence: two timestamped crossings within 180 seconds escalate once and recover', () => {
    const cfg = Object.assign({}, A, { evidenceRequiredHits: 2, evidenceMaxWindowMs: 180000 });
    const t = seconds => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
    const st = {};
    let r = analytics.stabilizeEvidence('NORMAL', 'NORMAL', true, t(0), st, cfg);
    assert.strictEqual(r.condition, 'NORMAL');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, t(120), st, cfg);
    assert.strictEqual(r.condition, 'OBSERVE');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, t(130), st, cfg);
    assert.strictEqual(r.condition, 'OBSERVE', 'active episode does not re-escalate');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false, t(140), st, cfg);
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false, t(150), st, cfg);
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false, t(160), st, cfg);
    assert.strictEqual(r.condition, 'NORMAL');
    const late = {};
    analytics.stabilizeEvidence('NORMAL', 'NORMAL', true, t(0), late, cfg);
    r = analytics.stabilizeEvidence('NORMAL', 'NORMAL', true, t(181), late, cfg);
    assert.strictEqual(r.condition, 'NORMAL', 'evidence older than 180 seconds expires');
    assert.strictEqual(r.hits, 1);
});

test('learned evidence replay: validated normal reference creates no events', () => {
    const cfg = Object.assign({}, A, { evidenceRequiredHits: 2, evidenceMaxWindowMs: 180000 });
    const st = {};
    const start = Date.parse('2026-10-07T11:32:08.451Z');
    let r = { condition: 'NORMAL' };
    for (let i = 0; i < 200; i++) {
        r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false,
            new Date(start + i * 10000).toISOString(), st, cfg);
    }
    assert.strictEqual(r.condition, 'NORMAL');
    assert.strictEqual(r.hits, 0);
    assert.strictEqual(r.evidenceActive, false);
});

test('learned evidence replay: the real 12.5 V crossings trigger at the third crossing', () => {
    const cfg = Object.assign({}, A, { evidenceRequiredHits: 2, evidenceMaxWindowMs: 180000 });
    const st = {};
    const crossings = [
        '2026-10-07T12:30:24.811Z',
        '2026-10-07T12:35:33.724Z',
        '2026-10-07T12:37:33.701Z',
    ];
    let r = analytics.stabilizeEvidence('NORMAL', 'NORMAL', true, crossings[0], st, cfg);
    assert.strictEqual(r.condition, 'NORMAL');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, crossings[1], st, cfg);
    assert.strictEqual(r.condition, 'NORMAL', 'first two crossings are more than 180 seconds apart');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, crossings[2], st, cfg);
    assert.strictEqual(r.condition, 'OBSERVE');
    assert.strictEqual(crossings[2], '2026-10-07T12:37:33.701Z');
});

test('learned evidence: crossing during recovery cancels recovery', () => {
    const cfg = Object.assign({}, A, { evidenceRequiredHits: 2, evidenceMaxWindowMs: 180000 });
    const st = {};
    const t = seconds => new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();
    let r = analytics.stabilizeEvidence('NORMAL', 'NORMAL', true, t(0), st, cfg);
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, t(60), st, cfg);
    assert.strictEqual(r.condition, 'OBSERVE');
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false, t(70), st, cfg);
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', false, t(80), st, cfg);
    r = analytics.stabilizeEvidence(r.condition, 'NORMAL', true, t(90), st, cfg);
    assert.strictEqual(r.condition, 'OBSERVE');
    assert.strictEqual(r.recoveryReady, false);
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
        timestamp: new Date(Date.UTC(2026, 0, 1) + (seq++) * 10000).toISOString(),
        metrics: { velocityX: mag, velocityY: 0, velocityZ: 0, temperature: temp },
    });
}

test('PIPELINE: LEARNING -> READY -> learned anomaly escalates BELOW the absolute threshold -> recovery', async () => {
    seq = 0;
    const config = Object.assign({}, baseConfig, { analytics: Object.assign({}, baseConfig.analytics, { historyWindow: A.minimumSamples }) });
    const frozenBaselines = { get: () => null, freeze: () => ({}) };
    const bridge = createBridge({ config, baselines: frozenBaselines, ...mockRepos() });

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
    assert.ok(canonical.vibrationMagnitude({ velocityX: 2.6 }) < config.thresholds.vibration.warn,
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

// ---------------- review regressions: restart hysteresis + bootstrap trust ----------------

function iso(i) { return new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(); }
function tandemStub(points) {
    return {
        tandem: { push: async () => ({ delivered: 'stored' }), history: () => points,
                  latest: () => (points.length ? points[points.length - 1] : null) },
        fusionManage: { upsertConditionSummary: async s => ({ mode: 'dry-run', summary: s }),
                        recordConditionEvent: async e => ({ mode: 'dry-run', event: e }) },
    };
}
function normalPoints(n, device) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ t: iso(i), metrics: { velocityX: 1.2, temperature: 30 },
        vibration: 1.2, healthScore: 98, condition: 'NORMAL', deviceId: device });
    return pts;
}
function liveNormal(device, i) {
    return canonical.createEvent({ deviceId: device, source: 'test', timestamp: iso(i),
        metrics: { velocityX: 1.2, velocityY: 0, velocityZ: 0, temperature: 30 } });
}

// P1: a threshold-driven WARNING/CRITICAL in history must NOT seed analytics recovery hysteresis on
// restart. The first genuinely-normal reading must recover immediately, not be held for recoverySamples.
for (const storedSeverity of ['WARNING', 'CRITICAL']) {
    test('P1 regression: threshold-driven ' + storedSeverity + ' in history does not stick after restart', async () => {
        const device = 'P1-' + storedSeverity;
        const points = normalPoints(baseConfig.analytics.minimumSamples + 2, device);
        // Latest stored point: threshold-driven severity (high vibration); analytics was NEVER elevated.
        const sev = storedSeverity === 'CRITICAL' ? 12 : 6;
        points.push({ t: iso(100), metrics: { velocityX: sev, temperature: 30 }, vibration: sev,
            healthScore: storedSeverity === 'CRITICAL' ? 5 : 40, condition: storedSeverity, deviceId: device });

        const bridge = createBridge({ config: baseConfig, ...tandemStub(points) });
        const cold = bridge.getAssetState(device);
        assert.strictEqual(cold.condition, storedSeverity, 'business condition restored from history');
        assert.strictEqual(cold.analytics.modelState, 'READY', 'baseline bootstrapped from the NORMAL history');

        // One clearly-normal live reading. With the bug (anomalyStable restored from the stored
        // condition) final would stay ' + storedSeverity + ' for recoverySamples. It must be NORMAL now.
        const r = await bridge.ingest(liveNormal(device, 101));
        assert.strictEqual(r.condition.condition, 'NORMAL',
            'first normal sample recovers immediately (analytics hysteresis started from NORMAL)');
        assert.ok(r.analytics.anomalyScore < baseConfig.analytics.observeThreshold, 'anomaly low on the normal reading');
        assert.ok(r.conditionEvent && r.conditionEvent.type === 'RECOVERY', 'emits a RECOVERY event, not a stale hold');
    });
}

// P2: automatic bootstrap learns ONLY explicitly NORMAL points. An unlabelled abnormal point between two
// NORMAL points must be excluded so it cannot move the learned median/MAD/band.
test('P2 regression: unlabelled abnormal history point is excluded from the baseline bootstrap', async () => {
    const device = 'P2';
    const points = [
        { t: iso(0), metrics: { velocityX: 1.0, temperature: 30 }, vibration: 1.0, healthScore: 99, condition: 'NORMAL', deviceId: device },
        { t: iso(1), metrics: { velocityX: 10, temperature: 30 }, vibration: 10, healthScore: 10, /* no condition label */ deviceId: device },
        { t: iso(2), metrics: { velocityX: 1.2, temperature: 30 }, vibration: 1.2, healthScore: 99, condition: 'NORMAL', deviceId: device },
    ];
    const bridge = createBridge({ config: baseConfig, ...tandemStub(points) });
    const st = bridge.getAssetState(device);
    const vb = st.analytics.baseline.vibration;
    assert.strictEqual(vb.n, 2, 'only the two explicitly-NORMAL points were learned (abnormal unlabelled excluded)');
    assert.ok(vb.median >= 1.0 && vb.median <= 1.2, 'median reflects only the normal points, got ' + vb.median);
    assert.ok(vb.upper < 10, 'the abnormal 10 g point cannot reach the learned normal band');
});

// Edge D: only unlabelled history -> no trusted bootstrap -> LEARNING with zero learned samples.
test('bootstrap edge: only unlabelled history -> LEARNING, nothing learned', async () => {
    const device = 'D';
    const points = [];
    for (let i = 0; i < baseConfig.analytics.minimumSamples + 5; i++) {
        points.push({ t: iso(i), metrics: { velocityX: 1.2, temperature: 30 }, vibration: 1.2, healthScore: 98, deviceId: device });
    }
    const bridge = createBridge({ config: baseConfig, ...tandemStub(points) });
    const st = bridge.getAssetState(device);
    assert.strictEqual(st.analytics.modelState, 'LEARNING', 'unlabelled history is not trusted for bootstrap');
    assert.strictEqual(st.analytics.sampleCount, 0, 'nothing learned from unlabelled history');
});

// Edges E/F: labelled-NORMAL count drives LEARNING vs READY.
test('bootstrap edge: < minimumSamples NORMAL -> LEARNING; >= minimumSamples NORMAL -> READY', async () => {
    const few = createBridge({ config: baseConfig, ...tandemStub(normalPoints(baseConfig.analytics.minimumSamples - 1, 'E')) });
    const stFew = few.getAssetState('E');
    assert.strictEqual(stFew.analytics.modelState, 'LEARNING');
    assert.strictEqual(stFew.analytics.sampleCount, baseConfig.analytics.minimumSamples - 1);

    const enough = createBridge({ config: baseConfig, ...tandemStub(normalPoints(baseConfig.analytics.minimumSamples, 'F')) });
    const stEnough = enough.getAssetState('F');
    assert.strictEqual(stEnough.analytics.modelState, 'READY');
    assert.strictEqual(stEnough.analytics.sampleCount, baseConfig.analytics.minimumSamples);
});
