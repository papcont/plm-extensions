// Learned-baseline analytics — Phase 1 of the predictive-maintenance path. Pure, explainable,
// hardware-independent: it only ever sees canonical amplitudes (vibration + temperature), never a
// vendor payload, so the simulator, the Dragino and any future sensor share this exact engine.
//
// It answers two questions about ONE physical asset instance:
//   1. "What is normal for THIS asset?"  -> computeBaseline(): rolling median + MAD + normal band.
//   2. "Is it behaving differently now?" -> evaluate(): robust-Z -> anomaly score 0..1 + driver.
//
// NOT ML, NOT a failure predictor, NOT RUL, NOT bearing spectral diagnostics. Robust statistics
// (median / MAD) chosen over mean/σ because sensor telemetry is spiky and the sample count is small.
// Every threshold is configurable (see config.analytics) and every number it emits is traceable.

const MAD_TO_SIGMA = 1.4826;   // scales MAD to a σ-equivalent for a normal distribution

// Defaults mirror config.analytics; evaluate/computeBaseline fall back to these per key so callers
// can pass a partial config. Kept here (not only in config.js) so the engine is self-contained+testable.
const DEFAULTS = {
    enabled           : true,
    minimumSamples    : 20,     // LEARNING below this many learned samples, READY at/above
    historyWindow     : 200,    // max learned samples kept per asset (bounds memory + the median/MAD cost)
    madFactor         : MAD_TO_SIGMA,
    bandFactor        : 3,      // normal band = median ± bandFactor · (madFactor · MAD)
    zLow              : 2,      // robustZ at/below -> score 0 (inside normal noise)
    zHigh             : 8,      // robustZ at/above -> score 1 (clearly abnormal)
    epsilonVibration  : 0.01,   // floor on the deviation scale so a near-zero MAD can't explode the score
    epsilonTemperature: 0.5,
    learningThreshold : 0.35,   // after READY, keep learning only while anomaly < this (update gate)
    observeThreshold  : 0.40,   // anomaly score -> OBSERVE
    warningThreshold  : 0.60,   // anomaly score -> WARNING
    criticalThreshold : 0.85,   // anomaly score -> CRITICAL
    escalationSamples : 3,      // consecutive worse readings required before the anomaly condition escalates
    recoverySamples   : 3,      // consecutive better readings required before it recovers
    evidenceWindowSamples: 5,
    evidenceRequiredHits : 3,
    evidenceMaxWindowMs  : 60000,
    trendWindow       : 12,     // samples compared for STABLE/IMPROVING/DEGRADING
    trendDelta        : 0.08,   // min anomaly-score change (over the window) to call a trend
    weights           : { vibration: 1, temperature: 0.6 }, // temperature is a supplementary signal
};

function cfgValue(cfg, key) {
    const v = cfg && cfg[key];
    return (v === undefined || v === null) ? DEFAULTS[key] : v;
}

function median(sorted) {
    const n = sorted.length;
    if (!n) return null;
    const mid = n >> 1;
    return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Median absolute deviation about the median — the robust analogue of standard deviation.
function mad(values, med) {
    if (!values.length) return 0;
    const dev = values.map(v => Math.abs(v - med)).sort((a, b) => a - b);
    return median(dev);
}

// Baseline stats for one metric from its learned samples. null when there are no finite samples.
function metricBaseline(values, cfg, epsilon) {
    const finite = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!finite.length) return null;
    const sorted = finite.slice().sort((a, b) => a - b);
    const med = median(sorted);
    const m = mad(finite, med);
    const sigma = Math.max(cfgValue(cfg, 'madFactor') * m, epsilon);
    const band = cfgValue(cfg, 'bandFactor') * sigma;
    return {
        median: round4(med),
        mad: round4(m),
        lower: round4(med - band),
        upper: round4(med + band),
        n: finite.length,
    };
}

