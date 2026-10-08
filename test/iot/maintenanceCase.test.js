// Maintenance Case domain + dry-run repository (Phase 2A-3): creation-from-event (machine facts only),
// the anomaly!=diagnosis guard, the local state machine, assessment semantics, action guard, close rules,
// multi-asset isolation, the SOURCE discriminator, the FM-907 mapping contract, and NO FM write.
const { test } = require('node:test');
const assert = require('node:assert');

const C = require('../../services/iot/maintenanceCase');
const { createCaseRepository } = require('../../services/iot/caseRepository');
const mapping = require('../../services/iot/fm907Mapping');

function evt(over) {
    return Object.assign({
        eventId: 'E1', assetId: '30057', deviceId: 'lht65n-vib-01',
        type: 'ESCALATION', from: 'NORMAL', to: 'WARNING', severity: 'WARNING',
        timestamp: '2026-10-05T10:00:00Z', detectedAt: '2026-10-05T10:00:00Z',
        anomalyScore: 0.42, primaryDriver: 'vibration', status: 'OPEN',
    }, over || {});
}

// A repo whose resolver counts calls, so we can prove no external calls happen after creation.
function repoWith(events) {
    const store = {};
    for (const e of events) store[e.eventId] = e;
    const calls = { resolve: 0 };
    const repo = createCaseRepository({
        resolveConditionEvent: (id) => { calls.resolve++; return store[id] || null; },
        assetWorkspaceId: '904',
    });
    return { repo, calls };
}

// Drive a case all the way to CONFIRMED (valid path), returns [repo, caseId].
function toConfirmed(repo, eventId = 'E1') {
    const k = repo.createFromConditionEvent(eventId);
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.CONFIRMED_ISSUE, 'loose coupling confirmed');
    repo.transition(k.caseId, C.STATE.CONFIRMED);
    return k.caseId;
}

// A. CREATE FROM EVENT — correct machine facts.
test('A. create from event populates machine facts', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    assert.strictEqual(k.source, C.SOURCE.CONDITION_EVENT);
    assert.strictEqual(k.conditionEventId, 'E1');
    assert.strictEqual(k.assetId, '30057');
    assert.strictEqual(k.assetWorkspaceId, '904');
    assert.strictEqual(k.detectedAt, '2026-10-05T10:00:00Z');
    assert.strictEqual(k.anomalyAtDetection, 0.42);
    assert.strictEqual(k.primaryDriver, 'vibration');
    assert.strictEqual(k.status, C.STATE.NEW);
    assert.strictEqual(k.assessment, C.ASSESSMENT.UNKNOWN);
    assert.strictEqual(k.outcome.anomalyBefore, 0.42, 'anomalyBefore is a machine fact carried from detection');
});

// B. NO DIAGNOSIS INJECTION — creation never fabricates human judgement.
test('B. create-from-event injects no diagnosis', () => {
    const { repo } = repoWith([evt({ anomalyScore: 0.99 })]);   // even a very high anomaly
    const k = repo.createFromConditionEvent('E1');
    assert.strictEqual(k.confirmedCause, null);
    assert.notStrictEqual(k.assessment, C.ASSESSMENT.CONFIRMED_ISSUE);
    assert.strictEqual(k.affectedComponent, null);
    assert.strictEqual(k.action, null);
});

// C. UNKNOWN EVENT — rejected.
test('C. unknown conditionEventId is rejected', () => {
    const { repo } = repoWith([evt()]);
    assert.throws(() => repo.createFromConditionEvent('NOPE'), /unknown conditionEventId/);
});

// D. STATE MACHINE — valid accepted, invalid rejected.
test('D. state machine accepts valid and rejects invalid transitions', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    assert.strictEqual(repo.get(k.caseId).status, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    assert.strictEqual(repo.get(k.caseId).status, C.STATE.INVESTIGATING);
    // illegal: skipping states, and an unknown state name
    assert.throws(() => repo.transition(k.caseId, C.STATE.MONITORING), /illegal transition/);
    assert.throws(() => repo.transition(k.caseId, 'FOO'), /unknown-state|illegal/);
    // idempotent: re-creating from the same event returns the same (already-advanced) case
    assert.strictEqual(repo.createFromConditionEvent('E1').caseId, k.caseId);
});

