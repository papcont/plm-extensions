// Fusion Manage Maintenance Case writer (Phase 2A-5B, Gate 2): default-off gate, dry-run projection
// (zero HTTP), create/finding/action/outcome projections, asset-ref requirement, idempotency, failure
// model, and explicit-only workflow transition. No live FM item is ever written by these tests.
const { test } = require('node:test');
const assert = require('node:assert');

const { createFusionManageCaseRepository } = require('../../services/iot/fusionManageCaseRepository');
const { createFmTransport } = require('../../services/iot/fmTransport');
const globalConfig = require('../../services/iot/config');

// A case as the repository/UI would hand it over (machine facts + optional human finding/action/outcome).
function makeCase(over) {
    return Object.assign({
        caseId: 'c-1', source: 'CONDITION_EVENT', conditionEventId: 'E1',
        assetId: '30057', assetWorkspaceId: '904',
        detectedAt: '2026-10-05T10:00:00Z', anomalyAtDetection: 1, primaryDriver: 'vibration',
        status: 'NEW', assessment: 'UNKNOWN', confirmedCause: null, affectedComponent: null,
        action: null, outcome: { telemetryImproved: null, anomalyBefore: 1, anomalyAfter: null, conditionAfter: null },
        learningCaseId: null,
    }, over || {});
}
function spyTransport() {
    const calls = { create: 0, patch: 0, bodies: [] };
    return {
        calls,
        create: async (url, body) => { calls.create++; calls.bodies.push({ url, body }); return '/api/v3/workspaces/907/items/555'; },
        patch:  async (url, body) => { calls.patch++;  calls.bodies.push({ url, body }); return {}; },
    };
}
function repo(config, deps) { return createFusionManageCaseRepository(Object.assign({ caseWorkspaceId: '907', assetWorkspaceId: '904', floatDecimals: 2 }, config), deps); }

// A. default off
test('A. fusionManageCaseWrites defaults to false', () => {
    assert.strictEqual(globalConfig.fusionManageCaseWrites, false);
});

// B. summary gate does not enable case writes
test('B. fusionManageWrites=true does NOT enable case writes', async () => {
    const t = spyTransport();
    const r = repo({ fusionManageWrites: true, fusionManageCaseWrites: false }, { transport: t });
    const res = await r.create(makeCase());
    assert.strictEqual(res.dryRun, true);
    assert.strictEqual(t.calls.create, 0);
});

// C. dry-run create performs zero HTTP
test('C. dry-run create performs zero HTTP writes', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: false }, { transport: t }).create(makeCase());
    assert.strictEqual(res.dryRun, true);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(t.calls.create, 0);
    assert.strictEqual(t.calls.patch, 0);
});

// D. create targets only 907
test('D. create op result workspaceId is 907', async () => {
    const res = await repo({}).create(makeCase());
    assert.strictEqual(res.workspaceId, '907');
});

// E. SOURCE exactly CONDITION_EVENT
test('E. create projects SOURCE = CONDITION_EVENT', () => {
    assert.strictEqual(repo({}).projectCreate(makeCase()).fields.SOURCE, 'CONDITION_EVENT');
});

// F. blank/null SOURCE never predictive
test('F. the writer never emits a blank SOURCE; predictive create is always CONDITION_EVENT', () => {
    const f = repo({}).projectCreate(makeCase()).fields;
    assert.strictEqual(f.SOURCE, 'CONDITION_EVENT');
    assert.notStrictEqual(f.SOURCE, '');
    assert.notStrictEqual(f.SOURCE, null);
});

// G. ID never projected
test('G. 907 ID is never projected', () => {
    const r = repo({});
    const k = makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'x', action: { type: 'REPAIR', description: 'd', performedBy: 'u' }, outcome: { telemetryImproved: true, anomalyAfter: 0.1 } });
    for (const proj of [r.projectCreate(k), r.projectFinding(k), r.projectAction(k), r.projectOutcome(k)]) {
        assert.ok(!('ID' in proj.fields), 'no ID in ' + JSON.stringify(Object.keys(proj.fields)));
    }
});

// H. create has no diagnosis/finding fields
test('H. create projects no finding/outcome/diagnosis fields', () => {
    const f = repo({}).projectCreate(makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'should-not-appear' })).fields;
    for (const forbidden of ['ASSESSMENT', 'CONFIRMED_CAUSE', 'AFFECTED_COMPONENT_TYPE', 'AFFECTED_COMPONENT_ID', 'TELEMETRY_IMPROVED', 'ANOMALY_AFTER', 'LEARNING_CASE_ID']) {
        assert.ok(!(forbidden in f), forbidden + ' must not be in create');
    }
});

