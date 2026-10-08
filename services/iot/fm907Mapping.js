// Maintenance Case -> Asset Services (907) FIELD MAPPING CONTRACT (Phase 2A-3). Contract + dry-run
// projector only. NOTHING is written to Fusion Manage here. The actual guarded PATCH is 2A-5.
//
// Two groups:
//  - REUSE: field IDs CONFIRMED to exist on 907 via the 2A-2 read-only metadata probe.
//  - NEW:   fields that do NOT yet exist on 907 and must be created in the admin UI (v3 REST returns 405
//           for field creation — see docs/.../fusion-manage-mapping.md). We never assume these exist.
//
// Honest field count: 9 RESOLVED IoT fields + 1 DESIGN_PENDING (AFFECTED_COMPONENT). SOURCE is
// DOMAIN-required (every case must carry one) but that is NOT the same as making the FM field
// unconditionally mandatory on shared ws 907 — see the SOURCE entry below.
//
// Two contract caveats (do NOT present these as fully-resolved FM field definitions):
//  - SOURCE: domain-required != tenant-field-required. 907 already holds ordinary service records, so a
//    new unconditionally-mandatory field could break existing create/edit flows and historical records.
//    The predictive writer always writes CONDITION_EVENT; existing/manual records default to MANUAL_SERVICE
//    or stay blank until normalized, depending on what the FM admin config supports (decided in 2A-5).
//  - AFFECTED_COMPONENT: a single polymorphic reference to Items 57 / Motors 967 / Sensors 968 / Control 969
//    is NOT proven by tenant metadata. Representation is DESIGN_PENDING (2A-5): (A) TYPE+ID, (B) separate
//    optional refs, or (C) one canonical component workspace.
//
// Fleet-Learning corpus filter (future): ONLY `SOURCE === CONDITION_EVENT` counts as a predictive case.

const C = require('./maintenanceCase');

const PREDICTIVE_SOURCE = C.SOURCE.CONDITION_EVENT;   // the only SOURCE value the Fleet-Learning corpus accepts

const FM_907_WORKSPACE_ID = '907';
const ASSET_WORKSPACE_ID  = '904';

// CONFIRMED-existing 907 fields reused (from the 2A-2 probe). Values are the live FM field IDs.
const REUSE = Object.freeze({
    caseNumber:  'ID',
    asset:       'ASSET',                // Single Selection -> Assets 904
    detectedAt:  'DATE_SUBMITTED',
    actionType:  'REQUESTED_SERVICES',   // Multiple Selection; *_PERFORMED checkboxes are the alternative
    completedBy: 'COMPLETED_BY',
    completionDate: 'COMPLETION_DATE',
    lastServiceDate: 'LAST_SERVICE_DATE',
    // action.description -> one of the *_COMMENTS paragraphs; chosen per action family below.
});

// action.type -> the 907 "*_PERFORMED" / "*_COMPLETED_BY" / "*_COMMENTS" family (all CONFIRMED on 907).
const ACTION_FAMILY = Object.freeze({
    MAINTENANCE:  { performed: 'MAINTENANCE_PERFORMED',  completedBy: 'MAINTENANCE_COMPLETED_BY',  comments: 'MAINTENANCE_COMMENTS'  },
    REPAIR:       { performed: 'REPAIR_PERFORMED',       completedBy: 'REPAIR_COMPLETED_BY',       comments: 'REPAIR_COMMENTS'       },
    INSPECTION:   { performed: 'INSPECTION_PERFORMED',   completedBy: 'INSPECTION_COMPLETED_BY',   comments: 'INSPECTION_COMMENTS'   },
    CALIBRATION:  { performed: 'CALIBRATION_PERFORMED',  completedBy: 'CALIBRATION_COMPLETED_BY',  comments: 'CALIBRATION_COMMENTS'  },
    MODIFICATION: { performed: 'MODIFICATION_PERFORMED', completedBy: 'MODIFICATION_COMPLETED_BY', comments: 'MODIFICATION_COMMENTS' },
});

