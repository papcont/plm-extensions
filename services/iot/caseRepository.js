// Maintenance Case repository (Phase 2A-3) — LOCAL / DRY-RUN only. No Fusion Manage write, no new DB.
//
// Holds cases in memory (one process-wide Map), keyed by caseId, deduped by conditionEventId so one
// Condition Event yields at most one case. All business logic lives in maintenanceCase.js (pure); this
// layer only resolves the source event, stores, and applies validated mutations.
//
// ponytail: in-memory only. Durable NDJSON persistence (mirroring eventRepository.js) is deferred until
// cases must survive a restart — add it in 2A-4+ when the dashboard/FM sync needs it; dry-run + tests
// don't. No case ever writes to FM in this phase.

const C = require('./maintenanceCase');

function createCaseRepository(deps = {}) {
    const resolveConditionEvent = deps.resolveConditionEvent || (() => null);
    const assetWorkspaceId = deps.assetWorkspaceId || '904';
    const byId = new Map();            // caseId -> case
    const byEvent = new Map();         // conditionEventId -> caseId (dedupe)

    function touch(kase) { kase.updatedAt = new Date().toISOString(); byId.set(kase.caseId, kase); return kase; }

    // Create a case from a durable Condition Event id. Machine facts only (see maintenanceCase). Idempotent
    // per conditionEventId. Throws on an unknown event id (the event must exist in the durable store).
    function createFromConditionEvent(eventId) {
        if (!eventId) throw new Error('createFromConditionEvent: eventId required');
        if (byEvent.has(eventId)) return byId.get(byEvent.get(eventId));   // idempotent
        const event = resolveConditionEvent(eventId);
        if (!event) throw new Error('unknown conditionEventId: ' + eventId);
        const kase = C.fromConditionEvent(event, { assetWorkspaceId });
        byId.set(kase.caseId, kase);
        byEvent.set(eventId, kase.caseId);
        return kase;
    }

    function get(caseId) { return byId.get(caseId) || null; }

    function list(options = {}) {
        let arr = Array.from(byId.values());
        if (options.assetId != null) arr = arr.filter(c => c.assetId === String(options.assetId));
        if (options.source)          arr = arr.filter(c => c.source === options.source);
        if (options.status)          arr = arr.filter(c => c.status === options.status);
        arr.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        return arr;
    }

    function require2(caseId) { const k = byId.get(caseId); if (!k) throw new Error('unknown caseId: ' + caseId); return k; }

    function updateAssessment(caseId, assessment, confirmedCause, affectedComponent) {
        return touch(C.applyAssessment(require2(caseId), assessment, confirmedCause, affectedComponent));
    }

    function recordAction(caseId, action) {
        return touch(C.applyAction(require2(caseId), action));
    }

    function updateOutcome(caseId, outcome) {
        return touch(C.applyOutcome(require2(caseId), outcome));
    }

    // Validated state transition. Throws (with a reason) on an illegal transition — callers map to 400.
    function transition(caseId, next) {
        const kase = require2(caseId);
        const v = C.canTransition(kase, next);
        if (!v.ok) throw new Error('illegal transition ' + kase.status + ' -> ' + next + ' (' + v.reason + ')');
        const updated = Object.assign({}, kase, { status: next });
        if (next === C.STATE.CLOSED && !updated.outcome.closedAt) {
            updated.outcome = Object.assign({}, updated.outcome, { closedAt: new Date().toISOString() });
        }
        return touch(updated);
    }

    function clear() { byId.clear(); byEvent.clear(); }   // test helper; no persistence to wipe

    return { createFromConditionEvent, get, list, updateAssessment, recordAction, updateOutcome, transition, clear };
}

module.exports = { createCaseRepository };
