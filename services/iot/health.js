// Health score (0-100) from canonical metrics vs configurable baseline/warn/critical thresholds.
// Transparent and configurable — NOT ML, NOT universal physical truth. Weakest-link model:
// each monitored metric gets a 0-100 sub-score, overall health = the worst one. A short trend
// (recent slope of the worst driver) nudges the score so a rising fault is flagged a bit earlier.

const { vibrationMagnitude } = require('./canonical');

// Map a value to 0-100 given {baseline, warn, critical}: 100 at/below baseline, 50 at warn,
// 0 at/above critical, linear between. Higher value = worse (vibration, temperature).
function subScore(value, t) {
    if (value <= t.baseline) return 100;
    if (value <= t.warn)     return 100 - 50 * (value - t.baseline) / (t.warn - t.baseline);
    if (value <  t.critical) return 50  - 50 * (value - t.warn)     / (t.critical - t.warn);
    return 0; // at/above critical (avoids a float residue at value === critical)
}

// metrics: canonical metrics object. thresholds: config.thresholds. history: optional array of
// prior { vibration } samples (most recent last) for the trend nudge. Returns a full breakdown.
function compute(metrics, thresholds, history = []) {
    const vibration = vibrationMagnitude(metrics);
    const temperature = metrics.temperature;

    const drivers = {
        vibration   : subScore(vibration, thresholds.vibration),
    };
    if (typeof temperature === 'number') {
        drivers.temperature = subScore(temperature, thresholds.temperature);
    }

    let score = Math.min(...Object.values(drivers));

    // Trend: if the recent vibration slope is clearly rising, dock up to 5 points (early warning).
    const trend = vibrationTrend(history, vibration);
    if (trend > 0) score -= Math.min(5, trend * 5);

    score = Math.max(0, Math.min(100, Math.round(score)));
    const worst = Object.entries(drivers).sort((a, b) => a[1] - b[1])[0][0];
    return { score, drivers, vibration: round2(vibration), temperature, worstDriver: worst, trend: round2(trend) };
}

// Normalized rising slope 0..1 over the last few samples (0 = flat/falling).
function vibrationTrend(history, current) {
    const recent = history.slice(-5).map(h => h.vibration).filter(v => typeof v === 'number');
    if (recent.length < 2) return 0;
    const first = recent[0], last = current;
    if (last <= first) return 0;
    return Math.min(1, (last - first) / Math.max(first, 1));
}

function round2(n) { return typeof n === 'number' ? parseFloat(n.toFixed(2)) : n; }

module.exports = { compute, subScore };