// I. ASSET reference projection
test('I. create projects the correct ASSET reference', () => {
    const res = repo({}).projectCreate(makeCase({ assetId: '30057' }));
    assert.deepStrictEqual(res.references.ASSET, { link: '/api/v3/workspaces/904/items/30057' });
    assert.strictEqual(res.assetResolved, true);
});
test('I2. unresolvable asset -> create refuses (UNRESOLVED_ASSET), no HTTP', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' }, { transport: t }).create(makeCase({ assetId: 'MOTOR-DEMO-001' }));
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'UNRESOLVED_ASSET');
    assert.strictEqual(t.calls.create, 0);
});

// J. float projection
test('J. ANOMALY_AT_DETECTION projected as a 2-decimal string', () => {
    assert.strictEqual(repo({}).projectCreate(makeCase({ anomalyAtDetection: 1 })).fields.ANOMALY_AT_DETECTION, '1');
    assert.strictEqual(repo({}).projectCreate(makeCase({ anomalyAtDetection: 0.126 })).fields.ANOMALY_AT_DETECTION, '0.13');
});

// K. pick-list projection
test('K. PRIMARY_DRIVER projected as its pick-list value', () => {
    assert.strictEqual(repo({}).projectCreate(makeCase({ primaryDriver: 'vibration' })).fields.PRIMARY_DRIVER, 'vibration');
});

// L. finding mappings
test('L. finding projects assessment + cause + affected component', () => {
    const f = repo({}).projectFinding(makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'loose coupling', affectedComponent: { type: 'MOTOR', id: 'M-07', label: 'Drive' } })).fields;
    assert.strictEqual(f.ASSESSMENT, 'CONFIRMED_ISSUE');
    assert.strictEqual(f.CONFIRMED_CAUSE, 'loose coupling');
    assert.strictEqual(f.AFFECTED_COMPONENT_TYPE, 'MOTOR');
    assert.strictEqual(f.AFFECTED_COMPONENT_ID, 'M-07');
});

// M. confirmedCause guards
test('M. confirmedCause only under CONFIRMED_ISSUE', () => {
    const r = repo({});
    for (const a of ['FALSE_POSITIVE', 'OPERATING_STATE_CHANGE', 'UNKNOWN']) {
        const f = r.projectFinding(makeCase({ assessment: a, confirmedCause: 'leaked?' })).fields;
        assert.ok(!('CONFIRMED_CAUSE' in f), a + ' must not project CONFIRMED_CAUSE');
    }
});

// N. affected component mapping
test('N. affected component -> TYPE + ID', () => {
    const f = repo({}).projectFinding(makeCase({ assessment: 'UNKNOWN', affectedComponent: { type: 'SENSOR', id: 'S-3', label: 'Vib sensor' } })).fields;
    assert.strictEqual(f.AFFECTED_COMPONENT_TYPE, 'SENSOR');
    assert.strictEqual(f.AFFECTED_COMPONENT_ID, 'S-3');
});

// O. supported action family
test('O. supported action.type maps to its 907 family', () => {
    const f = repo({}).projectAction(makeCase({ action: { type: 'REPAIR', description: 'retighten', performedBy: 'tech@x', performedAt: '2026-10-06T12:00:00Z' } }));
    assert.strictEqual(f.fields.REPAIR_PERFORMED, true);
    assert.strictEqual(f.fields.REPAIR_COMMENTS, 'retighten');
    assert.strictEqual(f.fields.COMPLETED_BY, 'tech@x');
    assert.strictEqual(f.fields.COMPLETION_DATE, '2026-10-06');
    assert.ok(!f.unmapped);
});

// P. unsupported action safe behavior
test('P. unsupported action.type -> REMARKS + unmapped flag, no wrong family', () => {
    const f = repo({}).projectAction(makeCase({ action: { type: 'FROBNICATE', description: 'did a thing', performedBy: 'u' } }));
    assert.strictEqual(f.unmapped, true);
    assert.match(f.fields.REMARKS, /\[FROBNICATE\] did a thing/);
    for (const fam of ['REPAIR_PERFORMED', 'MAINTENANCE_PERFORMED', 'INSPECTION_PERFORMED', 'CALIBRATION_PERFORMED', 'MODIFICATION_PERFORMED']) {
        assert.ok(!(fam in f.fields), 'no wrong family ' + fam);
    }
});

