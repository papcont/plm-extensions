// Condition evaluation: raw metrics + health score -> OFF / NORMAL / OBSERVE / WARNING / CRITICAL.
// WARNING/CRITICAL track *threshold crossings* (actionable and intuitive: a metric past its warn
// band is WARNING, past critical is CRITICAL). NORMAL vs OBSERVE is split by the continuous health
// score (early drift before any threshold is crossed). All bands/thresholds are configurable.

const { vibrationMagnitude } = require('./canonical');

const ORDER = ['OFF', 'NORMAL', 'OBSERVE', 'WARNING', 'CRITICAL'];

function evaluate(health, metrics, thresholds, bands) {
    const vibration = vibrationMagnitude(metrics);
    const temperature = metrics.temperature;
    const hasTemp = typeof temperature === 'number';

    // OFF: essentially no vibration and near-ambient — machine not running.
    if (vibration < thresholds.vibration.baseline * 0.2 &&
        (!hasTemp || temperature <= thresholds.temperature.baseline * 0.7)) {
        return { condition: 'OFF', reason: 'no vibration signal (machine off)' };
    }

    if (vibration >= thresholds.vibration.critical) {
        return { condition: 'CRITICAL', reason: 'vibration ' + round1(vibration) + ' mm/s >= critical ' + thresholds.vibration.critical };
    }
    if (hasTemp && temperature >= thresholds.temperature.critical) {
        return { condition: 'CRITICAL', reason: 'temperature ' + round1(temperature) + ' °C >= critical ' + thresholds.temperature.critical };
    }
    if (vibration >= thresholds.vibration.warn) {
        return { condition: 'WARNING', reason: 'vibration ' + round1(vibration) + ' mm/s >= warn ' + thresholds.vibration.warn };
    }
    if (hasTemp && temperature >= thresholds.temperature.warn) {
        return { condition: 'WARNING', reason: 'temperature ' + round1(temperature) + ' °C >= warn ' + thresholds.temperature.warn };
    }

    // Below all warn thresholds: split NORMAL vs OBSERVE on the continuous health score.
    if (health < bands.observe) return { condition: 'OBSERVE', reason: 'early drift, health score ' + health };
    return { condition: 'NORMAL', reason: 'within limits, health score ' + health };
}

// True when moving to `next` is an escalation (worse) vs `prev` — used to decide when to emit events.
function isEscalation(prev, next) {
    return ORDER.indexOf(next) > ORDER.indexOf(prev);
}

function round1(n) { return parseFloat(n.toFixed(1)); }

module.exports = { evaluate, isEscalation, ORDER };