// E. FALSE POSITIVE — may close, cannot become a confirmed issue implicitly.
test('E. false positive closes and cannot confirm implicitly', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.FALSE_POSITIVE);
    assert.throws(() => repo.transition(k.caseId, C.STATE.CONFIRMED), /CONFIRMED_ISSUE/);
    repo.transition(k.caseId, C.STATE.CLOSED);
    assert.strictEqual(repo.get(k.caseId).status, C.STATE.CLOSED);
    assert.strictEqual(repo.get(k.caseId).confirmedCause, null);
    assert.strictEqual(C.canPromoteToLearningCase(repo.get(k.caseId)), false);
});

// F. OPERATING STATE CHANGE — not a fault, not a learning case.
test('F. operating state change is not a fault/learning case', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.OPERATING_STATE_CHANGE);
    repo.transition(k.caseId, C.STATE.CLOSED);
    assert.strictEqual(C.canPromoteToLearningCase(repo.get(k.caseId)), false);
    assert.throws(() => repo.recordAction(k.caseId, { type: 'REPAIR' }), /CONFIRMED_ISSUE/);
});

// G. CONFIRMED ISSUE — confirmedCause required to move through CONFIRMED.
test('G. CONFIRMED requires a confirmedCause', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.CONFIRMED_ISSUE);           // assessment but no cause yet
    assert.throws(() => repo.transition(k.caseId, C.STATE.CONFIRMED), /confirmedCause/);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.CONFIRMED_ISSUE, 'bearing wear');
    repo.transition(k.caseId, C.STATE.CONFIRMED);
    assert.strictEqual(repo.get(k.caseId).status, C.STATE.CONFIRMED);
    // confirmedCause is cleared if assessment later changes away from CONFIRMED_ISSUE
    assert.throws(() => repo.updateAssessment(k.caseId, C.ASSESSMENT.FALSE_POSITIVE, 'x'), /only allowed with CONFIRMED_ISSUE/);
});

// H. ACTION — cannot record a maintenance action before a confirmed issue.
test('H. action requires a confirmed case', () => {
    const { repo } = repoWith([evt()]);
    const k = repo.createFromConditionEvent('E1');
    repo.transition(k.caseId, C.STATE.REVIEW_REQUIRED);
    repo.transition(k.caseId, C.STATE.INVESTIGATING);
    assert.throws(() => repo.recordAction(k.caseId, { type: 'REPAIR', description: 'x' }), /CONFIRMED_ISSUE/);
    repo.updateAssessment(k.caseId, C.ASSESSMENT.CONFIRMED_ISSUE, 'cause');
    repo.transition(k.caseId, C.STATE.CONFIRMED);
    const after = repo.recordAction(k.caseId, { type: 'REPAIR', description: 'retighten', performedBy: 'tech@x' });
    assert.strictEqual(after.action.type, 'REPAIR');
    assert.strictEqual(after.action.performedBy, 'tech@x');
    assert.ok(after.action.performedAt);
});

// I. MONITORING / CLOSE — full happy path + terminal lock.
test('I. full lifecycle to CLOSED, then terminal', () => {
    const { repo } = repoWith([evt()]);
    const caseId = toConfirmed(repo);
    repo.recordAction(caseId, { type: 'REPAIR', description: 'retighten coupling', performedBy: 'tech@x' });
    repo.transition(caseId, C.STATE.ACTION_TAKEN);
    repo.transition(caseId, C.STATE.MONITORING);
    repo.updateOutcome(caseId, { telemetryImproved: true, anomalyAfter: 0.03, conditionAfter: 'NORMAL' });
    repo.transition(caseId, C.STATE.CLOSED);
    const k = repo.get(caseId);
    assert.strictEqual(k.status, C.STATE.CLOSED);
    assert.ok(k.outcome.closedAt, 'closedAt stamped on close');
    assert.strictEqual(k.outcome.telemetryImproved, true);
    assert.strictEqual(C.canPromoteToLearningCase(k), true, 'closed + confirmed + cause => eligible');
    assert.throws(() => repo.transition(caseId, C.STATE.MONITORING), /illegal transition|already-terminal/);
});