// Q. outcome mapping
test('Q. outcome -> TELEMETRY_IMPROVED + ANOMALY_AFTER', () => {
    const f = repo({}).projectOutcome(makeCase({ outcome: { telemetryImproved: true, anomalyAfter: 0.03 } })).fields;
    assert.strictEqual(f.TELEMETRY_IMPROVED, true);
    assert.strictEqual(f.ANOMALY_AFTER, '0.03');
});

// R. LEARNING_CASE_ID untouched
test('R. LEARNING_CASE_ID is never projected', () => {
    const r = repo({});
    const k = makeCase({ learningCaseId: 'L-1', assessment: 'CONFIRMED_ISSUE', confirmedCause: 'c', action: { type: 'REPAIR' }, outcome: { telemetryImproved: true, anomalyAfter: 0.1 } });
    for (const proj of [r.projectCreate(k), r.projectFinding(k), r.projectAction(k), r.projectOutcome(k)]) {
        assert.ok(!('LEARNING_CASE_ID' in proj.fields));
    }
});

// S. fmDmsId idempotency guard (gate ON)
test('S. create with an existing fmDmsId does not create again', async () => {
    const t = spyTransport();
    const k = makeCase(); k.sync = { fmDmsId: '777', syncStatus: 'SYNCED' };
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' }, { transport: t }).create(k);
    assert.strictEqual(res.fmDmsId, '777');
    assert.strictEqual(res.reason, 'already-created');
    assert.strictEqual(t.calls.create, 0);
});

// T. reconciliation adopts an existing item by CONDITION_EVENT_ID
test('T. reconcile by CONDITION_EVENT_ID adopts the existing item', async () => {
    const t = spyTransport();
    const r = repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' },
        { transport: t, searchByConditionEventId: async () => ['999'] });
    const k = makeCase();
    const res = await r.create(k);
    assert.strictEqual(res.fmDmsId, '999');
    assert.strictEqual(res.reason, 'reconciled');
    assert.strictEqual(t.calls.create, 0);
    assert.strictEqual(k.sync.syncStatus, 'SYNCED');
});

// U. duplicate business key
test('U. two items with the same CONDITION_EVENT_ID -> ERROR_DUPLICATE_BUSINESS_KEY, no create', async () => {
    const t = spyTransport();
    const r = repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' },
        { transport: t, searchByConditionEventId: async () => ['a', 'b'] });
    const res = await r.create(makeCase());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'ERROR_DUPLICATE_BUSINESS_KEY');
    assert.strictEqual(t.calls.create, 0);
});

// U2. reconcile path unavailable -> only fmDmsId guard, flagged
test('U2. no reconcile fn -> RECONCILE_PATH_UNAVAILABLE flag', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' }, { transport: t }).create(makeCase());
    assert.strictEqual(res.reconcile, 'RECONCILE_PATH_UNAVAILABLE');
});

// V. failed write -> sync ERROR
test('V. a failed create sets syncStatus ERROR and keeps the local case', async () => {
    const t = { create: async () => { const e = new Error('boom'); throw e; }, patch: async () => ({}) };
    const k = makeCase();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t', caseDefaultUrgency: 'Low', urgencyOptions: { Low: '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/1' } }, { transport: t }).create(k);
    assert.strictEqual(res.ok, false);
    assert.ok(res.error);
    assert.strictEqual(k.sync.syncStatus, 'ERROR');
    assert.ok(k.sync.syncError);
});

// W. successful create -> SYNCED
test('W. a successful create sets fmDmsId + SYNCED', async () => {
    const t = spyTransport();
    const k = makeCase();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t', caseDefaultUrgency: 'Low', urgencyOptions: { Low: '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/1' } }, { transport: t }).create(k);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.fmDmsId, '555');
    assert.strictEqual(k.sync.syncStatus, 'SYNCED');
    assert.strictEqual(t.calls.create, 1);
});

// X. transition is explicit-only (patch ops never transition)
test('X. finding/action/outcome never transition the workflow', async () => {
    const t = spyTransport();
    const k = makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'c', action: { type: 'REPAIR' } });
    k.sync = { fmDmsId: '555' };
    const r = repo({ fusionManageCaseWrites: true, caseSectionId: '9999', impersonateUser: 'u@x', tenantLink: 'https://t' }, { transport: t });
    await r.updateFinding(k); await r.updateAction(k); await r.updateOutcome(k);
    // no transition call exists on the transport at all; patches went out, workflow untouched
    const tr = await r.transition(k, 'CONFIRMED');
    assert.match(tr.note, /no real workflow transition/);
});