// Fields that MUST be created on 907 before 2A-5 can write them (do NOT exist today). suggested type only.
// status: RESOLVED (type/values settled, pending creation) | DESIGN_PENDING (representation not yet chosen).
// 9 RESOLVED + 1 DESIGN_PENDING.
const NEW_FIELDS = Object.freeze([
    { fieldId: 'SOURCE', status: 'RESOLVED', type: 'Single Selection', values: ['CONDITION_EVENT', 'MANUAL_SERVICE'],
      domainRequired: true, fmMandatory: false,
      note: 'process discriminator. DOMAIN-required, but NOT unconditionally mandatory on shared 907: make the FM ' +
            'field mandatory only if existing/manual records get a safe default (MANUAL_SERVICE) or stay blank until ' +
            'normalized (decided in 2A-5). Predictive writer always writes CONDITION_EVENT.' },
    { fieldId: 'CONDITION_EVENT_ID',   status: 'RESOLVED', type: 'Single Line Text', note: 'traceability to the durable Condition Event (eventRepository)' },
    { fieldId: 'ANOMALY_AT_DETECTION', status: 'RESOLVED', type: 'Float',            note: 'machine fact at detection' },
    { fieldId: 'PRIMARY_DRIVER',       status: 'RESOLVED', type: 'Single Selection', values: ['vibration', 'temperature'] },
    { fieldId: 'ASSESSMENT',           status: 'RESOLVED', type: 'Single Selection', values: Object.values(C.ASSESSMENT), note: 'human judgement; never derived from anomaly' },
    { fieldId: 'CONFIRMED_CAUSE',      status: 'RESOLVED', type: 'Paragraph',        note: 'human-confirmed; only with CONFIRMED_ISSUE' },
    { fieldId: 'AFFECTED_COMPONENT',   status: 'DESIGN_PENDING',
      note: 'polymorphic ref to Items 57 / Motors 967 / Sensors 968 / Control 969 NOT proven by metadata. ' +
            '2A-5 to choose: (A) AFFECTED_COMPONENT_TYPE + AFFECTED_COMPONENT_ID, (B) separate optional refs ' +
            '(AFFECTED_MOTOR/AFFECTED_SENSOR/AFFECTED_CONTROL/AFFECTED_ITEM), or (C) one canonical component workspace.' },
    { fieldId: 'TELEMETRY_IMPROVED',   status: 'RESOLVED', type: 'Check Box' },
    { fieldId: 'ANOMALY_AFTER',        status: 'RESOLVED', type: 'Float' },
    { fieldId: 'LEARNING_CASE_ID',     status: 'RESOLVED', type: 'Single Line Text', note: 'set only on promotion (2A-6+); never automatic' },
]);

// DRY-RUN projection of a case to FM 907 fields. Returns { workspaceId, fmState, confirmed, proposedNew }
// — a plan, not a write. `confirmed` uses live 907 field IDs; `proposedNew` uses the not-yet-created IDs
// so the caller can see exactly what the 2A-5 PATCH would need. No network, no mutation.
function toFmFields(kase) {
    const fam = kase.action && kase.action.type && ACTION_FAMILY[String(kase.action.type).toUpperCase()];
    const confirmed = {
        [REUSE.caseNumber]:     kase.caseId,
        [REUSE.asset]:          kase.assetId,
        [REUSE.detectedAt]:     kase.detectedAt,
    };
    if (kase.action) {
        const commentsField  = fam ? fam.comments  : 'REMARKS';          // REMARKS is a CONFIRMED generic 907 field
        const completedField = fam ? fam.completedBy : REUSE.completedBy;
        if (fam) confirmed[fam.performed] = true;
        if (kase.action.description != null) confirmed[commentsField]  = kase.action.description;
        if (kase.action.performedBy != null) confirmed[completedField] = kase.action.performedBy;
        if (kase.action.performedAt != null) confirmed[REUSE.completionDate] = kase.action.performedAt;
    }
    const proposedNew = {
        SOURCE:               kase.source,
        CONDITION_EVENT_ID:   kase.conditionEventId,
        ANOMALY_AT_DETECTION: kase.anomalyAtDetection,
        PRIMARY_DRIVER:       kase.primaryDriver,
        ASSESSMENT:           kase.assessment,
        CONFIRMED_CAUSE:      kase.confirmedCause,
        AFFECTED_COMPONENT:   kase.affectedComponent,
        TELEMETRY_IMPROVED:   kase.outcome ? kase.outcome.telemetryImproved : null,
        ANOMALY_AFTER:        kase.outcome ? kase.outcome.anomalyAfter : null,
        LEARNING_CASE_ID:     kase.learningCaseId,
    };
    return {
        workspaceId: FM_907_WORKSPACE_ID,
        assetWorkspaceId: ASSET_WORKSPACE_ID,
        fmState: C.FM_907_STATE[kase.status],
        confirmed,
        proposedNew,
    };
}

module.exports = { FM_907_WORKSPACE_ID, ASSET_WORKSPACE_ID, PREDICTIVE_SOURCE, REUSE, ACTION_FAMILY, NEW_FIELDS, toFmFields };