// J. MULTI-ASSET — cases stay asset-associated.
test('J. multi-asset isolation', () => {
    const { repo } = repoWith([evt({ eventId: 'E1', assetId: '30057' }), evt({ eventId: 'E2', assetId: '40099' })]);
    const a = repo.createFromConditionEvent('E1');
    const b = repo.createFromConditionEvent('E2');
    assert.strictEqual(a.assetId, '30057');
    assert.strictEqual(b.assetId, '40099');
    assert.deepStrictEqual(repo.list({ assetId: '30057' }).map(c => c.caseId), [a.caseId]);
    assert.deepStrictEqual(repo.list({ assetId: '40099' }).map(c => c.caseId), [b.caseId]);
    assert.strictEqual(repo.list().length, 2);
});

// K. SOURCE — condition-event cases always CONDITION_EVENT.
test('K. source discriminator is always CONDITION_EVENT for event-derived cases', () => {
    const { repo } = repoWith([evt()]);
    assert.strictEqual(repo.createFromConditionEvent('E1').source, C.SOURCE.CONDITION_EVENT);
    assert.deepStrictEqual(repo.list({ source: C.SOURCE.MANUAL_SERVICE }), [], 'no manual-service cases created here');
});

// L. NO FM WRITE — the case layer has no FM coupling; lifecycle makes no external call after creation.
test('L. no Fusion Manage write / no external coupling', () => {
    const { repo, calls } = repoWith([evt()]);
    const surface = Object.keys(repo);
    assert.ok(!surface.some(n => /fm|fusion|write.*fm|tenant|patch/i.test(n)), 'repo exposes no FM write method: ' + surface);
    const caseId = toConfirmed(repo);               // one resolve call (creation)
    repo.recordAction(caseId, { type: 'REPAIR', description: 'x', performedBy: 'y' });
    repo.transition(caseId, C.STATE.ACTION_TAKEN);
    repo.transition(caseId, C.STATE.MONITORING);
    repo.transition(caseId, C.STATE.CLOSED);
    assert.strictEqual(calls.resolve, 1, 'only creation touches the (injected) event store; nothing else calls out');
});

// Mapping contract: 9 RESOLVED + 1 DESIGN_PENDING; SOURCE domain-required but not unconditionally FM-mandatory;
// AFFECTED_COMPONENT representation unresolved; dry-run projection writes nothing.
test('M. FM-907 mapping contract: 9 resolved + 1 design-pending, SOURCE caveat, dry-run projection', () => {
    assert.strictEqual(mapping.NEW_FIELDS.length, 10, 'ten new-field slots total');
    const resolved = mapping.NEW_FIELDS.filter(f => f.status === 'RESOLVED');
    const pending  = mapping.NEW_FIELDS.filter(f => f.status === 'DESIGN_PENDING');
    assert.strictEqual(resolved.length, 9, '9 resolved IoT fields');
    assert.strictEqual(pending.length, 1, '1 design-pending field');
    assert.strictEqual(pending[0].fieldId, 'AFFECTED_COMPONENT', 'affected-component representation is design-pending');
    const src = mapping.NEW_FIELDS.find(f => f.fieldId === 'SOURCE');
    assert.ok(src && src.domainRequired === true, 'SOURCE is domain-required');
    assert.strictEqual(src.fmMandatory, false, 'SOURCE is NOT unconditionally FM-mandatory on shared 907');
    assert.strictEqual(mapping.PREDICTIVE_SOURCE, C.SOURCE.CONDITION_EVENT, 'corpus filter = CONDITION_EVENT only');
    const { repo } = repoWith([evt()]);
    const caseId = toConfirmed(repo);
    repo.recordAction(caseId, { type: 'REPAIR', description: 'retighten', performedBy: 'tech@x', performedAt: '2026-10-05T12:00:00Z' });
    const plan = mapping.toFmFields(repo.get(caseId));
    assert.strictEqual(plan.workspaceId, '907');
    assert.strictEqual(plan.fmState, 'Confirmed');                       // CONFIRMED -> "Confirmed"
    assert.strictEqual(plan.confirmed.ASSET, '30057');                   // reuse: ASSET -> 904 asset
    assert.strictEqual(plan.confirmed.REPAIR_PERFORMED, true);           // action family maps to *_PERFORMED
    assert.strictEqual(plan.confirmed.REPAIR_COMMENTS, 'retighten');
    assert.strictEqual(plan.proposedNew.SOURCE, C.SOURCE.CONDITION_EVENT);
    assert.strictEqual(plan.proposedNew.CONDITION_EVENT_ID, 'E1');
    assert.strictEqual(Object.keys(plan.proposedNew).length, 10);
});