// Y. already-at-target transition is idempotent
test('Y. transition already at target state is idempotent', async () => {
    const k = makeCase(); k.sync = { fmDmsId: '555' };
    const r = repo({ fusionManageCaseWrites: true }, { readFmState: async () => 'Confirmed' });
    const res = await r.transition(k, 'CONFIRMED');          // CONFIRMED -> "Confirmed"
    assert.strictEqual(res.idempotent, true);
    assert.strictEqual(res.fmState, 'Confirmed');
});
test('Y2. transition maps local -> 907 state and executes nothing in Gate-2', async () => {
    const res = await repo({}).transition(makeCase(), 'CLOSED');
    assert.strictEqual(res.fmState, 'Completed');
    assert.strictEqual(res.dryRun, true);
});

// AA. create WIRE body: static pick lists -> lookup option links; ASSET -> item ref; WORKSPACE-level field links.
test('AA. createBody serializes pick lists to option links + workspace-level field links', () => {
    const r = repo({});
    const body = r.createBody(r.projectCreate(makeCase()), '2500');
    const fields = body.sections[0].fields;
    const byId = {}; for (const f of fields) byId[f.__self__.split('/fields/').pop()] = f;
    // SOURCE -> { link: option }, PRIMARY_DRIVER -> { link: option }
    assert.deepStrictEqual(byId.SOURCE.value, { link: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_SOURCE/options/2' });
    assert.deepStrictEqual(byId.PRIMARY_DRIVER.value, { link: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_DRIVER/options/2' });
    // ASSET -> workspace-904 item reference
    assert.deepStrictEqual(byId.ASSET.value, { link: '/api/v3/workspaces/904/items/30057' });
    // float/text stay serialized
    assert.strictEqual(byId.ANOMALY_AT_DETECTION.value, '1');
    assert.strictEqual(byId.CONDITION_EVENT_ID.value, 'E1');
    assert.ok(!('DATE_SUBMITTED' in byId));
    // CREATE uses workspace-level field links (no /items/)
    assert.strictEqual(byId.SOURCE.__self__, '/api/v3/workspaces/907/views/1/fields/SOURCE');
    assert.strictEqual(body.sections[0].link, '/api/v3/workspaces/907/sections/2500');
});

// AA2. reused fields group under their REAL section (ASSET -> Header), IoT fields -> caseSectionId.
test('AA2. createBody groups fields by real section', () => {
    const r = repo({ reusedFieldSections: { ASSET: '2136' } });
    const body = r.createBody(r.projectCreate(makeCase()), '2424');
    const bySec = {}; for (const s of body.sections) bySec[s.link] = s.fields.map(f => f.__self__.split('/fields/').pop()).sort();
    assert.deepStrictEqual(bySec['/api/v3/workspaces/907/sections/2136'], ['ASSET']);
    assert.deepStrictEqual(bySec['/api/v3/workspaces/907/sections/2424'], ['ANOMALY_AT_DETECTION', 'CONDITION_EVENT_ID', 'PRIMARY_DRIVER', 'SOURCE']);
});

// BB. PATCH body uses ITEM-level field + section links.
test('BB. patchBody uses item-level links', () => {
    const r = repo({});
    const body = r.patchBody('777', r.projectFinding(makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'c' })), '2500');
    assert.strictEqual(body.sections[0].link, '/api/v3/workspaces/907/items/777/views/1/sections/2500');
    const f = body.sections[0].fields.find(x => x.__self__.endsWith('/fields/ASSESSMENT'));
    assert.strictEqual(f.__self__, '/api/v3/workspaces/907/items/777/views/1/fields/ASSESSMENT');
    assert.deepStrictEqual(f.value, { link: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_ASSESSMENT/options/2' });
});

// CC. an unmappable pick-list value is never written (blocked, no HTTP).
test('CC. unmapped pick-list value blocks a live create', async () => {
    const t = spyTransport();
    // inject a resolver so the sim-style asset resolves, but give a bogus driver value
    const r = repo({ fusionManageCaseWrites: true, caseSectionId: '2500', impersonateUser: 'u@x', tenantLink: 'https://t' },
        { transport: t, resolveAssetRef: () => ({ link: '/api/v3/workspaces/904/items/30057' }) });
    const res = await r.create(makeCase({ primaryDriver: 'bogus-driver' }));
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /LIVE_CREATE_BLOCKED: UNMAPPED_PICKLIST_VALUE PRIMARY_DRIVER=bogus-driver/);
    assert.strictEqual(t.calls.create, 0);
});

// DD. live create without a configured section id is blocked (no HTTP).
test('DD. missing caseSectionId blocks a live create', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: true, impersonateUser: 'u@x', tenantLink: 'https://t' }, { transport: t }).create(makeCase());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'LIVE_CREATE_BLOCKED: NO_SECTION_ID');
    assert.strictEqual(t.calls.create, 0);
});

