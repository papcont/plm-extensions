// Pure display rules for the Condition Monitoring dashboard (browser global + node for tests).
// One truth: a number is shown as a number (0 -> "0.00"); missing/non-finite is "N/A", never 0 or "?".
(function (root) {
    function finite(v) { return typeof v === 'number' && isFinite(v); }
    function anomalyText(score) { return finite(score) ? score.toFixed(2) : 'N/A'; }
    // Vibration value for the "why" row; null when there is no usable value (caller prints "not available").
    function vibrationText(v, unit) { return finite(v) ? v + (unit ? ' ' + unit : '') : 'not available'; }
    // Telemetry older than staleMin is flagged; missing timestamp is not flagged (nothing to compare).
    function staleText(lastIso, nowMs, staleMin) {
        var t = Date.parse(lastIso);
        if (!isFinite(t)) return '';
        var age = Math.round((nowMs - t) / 60000);
        return age > (staleMin == null ? 15 : staleMin) ? 'stale · ' + age + ' min old' : '';
    }
    var api = { anomalyText: anomalyText, vibrationText: vibrationText, staleText: staleText };
    if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.cmFormat = api;
})(typeof window !== 'undefined' ? window : this);
