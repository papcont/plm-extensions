// IoT Bridge — the one application service between the device-adapter boundary and the Autodesk
// integrations. It is transport/vendor agnostic: it only ever receives *canonical* events.
//   validate -> identify device -> map to asset -> merge/normalize -> dedupe -> health -> condition
//   -> emit condition events on escalation/recovery -> Tandem (time series) + Fusion Manage (state).
// No Autodesk-specific logic lives here beyond calling the injected repositories.

const crypto = require('node:crypto');
const canonical = require('./canonical');
const health = require('./health');
const condition = require('./condition');
const { createRegistry } = require('./deviceRegistry');

function createBridge({ config, tandem, fusionManage, resolveDeviceAsset = null, logger = console }) {
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
        const state = assets.get(assetId) || newAssetState();
        state.mergedMetrics = Object.assign({}, state.mergedMetrics, event.metrics);
        const metrics = state.mergedMetrics;

        // 6. health + condition
        const h = health.compute(metrics, config.thresholds, state.history);
        const c = condition.evaluate(h.score, metrics, config.thresholds, config.conditionBands);

        // 7. condition event on any change after the first reading (skip initial NORMAL establishment)
        let conditionEvent = null;
        if (c.condition !== state.condition && state.condition !== null) {
            conditionEvent = {
                eventId    : crypto.randomUUID(),
                assetId,
                deviceId   : event.deviceId,
                type       : condition.isEscalation(state.condition || 'OFF', c.condition) ? 'ESCALATION' : 'RECOVERY',
                from       : state.condition || null,
                severity   : c.condition,
                timestamp  : event.timestamp,
                healthScore: h.score,
                reason     : c.reason,
                status     : 'OPEN',
            };
            state.events.push(conditionEvent);
        }

        // 8. persist: Tandem (time series) always; Fusion Manage summary + events (gated in repo)
        const tandemResult = await tandem.push(assetId, event.timestamp, metrics, h.score);
        const summary = {
            assetId, deviceId: event.deviceId,
            condition: c.condition, healthScore: h.score,
            vibration: h.vibration, temperature: metrics.temperature,
            lastTelemetry: event.timestamp,
            lastEvent: conditionEvent ? conditionEvent.timestamp : (state.last && state.last.lastEvent) || null,
            tandemRef: assetId,
        };
        const fmSummaryResult = await fusionManage.upsertConditionSummary(summary);
        let fmEventResult = null;
        if (conditionEvent) fmEventResult = await fusionManage.recordConditionEvent(conditionEvent);

        // update in-memory state
        state.condition = c.condition;
        state.health = h;
        state.last = summary;
        state.history.push({ t: event.timestamp, vibration: h.vibration, health: h.score, temperature: metrics.temperature });
        if (state.history.length > 5000) state.history.splice(0, state.history.length - 5000);
        assets.set(assetId, state);

        // 9. structured log (no secrets, no raw payloads)
        log(logger, {
            stage: 'ingested', deviceId: event.deviceId, assetId, eventId: event.eventId,
            timestamp: event.timestamp, source: event.source,
            condition: c.condition, healthScore: h.score,
            tandemResult: tandemResult.delivered, fusionManageResult: fmSummaryResult.mode,
            conditionEvent: conditionEvent ? conditionEvent.type + ':' + conditionEvent.severity : null,
        });

        return {
            accepted: true, assetId, health: h, condition: c,
            conditionEvent, summary, tandemResult, fmSummaryResult, fmEventResult,
        };
    }

    function getAssetState(assetId) {
        const s = assets.get(assetId);
        if (!s) return null;
        return { summary: s.last, condition: s.condition, health: s.health, events: s.events.slice(-50) };
    }

    return { ingest, getAssetState, registry };
}

function newAssetState() {
    return { mergedMetrics: {}, condition: null, health: null, history: [], events: [], last: null };
}

// One structured JSON log line per event. Distinguishable stages: validation / dedupe / ingested.
function log(logger, fields) {
    try { logger.log('[iot] ' + JSON.stringify(fields)); } catch { /* logging must never throw */ }
}

module.exports = { createBridge };
