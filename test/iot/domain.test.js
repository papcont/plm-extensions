// Domain layer: simulator determinism, health scoring, condition evaluation.
const { test } = require('node:test');
const assert = require('node:assert');

const simulator = require('../../services/iot/simulator');
const health = require('../../services/iot/health');
const condition = require('../../services/iot/condition');
const config = require('../../services/iot/config');

const T = config.thresholds;
const B = config.conditionBands;

test('simulator readingAt is deterministic for a given tick index', () => {
    const a = simulator.readingAt(simulator.DEFAULT_SCENARIO, 7);
    const b = simulator.readingAt(simulator.DEFAULT_SCENARIO, 7);
    assert.deepStrictEqual(a, b);
    const c = simulator.readingAt(simulator.DEFAULT_SCENARIO, 8);
    assert.notDeepStrictEqual(a, c);
});

test('simulator states produce the documented vibration/temperature trends', () => {
    // First HEALTHY segment vs the CRITICAL segment.
    const healthyIdx = 2;
    const criticalScenario = [{ state: 'CRITICAL', ticks: 5 }];
    const healthy = simulator.readingAt(simulator.DEFAULT_SCENARIO, healthyIdx);
    const critical = simulator.readingAt(criticalScenario, 2);
    const mag = r => Math.hypot(r.velocityX, r.velocityY, r.velocityZ);
    assert.ok(mag(healthy) < T.vibration.warn, 'healthy below warn');
    assert.ok(mag(critical) >= T.vibration.critical, 'critical at/above critical');
});

test('health subScore hits the documented anchor points', () => {
    assert.strictEqual(health.subScore(T.vibration.baseline, T.vibration), 100);
    assert.strictEqual(health.subScore(T.vibration.warn, T.vibration), 50);
    assert.strictEqual(health.subScore(T.vibration.critical, T.vibration), 0);
    assert.strictEqual(health.subScore(3.0, T.vibration), 75); // baseline1.5 warn4.5 -> midpoint
});

test('health picks the weakest driver', () => {
    const h = health.compute({ velocityX: 3.0, velocityY: 0, velocityZ: 0, temperature: 40 }, T);
    assert.strictEqual(h.worstDriver, 'vibration');
    assert.strictEqual(h.score, 75);
});

test('health trend docks points when vibration is clearly rising', () => {
    const rising = [{ vibration: 1.0 }, { vibration: 1.5 }, { vibration: 2.0 }, { vibration: 2.5 }];
    const flat = health.compute({ velocityX: 3.0, temperature: 40 }, T);
    const withTrend = health.compute({ velocityX: 3.0, temperature: 40 }, T, rising);
    assert.ok(withTrend.score < flat.score);
});

test('condition maps threshold crossings intuitively', () => {
    const c = (vib, temp) => condition.evaluate(
        health.compute({ velocityX: vib, temperature: temp }, T).score,
        { velocityX: vib, temperature: temp }, T, B).condition;
    assert.strictEqual(c(1.2, 35), 'NORMAL');
    assert.strictEqual(c(5.0, 40), 'WARNING');   // vib past warn 4.5
    assert.strictEqual(c(8.0, 40), 'CRITICAL');  // vib past critical 7.1
    assert.strictEqual(c(1.0, 62), 'WARNING');   // temp past warn 60
    assert.strictEqual(c(1.0, 80), 'CRITICAL');  // temp past critical 75
    assert.strictEqual(c(0.0, 22), 'OFF');       // no signal
    const uncertainActivity = condition.evaluate(100, { vibrationG: 0, temperature: 22 }, T, B, { allowOff: false });
    assert.strictEqual(uncertainActivity.condition, 'NORMAL');
});

test('condition isEscalation orders severities', () => {
    assert.strictEqual(condition.isEscalation('NORMAL', 'WARNING'), true);
    assert.strictEqual(condition.isEscalation('CRITICAL', 'NORMAL'), false);
});