// Learned baseline for an asset from its window of normal samples ({ vibration, temperature }).
// modelState is LEARNING until at least minimumSamples vibration readings are known, then READY.
function computeBaseline(learnSamples, cfg) {
    const samples = Array.isArray(learnSamples) ? learnSamples : [];
    const vib = metricBaseline(samples.map(s => s.vibration), cfg, cfgValue(cfg, 'epsilonVibration'));
    const temp = metricBaseline(samples.map(s => s.temperature), cfg, cfgValue(cfg, 'epsilonTemperature'));
    const sampleCount = vib ? vib.n : 0;
    const modelState = sampleCount >= cfgValue(cfg, 'minimumSamples') ? 'READY' : 'LEARNING';
    return { vibration: vib, temperature: temp, sampleCount, modelState };
}

// Robust deviation of `current` from a metric baseline, in MAD-sigma units.
function robustZ(current, base, cfg, epsilon) {
    if (base == null || typeof current !== 'number' || !Number.isFinite(current)) return 0;
    const sigma = Math.max(cfgValue(cfg, 'madFactor') * base.mad, epsilon);
    return Math.abs(current - base.median) / sigma;
}

// Monotone, deterministic z -> anomaly score in [0,1]: 0 at/below zLow, linearly to 1 at/above zHigh.
function scoreFromZ(z, cfg) {
    const lo = cfgValue(cfg, 'zLow'), hi = cfgValue(cfg, 'zHigh');
    if (z <= lo) return 0;
    if (z >= hi) return 1;
    return round4((z - lo) / (hi - lo));
}

// Evaluate the current reading against the learned baseline. Vibration is the primary machine-condition
// signal; temperature is supplementary (down-weighted). Returns the overall anomaly score, the driver
// that contributes most (weighted), and a per-driver breakdown — no black box, every number is shown.
function evaluate(current, baseline, cfg) {
    const weights = cfgValue(cfg, 'weights');
    const drivers = {};
    let score = 0, primaryDriver = null, bestWeighted = -1;

    for (const [name, epsilonKey, weight] of [
        ['vibration', 'epsilonVibration', weights.vibration],
        ['temperature', 'epsilonTemperature', weights.temperature],
    ]) {
        const base = baseline && baseline[name];
        const value = current && current[name];
        if (base == null || typeof value !== 'number' || !Number.isFinite(value)) continue;
        const z = robustZ(value, base, cfg, cfgValue(cfg, epsilonKey));
        const raw = scoreFromZ(z, cfg);
        drivers[name] = { score: raw, current: round4(value), median: base.median, mad: base.mad, z: round4(z) };
        const weighted = raw * weight;
        if (weighted > bestWeighted) { bestWeighted = weighted; primaryDriver = name; score = round4(Math.min(1, weighted)); }
    }
    return { score, primaryDriver, drivers };
}

// Anomaly score -> condition band. Mirrors the threshold condition's ladder but driven by how far the
// asset is from ITS OWN learned normal, not an absolute number.
function anomalyCondition(score, cfg) {
    if (score >= cfgValue(cfg, 'criticalThreshold')) return 'CRITICAL';
    if (score >= cfgValue(cfg, 'warningThreshold'))  return 'WARNING';
    if (score >= cfgValue(cfg, 'observeThreshold'))  return 'OBSERVE';
    return 'NORMAL';
}

const ORDER = ['OFF', 'NORMAL', 'OBSERVE', 'WARNING', 'CRITICAL'];

// Hysteresis/persistence debounce for the anomaly condition: a change (either direction) is only
// committed after enough consecutive readings agree, so a single spike cannot escalate and a single
// quiet sample cannot prematurely recover. Mutates `state` (candidate + count), returns the committed
// condition. escalationSamples gates getting worse; recoverySamples gates getting better.
function stabilize(stable, raw, state, cfg) {
    stable = stable || 'NORMAL';
    if (raw === stable) { state.anomalyCandidate = null; state.anomalyCandidateCount = 0; return stable; }
    const worse = ORDER.indexOf(raw) > ORDER.indexOf(stable);
    const need = worse ? cfgValue(cfg, 'escalationSamples') : cfgValue(cfg, 'recoverySamples');
    if (state.anomalyCandidate === raw) state.anomalyCandidateCount += 1;
    else { state.anomalyCandidate = raw; state.anomalyCandidateCount = 1; }
    if (state.anomalyCandidateCount >= need) {
        state.anomalyCandidate = null; state.anomalyCandidateCount = 0;
        return raw;
    }
    return stable;
}

