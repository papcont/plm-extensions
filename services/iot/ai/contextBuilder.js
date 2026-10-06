// Builds the ONLY data the AI ever sees: an explicit allowlist of fields from the already-sanitized
// runtime state, asset and maintenance case. No FM raw responses, no credentials, no telemetry history.
// Unknown stays null (a missing anomaly score is "not available", never 0).

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function buildContext({ state, asset, kase, now = Date.now() }) {
    const s = (state && state.summary) || {};
    const a = (state && state.analytics) || {};
    const vib = (a.baseline && a.baseline.vibration) || {};
    const temp = (a.baseline && a.baseline.temperature) || {};
    const lastAt = s.lastTelemetry || null;
    const ageMin = lastAt ? Math.round((now - Date.parse(lastAt)) / 60000) : null;

    return {
        asset: { id: (asset && asset.id) || null, title: (asset && asset.title) || null },
        currentMachineState: {
            condition: s.condition || (state && state.condition) || null,
            health: num(s.healthScore),
            anomalyScore: num(a.anomalyScore),
            modelState: a.modelState || null,
            primaryDriver: a.primaryDriver || null,
            vibrationG: num(s.vibration),
            temperatureC: num(s.temperature),
            humidityPct: num(s.humidity),
            trend: a.trend || null,
            lastTelemetryAt: lastAt,
            dataAgeMinutes: ageMin,
        },
        learnedBaseline: {
            vibrationMedianG: num(vib.median),
            // The lower band edge can be negative mathematically; amplitude cannot.
            vibrationNormalBandG: vib.upper != null ? [Math.max(0, num(vib.lower) || 0), num(vib.upper)] : null,
            temperatureMedianC: num(temp.median),
            sampleCount: num(a.sampleCount),
        },
        historicalDetection: kase ? {
            anomalyAtDetection: num(kase.anomalyAtDetection),
            primaryDriver: kase.primaryDriver || null,
            conditionEventId: kase.conditionEventId || null,
        } : null,
        maintenanceCase: kase ? {
            caseId: kase.caseId || null,
            workflow: kase.workflow || null,
            urgency: kase.urgency || null,
            assessment: kase.assessment || null,
            confirmedCause: kase.confirmedCause || null,
        } : null,
        limitations: [
            'Vibration is peak acceleration amplitude in g (Dragino LHT65N-VIB), not vibration velocity in mm/s.',
            'No FFT/spectrum, no bearing-frequency analysis, no measured RPM or load context.',
            'Single sensor; learned baseline from ' + (num(a.sampleCount) || 0) + ' samples.',
            ageMin == null ? 'Telemetry age unknown.' : 'Latest telemetry is ' + ageMin + ' minutes old.',
        ],
    };
}

module.exports = { buildContext };
