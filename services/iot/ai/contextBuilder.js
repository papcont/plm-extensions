// Builds the ONLY data the AI ever sees: an explicit allowlist of fields from the already-sanitized
// runtime state, asset and maintenance case. No FM raw responses, no credentials, no telemetry history.
// Unknown stays null (a missing anomaly score is "not available", never 0).

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function eventContext(event) {
    if (!event) return null;
    return {
        eventId: event.eventId || null,
        type: event.type || null,
        from: event.from || null,
        to: event.to || null,
        severity: event.severity || null,
        timestamp: event.timestamp || null,
        detectedAt: event.detectedAt || null,
        anomalyScore: num(event.anomalyScore),
        primaryDriver: event.primaryDriver || null,
        reason: event.reason || null,
        status: event.status || null,
    };
}

function buildContext({ state, asset, kase, now = Date.now() }) {
    const s = (state && state.summary) || {};
    const a = (state && state.analytics) || {};
    const vib = (a.baseline && a.baseline.vibration) || {};
    const temp = (a.baseline && a.baseline.temperature) || {};
    const lastAt = s.lastTelemetry || null;
    const ageMin = lastAt ? Math.round((now - Date.parse(lastAt)) / 60000) : null;
    const events = Array.isArray(state && state.events) ? state.events : [];

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
            baselineEpoch: a.baselineEpoch || null,
            frozen: a.baselineFrozen === true,
            frozenAt: a.baselineFrozenAt || null,
            vibrationMedianG: num(vib.median),
            vibrationMadG: num(vib.mad),
            // The lower band edge can be negative mathematically; amplitude cannot.
            vibrationNormalBandG: vib.upper != null ? [Math.max(0, num(vib.lower) || 0), num(vib.upper)] : null,
            temperatureMedianC: num(temp.median),
            temperatureMadC: num(temp.mad),
            sampleCount: num(a.sampleCount),
        },
        latestDurableConditionEvent: eventContext(events[events.length - 1]),
        recentDurableConditionEvents: events.slice(-5).reverse().map(eventContext),
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
