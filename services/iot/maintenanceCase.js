// Maintenance Case domain model + state machine (Phase 2A-3). Pure, no I/O, no Fusion Manage.
//
// Hard semantic rule (anomaly != diagnosis): a case created from a Condition Event carries ONLY machine
// facts (source/conditionEventId/assetId/detectedAt/anomalyAtDetection/primaryDriver). assessment,
// confirmedCause, affectedComponent and any maintenance action are HUMAN inputs and are NEVER derived
// from anomalyScore here. The state machine enforces that confirmedCause/action cannot exist without a
// human CONFIRMED_ISSUE assessment.
//
// This module owns the model, enums, the local PM state machine, the FM-907 state-name mapping, and the
// Learning-Case eligibility guard. Persistence/dry-run lives in caseRepository.js; FM field mapping lives
// in fm907Mapping.js. Nothing here writes anything.

const crypto = require('node:crypto');

const CASE_SCHEMA_VERSION = 1;

const SOURCE = Object.freeze({
    CONDITION_EVENT: 'CONDITION_EVENT',   // created from an IoT durable Condition Event (predictive)
    MANUAL_SERVICE:  'MANUAL_SERVICE',    // a normal Asset Services record (ws 907 also holds these)
});

const ASSESSMENT = Object.freeze({
    CONFIRMED_ISSUE:        'CONFIRMED_ISSUE',        // human-confirmed real fault
    FALSE_POSITIVE:         'FALSE_POSITIVE',         // anomaly was not a real problem
    OPERATING_STATE_CHANGE: 'OPERATING_STATE_CHANGE', // real signal change, but expected (e.g. higher RPM) — not a fault
    UNKNOWN:                'UNKNOWN',                // default; not yet judged
});

const STATE = Object.freeze({
    NEW:             'NEW',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
    INVESTIGATING:   'INVESTIGATING',
    CONFIRMED:       'CONFIRMED',
    ACTION_TAKEN:    'ACTION_TAKEN',
    MONITORING:      'MONITORING',
    CLOSED:          'CLOSED',
    CANCELLED:       'CANCELLED',
});

const TERMINAL = new Set([STATE.CLOSED, STATE.CANCELLED]);

// Legal forward transitions. CANCELLED is reachable from any active (non-terminal) state — handled
// separately so we don't repeat it on every row. Guards (assessment/confirmedCause) are checked in
// canTransition, not encoded here.
const FORWARD = Object.freeze({
    [STATE.NEW]:             [STATE.REVIEW_REQUIRED],
    [STATE.REVIEW_REQUIRED]: [STATE.INVESTIGATING],
    [STATE.INVESTIGATING]:   [STATE.CONFIRMED, STATE.CLOSED],   // CLOSED = early-out (false positive / op change / unknown)
    [STATE.CONFIRMED]:       [STATE.ACTION_TAKEN],
    [STATE.ACTION_TAKEN]:    [STATE.MONITORING],
    [STATE.MONITORING]:      [STATE.CLOSED],
    [STATE.CLOSED]:          [],
    [STATE.CANCELLED]:       [],
});

// Local PM state -> Asset Services (907) workflow state name. Contract only; no FM workflow is mutated.
// ACTION_TAKEN and MONITORING both map to "In Progress" (907 has no distinct post-action state) — the
// finer distinction lives in the local model, which is why we do NOT copy FM names into the domain.
const FM_907_STATE = Object.freeze({
    [STATE.NEW]:             'Definition',
    [STATE.REVIEW_REQUIRED]: 'Assigned',
    [STATE.INVESTIGATING]:   'In Progress',
    [STATE.CONFIRMED]:       'Confirmed',
    [STATE.ACTION_TAKEN]:    'In Progress',
    [STATE.MONITORING]:      'In Progress',
    [STATE.CLOSED]:          'Completed',
    [STATE.CANCELLED]:       'Cancelled',
});

function isActive(state) { return !TERMINAL.has(state); }

// Decide whether a transition is legal for this case. Returns { ok, reason? }. Enforces the structural
// edges AND the human-judgement guards: you cannot enter CONFIRMED without a CONFIRMED_ISSUE assessment
// and a confirmedCause; an INVESTIGATING->CLOSED early-out requires a non-CONFIRMED_ISSUE assessment
// (a confirmed issue must go through the action path, not be silently closed).
function canTransition(kase, next) {
    if (!STATE[next]) return { ok: false, reason: 'unknown-state' };
    if (next === kase.status) return { ok: false, reason: 'no-op' };
    if (next === STATE.CANCELLED) {
        return isActive(kase.status) ? { ok: true } : { ok: false, reason: 'already-terminal' };
    }
    const allowed = FORWARD[kase.status] || [];
    if (!allowed.includes(next)) return { ok: false, reason: 'illegal-transition' };

    if (next === STATE.CONFIRMED) {
        if (kase.assessment !== ASSESSMENT.CONFIRMED_ISSUE) return { ok: false, reason: 'confirm-requires-CONFIRMED_ISSUE-assessment' };
        if (!kase.confirmedCause)                           return { ok: false, reason: 'confirm-requires-confirmedCause' };
    }
    if (kase.status === STATE.INVESTIGATING && next === STATE.CLOSED) {
        if (kase.assessment === ASSESSMENT.CONFIRMED_ISSUE) return { ok: false, reason: 'confirmed-issue-cannot-close-from-investigating' };
    }
    return { ok: true };
}

