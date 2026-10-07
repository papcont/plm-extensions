// IoT Bridge — the one application service between the device-adapter boundary and the Autodesk
// integrations. It is transport/vendor agnostic: it only ever receives *canonical* events.
//   validate -> identify device -> map to asset -> merge/normalize -> dedupe -> health -> condition
//   -> emit condition events on escalation/recovery -> Tandem (time series) + Fusion Manage (state).
// No Autodesk-specific logic lives here beyond calling the injected repositories.

const crypto = require('node:crypto');
const canonical = require('./canonical');
const health = require('./health');
const condition = require('./condition');
const analytics = require('./analytics');
const { EVENT_SCHEMA_VERSION } = require('./eventRepository');
const { createRegistry } = require('./deviceRegistry');

function createBridge({ config, tandem, fusionManage, events = null, baselines = null, resolveDeviceAsset = null, logger = console }) {
    const registry = createRegistry(config.deviceAssetMap, resolveDeviceAsset);
    const assets = new Map(); // assetId -> { mergedMetrics, condition, health, history[], events[], last }

    async function ingest(event) {
        // 1. validate untrusted input
        const check = canonical.validate(event);
        if (!check.valid) {
            log(logger, { stage: 'validation', error: check.errors.join('; '), deviceId: event && event.deviceId });
            return { accepted: false, stage: 'validation', errors: check.errors };
        }

        // 2/3. identify + map to asset (bridge is authoritative on asset id). ensure() lets an
        // injected resolver learn a real device's asset from Fusion Manage before we resolve.
        await registry.ensure(event.deviceId);
        const assetId = registry.resolveAsset(event.deviceId);

        // 4. dedupe
        if (registry.isDuplicate(event.deviceId, event.timestamp)) {
            return { accepted: false, stage: 'dedupe', reason: 'duplicate timestamp' };
        }
        registry.markSeen(event.deviceId, event.timestamp);

        // 5. merge metrics (a device sends velocity+temp and acceleration in separate frames)
        const state = assets.get(assetId) || restoreAssetState(assetId);
        state.mergedMetrics = Object.assign({}, state.mergedMetrics, event.metrics);
        const metrics = state.mergedMetrics;

        // VIBMOD=4 supplies sparse acceleration samples, not a reliable running/stopped signal.
        // Do not manufacture OFF states from a single low sample, and hide prior OFF/NORMAL flaps
        // produced before this distinction existed. Raw telemetry remains untouched.
        const allowOff = !event.meta || event.meta.activityInference !== 'unsupported';
        if (!allowOff) {
            state.events = state.events.filter(event => event.severity !== 'OFF' && event.from !== 'OFF');
            if (state.condition === 'OFF') state.condition = null;
            if (state.last) state.last.lastEvent = state.events.length ? state.events[state.events.length - 1].timestamp : null;
        }

        // 6. threshold health + condition (unchanged, absolute-band based — the proven baseline path)
        let h = health.compute(metrics, config.thresholds, state.history);
        const thresholdScore = h.score;
        const c = condition.evaluate(h.score, metrics, config.thresholds, config.conditionBands, { allowOff });

        // 6b. learned-baseline analytics on top: compare this reading to what is normal FOR THIS asset.
        // Never makes the asset look healthier than the threshold path; adds early, explainable detection
        // of "different from its own normal" before any absolute band is crossed. Skipped while OFF so a
        // stopped machine (vibration ~0, far below its running median) is not flagged as anomalous.
        const analyticsResult = evaluateAnalytics(state, metrics, h, c.condition, allowOff, assetId, event.timestamp);
        h = analyticsResult.health;                      // effective health = min(threshold, anomaly) health
        const finalCondition = analyticsResult.finalCondition;
        const analyticsSnapshot = analyticsResult.snapshot;

        // 7. condition event on any change after the first reading (skip initial NORMAL establishment).
        // Uses the FINAL (threshold ∨ learned-anomaly) condition; reason names whichever drove it.
        // Enriched (schemaVersion, from/to, telemetry snapshot + learned baseline ref + telemetry window)
        // so a later maintenance case can reference it without re-deriving. Existing fields are preserved
        // for back-compat; new fields are additive. Persisted to the durable event repo (if injected).
        let conditionEvent = null;
        if (finalCondition !== state.condition && state.condition !== null) {
            // metrics snapshot — only include values actually present (no invented humidity/temperature).
            const metricsRef = {
                vibration    : h.vibration,
                vibrationUnit: analyticsSnapshot ? analyticsSnapshot.unit : canonical.vibrationUnit(metrics),
            };
            if (typeof metrics.temperature === 'number') metricsRef.temperature = metrics.temperature;
            if (typeof metrics.humidity === 'number') metricsRef.humidity = metrics.humidity;
            // learned-baseline reference — only the parts the engine actually has.
            let baselineRef = null;
            if (analyticsSnapshot) {
                baselineRef = { modelState: analyticsSnapshot.modelState, sampleCount: analyticsSnapshot.sampleCount };
                if (analyticsSnapshot.baseline && analyticsSnapshot.baseline.vibration) baselineRef.vibration = analyticsSnapshot.baseline.vibration;
                if (analyticsSnapshot.baseline && analyticsSnapshot.baseline.temperature) baselineRef.temperature = analyticsSnapshot.baseline.temperature;
            }
            // telemetry window: fromTs = previous telemetry timestamp, toTs = the reading that triggered the
            // transition. The bridge only knows discrete reading timestamps, so this is the interval between
            // the prior and current readings — not a continuous sampling window. fromTs omitted if unknown.
            const prevTs = state.history.length ? state.history[state.history.length - 1].t : null;
            const telemetryWindowRef = { toTs: event.timestamp };
            if (prevTs) telemetryWindowRef.fromTs = prevTs;

            conditionEvent = {
                schemaVersion: EVENT_SCHEMA_VERSION,                 // durable v1 shape
                eventId    : crypto.randomUUID(),
                assetId,
                deviceId   : event.deviceId,
                type       : condition.isEscalation(state.condition || 'OFF', finalCondition) ? 'ESCALATION' : 'RECOVERY',
                from       : state.condition || null,
                severity   : finalCondition,                        // retained: consumers (UI/tandem) depend on it
                to         : finalCondition,
                timestamp  : event.timestamp,
                detectedAt : event.timestamp,
                healthScore: h.score,
                anomalyScore : analyticsSnapshot ? analyticsSnapshot.anomalyScore : null,
                primaryDriver: analyticsSnapshot ? analyticsSnapshot.primaryDriver : null,
                reason     : analyticsResult.drivenByAnomaly ? analyticsResult.anomalyReason : c.reason,
                status     : 'OPEN',                                // always OPEN at 2A-1; LINKED/CLOSED are for Phase 2A cases
                metrics    : metricsRef,
                baselineRef,
                telemetryWindowRef,
            };
            state.events.push(conditionEvent);
            if (events) await events.append(conditionEvent);        // durable, idempotent, restart-safe; logs if not durable
        }

        // 8. persist: Tandem (time series) always; Fusion Manage summary + events (gated in repo)
        const tandemResult = await tandem.push(assetId, event.timestamp, metrics, h.score, {
            deviceId: event.deviceId,
            deviceType: event.deviceType,
            source: event.source,
            fPort: event.meta && event.meta.fPort,
            vibrationModel: event.meta && event.meta.vibrationModel,
            activityInference: event.meta && event.meta.activityInference,
            observedMetrics: Object.keys(event.metrics),
            condition: finalCondition,
            conditionEvent,
            vibration: h.vibration,
        });
        const summary = {
            assetId, deviceId: event.deviceId,
            condition: finalCondition, healthScore: h.score,
            vibration: h.vibration, temperature: metrics.temperature, humidity: metrics.humidity,
            activityInference: event.meta && event.meta.activityInference,
            lastTelemetry: event.timestamp,
            lastEvent: conditionEvent ? conditionEvent.timestamp : (state.last && state.last.lastEvent) || null,
            tandemRef: assetId,
        };
        const fmSummaryResult = await fusionManage.upsertConditionSummary(summary);
        let fmEventResult = null;
        if (conditionEvent) fmEventResult = await fusionManage.recordConditionEvent(conditionEvent);

        // update in-memory state
        state.condition = finalCondition;
        state.health = h;
        state.last = summary;
        state.analytics = analyticsSnapshot;
        state.history.push({ t: event.timestamp, vibration: h.vibration, health: h.score, temperature: metrics.temperature });
        if (state.history.length > 5000) state.history.splice(0, state.history.length - 5000);
        assets.set(assetId, state);

        // 9. structured log (no secrets, no raw payloads)
        log(logger, {
            stage: 'ingested', deviceId: event.deviceId, assetId, eventId: event.eventId,
            timestamp: event.timestamp, source: event.source,
            condition: finalCondition, healthScore: h.score,
            modelState: analyticsSnapshot ? analyticsSnapshot.modelState : null,
            anomalyScore: analyticsSnapshot ? analyticsSnapshot.anomalyScore : null,
            tandemResult: tandemResult.delivered, fusionManageResult: fmSummaryResult.mode,
            conditionEvent: conditionEvent ? conditionEvent.type + ':' + conditionEvent.severity : null,
        });

        return {
            accepted: true, assetId, health: h,
            condition: { condition: finalCondition, reason: conditionEvent ? conditionEvent.reason : c.reason },
            analytics: analyticsSnapshot,
            conditionEvent, summary, tandemResult, fmSummaryResult, fmEventResult,
        };
    }

    // Run the learned-baseline analytics for one reading and fold it into health + condition. Pure w.r.t.
    // the engine; mutates only `state` (learned-sample window, evidence window, score history).
    // Returns the effective health, the final condition, a UI snapshot, and the anomaly reason/flag.
    function evaluateAnalytics(state, metrics, h, thresholdCondition, allowOff, assetId, timestamp) {
        const A = config.analytics;
        if (!A || !A.enabled || thresholdCondition === 'OFF') {
            return { health: h, finalCondition: thresholdCondition, snapshot: null, drivenByAnomaly: false, anomalyReason: null };
        }
        if (!state.learnSamples) initAnalyticsState(state);

        let baseline = analytics.computeBaseline(state.learnSamples, A);
        const current = { vibration: h.vibration, temperature: metrics.temperature };
        let evalRes = { score: 0, primaryDriver: null, drivers: {} };
        let stable = state.anomalyStable || 'NORMAL';
        let evidence = { hits: 0, samples: 0, evidenceActive: false, recoveryReady: false };
        if (baseline.modelState === 'READY') {
            evalRes = analytics.evaluate(current, baseline, A);
            // READY enables scoring; learned severity/evidence stays inert until the reference is mature.
            if (state.baselineFrozen) {
                const scoreSeverity = analytics.anomalyCondition(evalRes.score, A);
                state.anomalyScoreStable = analytics.stabilize(state.anomalyScoreStable || 'NORMAL', scoreSeverity, state, A);
                const aboveBand = baseline.vibration && h.vibration > baseline.vibration.upper;
                evidence = analytics.stabilizeEvidence(stable, state.anomalyScoreStable, aboveBand, timestamp, state, A, scoreSeverity);
                stable = evidence.condition;
            }
        }
        state.anomalyStable = stable;

        const finalCondition = analytics.worst(thresholdCondition, stable);
        const effHealth = Math.min(h.score, analytics.anomalyHealth(evalRes.score));

        state.scoreHistory.push(evalRes.score);
        if (state.scoreHistory.length > 50) state.scoreHistory.splice(0, state.scoreHistory.length - 50);
        const trend = analytics.trendFrom(state.scoreHistory, A);

        // update gate: only learn genuinely-normal readings so a developing fault can't rewrite normal.
        // A reading the ABSOLUTE guardrails flag (>= warn / critical, or an early-drift OBSERVE) is never a
        // normal reference — not even while LEARNING, which otherwise accepts everything.
        if (thresholdCondition === 'NORMAL' && analytics.shouldLearn(baseline.modelState, finalCondition, evalRes.score, A, state.baselineFrozen)) {
            state.learnSamples.push(current);
            if (state.learnSamples.length > A.historyWindow) {
                state.learnSamples.splice(0, state.learnSamples.length - A.historyWindow);
            }
        }

        // READY enables scoring; the configured history window is the maturity target. Freeze only there;
        // explicit rebaseline() is the sole path that may replace a frozen reference.
        if (!state.baselineFrozen) {
            baseline = analytics.computeBaseline(state.learnSamples, A);
            const freezeTarget = Math.max(A.minimumSamples, A.historyWindow);
            if (state.learnSamples.length >= freezeTarget) {
                state.baselineFrozenAt = new Date(timestamp).toISOString();
                try {
                    if (!baselines || !baselines.freeze) throw new Error('BASELINE_FREEZE_NOT_DURABLE');
                    baselines.freeze(assetId, { frozenAt: state.baselineFrozenAt, samples: state.learnSamples, baseline });
                    state.baselineFrozen = true;
                } catch (err) {
                    state.baselineFrozenAt = null;
                    log(logger, { stage: 'baseline-freeze', assetId, error: err.message });
                }
            }
        }

        const drivenByAnomaly = analytics.ORDER.indexOf(stable) > analytics.ORDER.indexOf(thresholdCondition);
        const snapshot = {
            modelState   : baseline.modelState,
            sampleCount  : baseline.sampleCount,
            minimumSamples: A.minimumSamples,
            baselineEpoch: baselineEpochOf(assetId),
            baselineFrozen: !!state.baselineFrozen,
            baselineFrozenAt: state.baselineFrozenAt || null,
            anomalyScore : evalRes.score,
            primaryDriver: evalRes.primaryDriver,
            evidenceHits: evidence.hits,
            evidenceSamples: evidence.samples,
            evidenceWindowSeconds: Math.round(A.evidenceMaxWindowMs / 1000),
            evidenceActive: evidence.evidenceActive,
            trend        : trend,
            unit         : canonical.vibrationUnit(metrics),
            drivers      : evalRes.drivers,
            baseline     : { vibration: baseline.vibration, temperature: baseline.temperature },
        };
        return {
            health: Object.assign({}, h, { score: effHealth, thresholdScore: h.score }),
            finalCondition, snapshot, drivenByAnomaly,
            anomalyReason: drivenByAnomaly ? buildAnomalyReason(snapshot) : null,
        };
    }

    function getAssetState(assetId) {
        let s = assets.get(assetId);
        if (!s) {
            s = restoreAssetState(assetId);
            if (!s.last) return null;
            assets.set(assetId, s);
        }
        return { summary: s.last, condition: s.condition, health: s.health, events: s.events.slice(-50), analytics: s.analytics };
    }

    function restoreAssetState(assetId) {
        const state = newAssetState();
        if (!tandem.latest) return state;
        const latest = tandem.latest(assetId);
        if (!latest) return state;
        const points = tandem.history ? tandem.history(assetId, 0) : [latest];
        const metrics = latest.metrics || {};
        const vibration = (latest.vibration == null) ? canonical.vibrationMagnitude(metrics) : latest.vibration;
        state.mergedMetrics = Object.assign({}, metrics);
        const allowOff = latest.activityInference !== 'unsupported';
        state.condition = latest.condition || condition.evaluate(
            latest.healthScore, metrics, config.thresholds, config.conditionBands).condition;
        if (!allowOff && state.condition === 'OFF') state.condition = 'NORMAL';
        const epoch = baselineEpochOf(assetId);
        const baselineRecord = baselines && assetId != null ? baselines.get(assetId) : null;
        const preEpoch = !!epoch && String(latest.t) < epoch;      // last stored point predates the operator's re-baseline
        state.health = { score: latest.healthScore, vibration, temperature: metrics.temperature };
        state.history = points.slice(-5).map(p => ({
            t: p.t,
            vibration: (p.vibration == null) ? canonical.vibrationMagnitude(p.metrics || {}) : p.vibration,
            health: p.healthScore,
            temperature: p.metrics && p.metrics.temperature,
        }));
        // Baseline bootstrap: seed the learned-normal window from persisted history so a server restart
        // doesn't throw the model back to sample 0. Only explicitly NORMAL-labelled points are learned.
        if (baselineRecord && baselineRecord.baselineFrozen && Array.isArray(baselineRecord.validatedSamples)) {
            const window = (config.analytics && config.analytics.historyWindow) || analytics.DEFAULTS.historyWindow;
            state.learnSamples = baselineRecord.validatedSamples.slice(-window);
            state.baselineFrozen = true;
            state.baselineFrozenAt = baselineRecord.frozenAt || null;
        } else {
            bootstrapLearnSamples(state, epoch ? points.filter(p => String(p.t) >= epoch) : points);
        }
        // The analytics hysteresis state is NOT the combined business condition. The stored condition may
        // have been WARNING/CRITICAL purely from the absolute-threshold path while analytics was NORMAL;
        // restoring anomalyStable from it would hold a healthy-again asset in WARNING for recoverySamples.
        // Always restart analytics hysteresis from NORMAL — the threshold path still derives the final
        // condition independently from the live telemetry. (candidate/count already null/0 from newAssetState.)
        // BUT an anomaly-DRIVEN stored condition (final worse than what the thresholds alone give for the same
        // metrics) must be reconstructed, otherwise the first reading after a restart reads NORMAL, emits a
        // false RECOVERY and then a second ESCALATION for the same ongoing episode. The persisted condition is
        // the final one (threshold OR anomaly), so recompute the threshold part from the stored metrics: if the
        // final is worse, the difference WAS the stabilized anomaly state. If it is not worse the anomaly state
        // was <= the threshold condition and starting it at NORMAL changes nothing.
        const thresholdCondition = thresholdConditionOf(metrics, allowOff);
        const anomalyDriven = !preEpoch && analytics.ORDER.indexOf(state.condition) > analytics.ORDER.indexOf(thresholdCondition);
        state.anomalyStable = anomalyDriven ? state.condition : 'NORMAL';
        state.anomalyScoreStable = state.anomalyStable;
        state.anomalyEvidence = [];
        // Re-baselined and nothing stored since: the old anomaly episode belongs to the discarded baseline.
        if (preEpoch) state.condition = thresholdCondition;
        state.analytics = initialAnalyticsSnapshot(state, metrics, assetId);
        state.events = points.map(p => p.conditionEvent).filter(Boolean)
            .filter(event => allowOff || (event.severity !== 'OFF' && event.from !== 'OFF')).slice(-50);
        const lastEvent = state.events.length ? state.events[state.events.length - 1].timestamp : null;
        state.last = {
            assetId: String(assetId),
            deviceId: latest.deviceId,
            condition: state.condition,
            healthScore: latest.healthScore,
            vibration,
            temperature: metrics.temperature,
            humidity: metrics.humidity,
            activityInference: latest.activityInference || null,
            lastTelemetry: latest.t,
            lastEvent,
            tandemRef: String(assetId),
        };
        return state;
    }

    // Seed the learned-normal window from persisted history. Capped to historyWindow. Bootstrap trusts
    // ONLY explicitly NORMAL-labelled points: unlabelled history (condition null/undefined, pre-dating
    // condition labelling) may contain abnormal behavior and must not contaminate the learned baseline.
    // OBSERVE/WARNING/CRITICAL/OFF are likewise excluded. (Live LEARNING still learns normally — the
    // update gate governs that; this stricter rule is the trusted-normal bootstrap only.)
    function bootstrapLearnSamples(state, points) {
        initAnalyticsState(state);
        const window = (config.analytics && config.analytics.historyWindow) || analytics.DEFAULTS.historyWindow;
        const learned = [];
        for (const p of points) {
            if (p.condition !== 'NORMAL') continue;   // trusted-normal labelled history only
            const m = p.metrics || {};
            const vibration = (p.vibration == null) ? canonical.vibrationMagnitude(m) : p.vibration;
            if (typeof vibration !== 'number' || !Number.isFinite(vibration)) continue;
            learned.push({ vibration, temperature: m.temperature });
        }
        state.learnSamples = learned.slice(-window);
    }

    // A baseline-only snapshot for a cold read (no live reading evaluated yet).
    function initialAnalyticsSnapshot(state, metrics, assetId) {
        const A = config.analytics;
        if (!A || !A.enabled) return null;
        const baseline = analytics.computeBaseline(state.learnSamples, A);
        return {
            modelState: baseline.modelState, sampleCount: baseline.sampleCount, minimumSamples: A.minimumSamples,
            baselineEpoch: baselineEpochOf(assetId),
            baselineFrozen: !!state.baselineFrozen, baselineFrozenAt: state.baselineFrozenAt || null,
            anomalyScore: null, primaryDriver: null, trend: 'STABLE',
            unit: canonical.vibrationUnit(metrics || {}),
            drivers: {}, baseline: { vibration: baseline.vibration, temperature: baseline.temperature },
        };
    }

    // Epoch (ISO) from which learned-baseline samples count; null until an operator re-baselines.
    function baselineEpochOf(assetId) {
        const r = baselines && assetId != null ? baselines.get(assetId) : null;
        return r ? r.baselineEpoch : null;
    }

    // The condition the ABSOLUTE thresholds alone give for these metrics (no learned anomaly part).
    function thresholdConditionOf(metrics, allowOff) {
        const hs = health.compute(metrics || {}, config.thresholds, []);
        return condition.evaluate(hs.score, metrics || {}, config.thresholds, config.conditionBands, { allowOff }).condition;
    }

    // Explicit, operator-initiated re-baseline: discard the learned window, start LEARNING again and make
    // restore ignore every sample older than the new epoch. Fixed physical guardrails stay active (they
    // never depended on the learned baseline). Throws when the epoch cannot be persisted.
    function rebaseline(assetId, { reason = null, now = new Date().toISOString() } = {}) {
        if (!baselines) throw new Error('REBASELINE_UNAVAILABLE');
        const id = String(assetId);
        const record = baselines.set(id, { reason, now });          // persist first: no half-applied re-baseline
        const state = assets.get(id) || restoreAssetState(id);       // epoch is set, so restore is already epoch-aware
        state.learnSamples = [];
        state.scoreHistory = [];
        state.anomalyStable = 'NORMAL';
        state.anomalyScoreStable = 'NORMAL';
        state.anomalyCandidate = null;
        state.anomalyCandidateCount = 0;
        state.anomalyEvidence = [];
        state.anomalyEvidenceRecoveryCount = 0;
        state.baselineFrozen = false;
        state.baselineFrozenAt = null;
        // The previous anomaly episode belonged to the discarded baseline: end it silently (no RECOVERY event)
        // and continue from what the absolute thresholds say about the last known metrics.
        state.condition = state.last ? thresholdConditionOf(state.mergedMetrics, state.last.activityInference !== 'unsupported') : state.condition;
        state.analytics = initialAnalyticsSnapshot(state, state.mergedMetrics, id);
        if (state.last) assets.set(id, state);
        log(logger, { stage: 'rebaseline', assetId: id, baselineEpoch: record.baselineEpoch, reason: record.reason });
        return record;
    }

    return { ingest, getAssetState, registry, rebaseline };
}