// EE. the default transport is auth-capable: it fetches a bearer and attaches it; create returns the location.
test('EE. fmTransport authenticates (bearer) and returns the item location', async () => {
    const calls = [];
    const http = {
        post: async (url, body, opts) => {
            calls.push({ url, auth: opts && opts.headers && opts.headers.authorization, bearer: opts && opts.headers && opts.headers.Authorization });
            if (url.includes('/authentication/')) return { data: { access_token: 'tok-123', expires_in: 3600 } };
            return { headers: { location: '/api/v3/workspaces/907/items/4242' } };
        },
        patch: async () => ({ data: {} }),
    };
    const tr = createFmTransport({ adminClientId: 'id', adminClientSecret: 'sec', impersonateUser: 'u@x' }, http);
    const loc = await tr.create('https://t/api/v3/workspaces/907/items', { sections: [] }, { 'X-user-id': 'u@x' });
    assert.strictEqual(loc, '/api/v3/workspaces/907/items/4242');
    const createCall = calls.find(c => !c.url.includes('/authentication/'));
    assert.strictEqual(createCall.bearer, 'Bearer tok-123', 'create carries the bearer token');
});

// FF. dry-run builds/uses no transport at all (no injected transport, gate off).
test('FF. dry-run needs no transport', async () => {
    const r = createFusionManageCaseRepository({ caseWorkspaceId: '907', assetWorkspaceId: '904', fusionManageCaseWrites: false });
    const res = await r.create(makeCase());   // must not throw / must not try to build a real transport
    assert.strictEqual(res.dryRun, true);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.retry, false);
});

// GG. URGENCY (mandatory on 907 create) is projected from config.caseDefaultUrgency, never from anomaly.
test('GG. URGENCY is projected from config.caseDefaultUrgency', () => {
    assert.strictEqual(repo({ caseDefaultUrgency: 'Low' }).projectCreate(makeCase()).fields.URGENCY, 'Low');
    // not configured -> not projected (so the live blocker can report NO_URGENCY rather than send a blank)
    assert.ok(!('URGENCY' in repo({}).projectCreate(makeCase()).fields));
    // never derived from the anomaly score
    assert.strictEqual(repo({ caseDefaultUrgency: 'Low' }).projectCreate(makeCase({ anomalyAtDetection: 1 })).fields.URGENCY, 'Low');
});

// GG2. URGENCY serializes to its tenant lookup option link (from config.urgencyOptions), grouped into Header.
test('GG2. URGENCY wire value is the configured lookup option link, in its real section', () => {
    const r = repo({
        caseDefaultUrgency: 'Low',
        urgencyOptions: { Low: '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/1' },
        reusedFieldSections: { ASSET: '2136', URGENCY: '2136' },
    });
    const body = r.createBody(r.projectCreate(makeCase()), '2424');
    const bySec = {}; for (const s of body.sections) for (const f of s.fields) bySec[f.__self__.split('/fields/').pop()] = { sec: s.link, value: f.value };
    assert.deepStrictEqual(bySec.URGENCY.value, { link: '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/1' });
    assert.strictEqual(bySec.URGENCY.sec, '/api/v3/workspaces/907/sections/2136');
});

// HH. a live create with URGENCY unconfigured is blocked (NO_URGENCY) — no HTTP.
test('HH. missing caseDefaultUrgency blocks a live create', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '2424', impersonateUser: 'u@x', tenantLink: 'https://t' },
        { transport: t, resolveAssetRef: () => ({ link: '/api/v3/workspaces/904/items/30057' }) }).create(makeCase());
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.error, 'LIVE_CREATE_BLOCKED: NO_URGENCY');
    assert.strictEqual(t.calls.create, 0);
});