// Create a case from a durable Condition Event. MACHINE FACTS ONLY. assessment defaults to UNKNOWN;
// confirmedCause/affectedComponent/action stay empty (human inputs). anomalyBefore is a machine fact
// (the anomaly at detection) and is the only outcome field seeded.
function fromConditionEvent(event, opts = {}) {
    if (!event || !event.eventId || event.assetId == null) {
        throw new Error('fromConditionEvent: invalid condition event');
    }
    const now = opts.now || new Date().toISOString();
    const anomaly = (event.anomalyScore == null) ? null : event.anomalyScore;
    return {
        schemaVersion:   CASE_SCHEMA_VERSION,
        caseId:          opts.caseId || crypto.randomUUID(),
        source:          SOURCE.CONDITION_EVENT,          // mandatory discriminator (ws 907 also holds MANUAL_SERVICE)
        conditionEventId: event.eventId,

        assetId:          String(event.assetId),
        assetWorkspaceId: String(opts.assetWorkspaceId || '904'),  // Assets workspace the ASSET ref points at

        detectedAt:        event.detectedAt || event.timestamp || now,
        anomalyAtDetection: anomaly,
        primaryDriver:     event.primaryDriver || null,

        status:     STATE.NEW,
        assessment: ASSESSMENT.UNKNOWN,                   // never derived from anomaly

        confirmedCause:   null,                           // human-only; stays null unless CONFIRMED_ISSUE
        affectedComponent: null,                          // human-only

        action: null,                                     // { type, description, performedBy, performedAt }

        outcome: {
            telemetryImproved: null,
            anomalyBefore:     anomaly,                    // machine fact, carried from detection
            anomalyAfter:      null,
            conditionAfter:    null,
            observationFrom:   null,
            observationTo:     null,
            closedAt:          null,
        },

        learningCaseId: null,                             // never set automatically (2A-3 does not promote)

        createdAt: now,
        updatedAt: now,
    };
}

// Apply a human assessment (a "finding"). Enforces: confirmedCause only survives under CONFIRMED_ISSUE;
// changing away from CONFIRMED_ISSUE clears confirmedCause (it is a human-confirmed fact tied to that
// judgement). affectedComponent is an optional structured note ({type,id,label}) — set when provided,
// independent of the assessment value; its future FM representation is DESIGN_PENDING (see fm907Mapping).
function applyAssessment(kase, assessment, confirmedCause, affectedComponent) {
    if (!ASSESSMENT[assessment]) throw new Error('applyAssessment: unknown assessment ' + assessment);
    const next = Object.assign({}, kase, { assessment });
    if (assessment === ASSESSMENT.CONFIRMED_ISSUE) {
        if (confirmedCause !== undefined) next.confirmedCause = confirmedCause || null;
    } else {
        if (confirmedCause) throw new Error('confirmedCause is only allowed with CONFIRMED_ISSUE');
        next.confirmedCause = null;    // cannot keep a confirmed cause under a non-confirmed assessment
    }
    if (affectedComponent !== undefined) next.affectedComponent = affectedComponent || null;
    return next;
}

// Record a maintenance action. Guard: a meaningful action requires a human-CONFIRMED_ISSUE case in a
// post-confirmation state (anomaly != diagnosis -> no repair before confirmation).
function applyAction(kase, action) {
    if (kase.assessment !== ASSESSMENT.CONFIRMED_ISSUE) throw new Error('action requires assessment CONFIRMED_ISSUE');
    if (![STATE.CONFIRMED, STATE.ACTION_TAKEN, STATE.MONITORING].includes(kase.status)) {
        throw new Error('action requires a confirmed case (state CONFIRMED or later), got ' + kase.status);
    }
    const a = action || {};
    return Object.assign({}, kase, { action: {
        type:        a.type || null,
        description: a.description || null,
        performedBy: a.performedBy || null,
        performedAt: a.performedAt || new Date().toISOString(),
    }});
}

// Telemetry-verified outcome (human/automation records whether the anomaly actually improved). Pure merge.
function applyOutcome(kase, outcome) {
    return Object.assign({}, kase, { outcome: Object.assign({}, kase.outcome, outcome || {}) });
}

// Learning-Case eligibility (2A-3 guard only; no promotion implemented). Only a CLOSED, human-CONFIRMED_ISSUE
// case is eligible — FALSE_POSITIVE / OPERATING_STATE_CHANGE / UNKNOWN are never promoted.
function canPromoteToLearningCase(kase) {
    return kase.status === STATE.CLOSED && kase.assessment === ASSESSMENT.CONFIRMED_ISSUE && !!kase.confirmedCause;
}

module.exports = {
    CASE_SCHEMA_VERSION, SOURCE, ASSESSMENT, STATE, FM_907_STATE, FORWARD,
    isActive, canTransition, fromConditionEvent, applyAssessment, applyAction, applyOutcome,
    canPromoteToLearningCase,
};