// Learned-band evidence: three hits in the last five valid samples, inside one time window.
function stabilizeEvidence(stable, scoreSeverity, aboveBand, timestamp, state, cfg, scoreSeverityNow = scoreSeverity) {
    const window = Math.max(1, cfgValue(cfg, 'evidenceWindowSamples'));
    const required = Math.max(1, cfgValue(cfg, 'evidenceRequiredHits'));
    const maxMs = Math.max(0, cfgValue(cfg, 'evidenceMaxWindowMs'));
    const ts = Date.parse(timestamp);
    if (!Array.isArray(state.anomalyEvidence)) state.anomalyEvidence = [];
    if (Number.isFinite(ts)) state.anomalyEvidence.push({ timestamp: ts, aboveBand: !!aboveBand });
    state.anomalyEvidence = state.anomalyEvidence.slice(-window);
    if (Number.isFinite(ts)) state.anomalyEvidence = state.anomalyEvidence.filter(s => ts - s.timestamp <= maxMs);
    const hits = state.anomalyEvidence.reduce((n, s) => n + (s.aboveBand ? 1 : 0), 0);
    const inside = state.anomalyEvidence.length - hits;
    const evidenceActive = hits >= required;
    const recoveryReady = inside >= required && scoreSeverityNow === 'NORMAL';
    let next = stable || 'NORMAL';
    if (recoveryReady) next = 'NORMAL';
    else if (evidenceActive) next = worst(scoreSeverity, 'OBSERVE');
    else if (scoreSeverity !== 'NORMAL') next = scoreSeverity;
    return { condition: next, hits, samples: state.anomalyEvidence.length, evidenceActive, recoveryReady };
}

// Update gate: only fold the current reading into the learned baseline while the asset is genuinely
// normal. READY means scoring is available; baselineFrozen is the actual learning stop.
function shouldLearn(modelState, finalCondition, anomalyScore, cfg, baselineFrozen = false) {
    if (baselineFrozen || (modelState !== 'LEARNING' && modelState !== 'READY')) return false;
    return finalCondition === 'NORMAL' && anomalyScore < cfgValue(cfg, 'learningThreshold');
}

// Robust STABLE/IMPROVING/DEGRADING from a window of recent anomaly scores: compares the median of the
// older half to the newer half (not two raw points), so noise doesn't flip the label.
function trendFrom(scores, cfg) {
    const window = cfgValue(cfg, 'trendWindow');
    const recent = scores.slice(-window).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (recent.length < 4) return 'STABLE';
    const half = recent.length >> 1;
    const older = recent.slice(0, half).slice().sort((a, b) => a - b);
    const newer = recent.slice(recent.length - half).slice().sort((a, b) => a - b);
    const delta = median(newer) - median(older);
    const d = cfgValue(cfg, 'trendDelta');
    if (delta > d) return 'DEGRADING';
    if (delta < -d) return 'IMPROVING';
    return 'STABLE';
}

// Worse-of two conditions (anomaly never makes the asset look healthier than the threshold path).
function worst(a, b) {
    return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

// Anomaly score -> a 0..100 health contribution (monotone). Combined with threshold health via min().
function anomalyHealth(score) {
    return Math.round((1 - Math.max(0, Math.min(1, score))) * 100);
}

function round4(n) { return typeof n === 'number' ? parseFloat(n.toFixed(4)) : n; }

module.exports = {
    DEFAULTS, MAD_TO_SIGMA, ORDER,
    computeBaseline, robustZ, scoreFromZ, evaluate,
    anomalyCondition, stabilize, stabilizeEvidence, shouldLearn, trendFrom, worst, anomalyHealth,
    median, mad,
};