// II. a configured URGENCY value with NO verified option mapping is blocked (never guessed) — no HTTP.
test('II. urgency value without a lookup-option mapping blocks a live create', async () => {
    const t = spyTransport();
    const res = await repo({ fusionManageCaseWrites: true, caseSectionId: '2424', impersonateUser: 'u@x', tenantLink: 'https://t', caseDefaultUrgency: 'Low' },
        { transport: t, resolveAssetRef: () => ({ link: '/api/v3/workspaces/904/items/30057' }) }).create(makeCase());
    assert.strictEqual(res.ok, false);
    assert.match(res.error, /LIVE_CREATE_BLOCKED: UNMAPPED_PICKLIST_VALUE URGENCY=Low/);
    assert.strictEqual(t.calls.create, 0);
});

// JJ. EXACT 6-field predictive dry-run body: DATE_SUBMITTED is system-managed/read-only.
test('JJ. predictive create projects exactly the 6 contract fields across their two real sections', () => {
    const r = repo({
        caseDefaultUrgency: 'Low',
        urgencyOptions: { Low: '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/1' },
        reusedFieldSections: { ASSET: '2136', URGENCY: '2136' },
    });
    const body = r.createBody(r.projectCreate(makeCase()), '2424');
    const bySec = {};
    for (const s of body.sections) bySec[s.link] = s.fields.map(f => f.__self__.split('/fields/').pop()).sort();
    assert.deepStrictEqual(bySec['/api/v3/workspaces/907/sections/2136'], ['ASSET', 'URGENCY']);
    assert.deepStrictEqual(bySec['/api/v3/workspaces/907/sections/2424'], ['ANOMALY_AT_DETECTION', 'CONDITION_EVENT_ID', 'PRIMARY_DRIVER', 'SOURCE']);
    assert.ok(!Object.hasOwn(r.projectCreate(makeCase()).fields, 'DATE_SUBMITTED'));
    // exactly 6 fields total, no extras (no system-managed/date/finding/outcome/ID/LEARNING_CASE_ID leaked into create)
    assert.strictEqual(body.sections.reduce((n, s) => n + s.fields.length, 0), 6);
});

// KK. anomaly fields keep precision 2 even when the deployment runs the SUMMARY writer at floatDecimals=1.
test('KK. maintenance-case anomaly fields serialize at 2 decimals under global floatDecimals=1', () => {
    const r = repo({ floatDecimals: 1 });
    assert.strictEqual(r.projectCreate(makeCase({ anomalyAtDetection: 0.91 })).fields.ANOMALY_AT_DETECTION, '0.91');
    assert.strictEqual(r.projectOutcome(makeCase({ outcome: { telemetryImproved: true, anomalyAfter: 0.37 } })).fields.ANOMALY_AFTER, '0.37');
});

// KK2. case per-field precision is overridable via config.caseFloatDecimalsByField; unlisted fields keep the default (2).
test('KK2. caseFloatDecimalsByField overrides a case float precision without affecting the other', () => {
    const r = repo({ floatDecimals: 1, caseFloatDecimalsByField: { ANOMALY_AT_DETECTION: 3 } });
    assert.strictEqual(r.projectCreate(makeCase({ anomalyAtDetection: 0.126 })).fields.ANOMALY_AT_DETECTION, '0.126');
    assert.strictEqual(r.projectOutcome(makeCase({ outcome: { anomalyAfter: 0.37 } })).fields.ANOMALY_AFTER, '0.37');
});

// KK3. the global floatDecimals default (2) is unchanged for the case when no deployment override is set.
test('KK3. default case precision is 2 (unchanged) when floatDecimals is unset', () => {
    const r = repo({});
    assert.strictEqual(r.projectCreate(makeCase({ anomalyAtDetection: 0.126 })).fields.ANOMALY_AT_DETECTION, '0.13');
    assert.strictEqual(r.projectOutcome(makeCase({ outcome: { anomalyAfter: 0.03 } })).fields.ANOMALY_AFTER, '0.03');
});

// Z. raw telemetry never projected
test('Z. no raw telemetry (vibration/temperature/metrics) is ever projected', () => {
    const r = repo({});
    const k = makeCase({ assessment: 'CONFIRMED_ISSUE', confirmedCause: 'c', action: { type: 'REPAIR', description: 'd' }, outcome: { telemetryImproved: true, anomalyAfter: 0.1 } });
    for (const proj of [r.projectCreate(k), r.projectFinding(k), r.projectAction(k), r.projectOutcome(k)]) {
        const keys = Object.keys(proj.fields).join(',').toLowerCase();
        assert.ok(!/vibration|temperature|humidity|metric|velocity|acceleration/.test(keys), 'raw telemetry leaked: ' + keys);
    }
});