function initAnalyticsState(state) {
    if (!state.learnSamples) state.learnSamples = [];
    if (!state.scoreHistory) state.scoreHistory = [];
    if (state.anomalyStable === undefined) state.anomalyStable = 'NORMAL';
    if (state.anomalyScoreStable === undefined) state.anomalyScoreStable = 'NORMAL';
    if (state.anomalyCandidate === undefined) state.anomalyCandidate = null;
    if (state.anomalyCandidateCount === undefined) state.anomalyCandidateCount = 0;
    if (!state.anomalyEvidence) state.anomalyEvidence = [];
    if (state.anomalyEvidenceRecoveryCount === undefined) state.anomalyEvidenceRecoveryCount = 0;
    if (state.baselineFrozen === undefined) state.baselineFrozen = false;
    if (state.baselineFrozenAt === undefined) state.baselineFrozenAt = null;
}

// Human-readable "why" for an anomaly-driven condition — all facts from the analytics snapshot, no LLM.
function buildAnomalyReason(snapshot) {
    if (snapshot.evidenceActive) {
        return 'Recurrent learned-band deviation: ' + snapshot.evidenceHits +
            ' learned-band crossings within ' + snapshot.evidenceWindowSeconds + ' s';
    }
    const driver = snapshot.primaryDriver;
    const d = driver && snapshot.drivers[driver];
    const unit = driver === 'vibration' ? (snapshot.unit || '') : (driver === 'temperature' ? '°C' : '');
    if (!d) return 'anomaly score ' + snapshot.anomalyScore + ' vs learned baseline';
    return driver + ' ' + d.current + (unit ? ' ' + unit : '') + ' deviates ' + d.z +
        ' MAD from learned median ' + d.median + ' (anomaly ' + snapshot.anomalyScore + ')';
}

function newAssetState() {
    return {
        mergedMetrics: {}, condition: null, health: null, history: [], events: [], last: null,
        learnSamples: [], scoreHistory: [], analytics: null,
        anomalyStable: 'NORMAL', anomalyScoreStable: 'NORMAL', anomalyCandidate: null, anomalyCandidateCount: 0, anomalyEvidence: [], anomalyEvidenceRecoveryCount: 0,
        baselineFrozen: false, baselineFrozenAt: null,
    };
}

// One structured JSON log line per event. Distinguishable stages: validation / dedupe / ingested.
function log(logger, fields) {
    try { logger.log('[iot] ' + JSON.stringify(fields)); } catch { /* logging must never throw */ }
}

module.exports = { createBridge };
