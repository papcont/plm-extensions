// Operator-gated Maintenance Case flow (durable event -> preview -> explicit confirm -> ONE gated FM create).
// No live FM item is ever written here: the FM writer is exercised through a spy transport only.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMaintenanceCaseFlow, CONFIRM } = require('../../services/iot/maintenanceCaseFlow');
const { createCaseLinkStore } = require('../../services/iot/caseLinkStore');
const { createCaseRepository } = require('../../services/iot/caseRepository');
const { createEventRepository } = require('../../services/iot/eventRepository');
const { createFusionManageCaseRepository } = require('../../services/iot/fusionManageCaseRepository');

const ESC = { schemaVersion: 1, eventId: 'e1fd4781-af83-40df-a243-0f65d7713eb1', assetId: '30057', deviceId: 'lht65n-vib-01', type: 'ESCALATION',
    from: 'NORMAL', to: 'OBSERVE', severity: 'OBSERVE', timestamp: '2026-10-07T14:24:32.709Z', detectedAt: '2026-10-07T14:24:32.709Z',
    healthScore: 70, anomalyScore: 0.3037, primaryDriver: 'vibration', reason: 'Recurrent learned-band deviation: 2 learned-band crossings within 180 s', status: 'OPEN',
    metrics: { vibration: 0.12, vibrationUnit: 'g', temperature: 29.08 }, baselineRef: { vibration: { median: 0.035, mad: 0.015, upper: 0.1017 } } };
const REC = Object.assign({}, ESC, { eventId: 'c2ab7418-a766-4659-a7a7-17e17011590e', type: 'RECOVERY', from: 'OBSERVE', to: 'NORMAL', severity: 'NORMAL', timestamp: '2026-10-07T14:25:23.733Z' });

const STATE = { summary: { condition: 'NORMAL', healthScore: 100, vibration: 0.02, temperature: 29.08, lastTelemetry: '2026-10-07T16:50:01.325Z' },
    analytics: { anomalyScore: 0, primaryDriver: 'vibration', baselineFrozen: true, baselineFrozenAt: '2026-10-07T12:06:54.000Z', sampleCount: 200,
        baseline: { vibration: { median: 0.035, mad: 0.015, upper: 0.1017 } } } };

function spyTransport() {
    const calls = { create: 0, patch: 0, bodies: [] };
    return { calls, create: async (url, body) => { calls.create++; calls.bodies.push({ url, body }); return '/api/v3/workspaces/907/items/555'; },
        patch: async () => { calls.patch++; return {}; } };
}
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'iot-case-')); }

// A flow with in-memory events (+ optional durable link dir), spy FM transport, no network.
function setup({ gate = false, events = [ESC, REC], durable = true, search = undefined, lastInsight = null, readAsset = null, urgency = true } = {}) {
    const dir = tmpDir();
    const config = { fusionManageCaseWrites: gate, fusionManageWrites: true, caseWorkspaceId: '907', assetWorkspaceId: '904', caseSectionId: '2424',
        reusedFieldSections: { ASSET: '2136', URGENCY: '2136' }, caseDefaultUrgency: urgency ? 'Predictive Service' : '',
        urgencyOptions: { 'Predictive Service': '/api/v3/lookups/CUSTOM_LOOKUP_ASSET_SERVICE_URGENCY/options/3' },
        impersonateUser: 'svc@example.test', tenantLink: 'https://tenant.test', floatDecimals: 1,
        eventPersistenceEnabled: durable, eventStorePath: path.join(dir, 'events'), telemetryStorePath: path.join(dir, 'telemetry') };
    const evRepo = createEventRepository(config, { log() {} });
    for (const e of events) evRepo.append(e);
    const linkStore = createCaseLinkStore(config, { log() {} });
    const caseRepo = createCaseRepository({ resolveConditionEvent: id => evRepo.find(id), assetWorkspaceId: '904' });
    const transport = spyTransport();
    const fmCaseRepo = createFusionManageCaseRepository(config, { transport });
    const flow = createMaintenanceCaseFlow({ config, events: evRepo, linkStore, caseRepo, fmCaseRepo, getState: () => STATE,
        readAsset, searchByEventId: search === undefined ? (async () => []) : search, lastInsight, logger: { log() {} } });
    return { flow, transport, linkStore, config, dir };
}

test('A. no durable event -> no preview, no create eligibility', async () => {
    const { flow, transport } = setup({ events: [] });
    const p = await flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.strictEqual(p.error, 'UNKNOWN_EVENT'); assert.strictEqual(p.status, 404);
    const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.error, 'UNKNOWN_EVENT'); assert.strictEqual(transport.calls.create, 0);
});

test('B. real ESCALATION event -> preview with event, snapshot, baseline, mapping, idempotency; nothing written', async () => {
    const { flow, transport } = setup();
    const p = await flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.strictEqual(p.eligible, true); assert.strictEqual(p.source, 'CONDITION_EVENT');
    assert.strictEqual(p.event.eventId, ESC.eventId); assert.strictEqual(p.event.from, 'NORMAL'); assert.strictEqual(p.event.to, 'OBSERVE');
    assert.strictEqual(p.event.reason, ESC.reason); assert.strictEqual(p.event.anomalyScore, 0.3037);
    assert.strictEqual(p.conditionSnapshot.condition, 'NORMAL'); assert.strictEqual(p.conditionSnapshot.vibrationG, 0.02);
    assert.deepStrictEqual(p.baseline, { frozen: true, frozenAt: '2026-10-07T12:06:54.000Z', medianG: 0.035, madG: 0.015, upperBandG: 0.1017, sampleCount: 200 });
    assert.deepStrictEqual(p.fieldMapping.fields, { SOURCE: 'CONDITION_EVENT', CONDITION_EVENT_ID: ESC.eventId, ANOMALY_AT_DETECTION: '0.3', PRIMARY_DRIVER: 'vibration', URGENCY: 'Predictive Service' });
    assert.deepStrictEqual(p.fieldMapping.references.ASSET, { link: '/api/v3/workspaces/904/items/30057' });
    assert.strictEqual(p.fieldMapping.initialWorkflow, 'Definition');
    assert.strictEqual(p.fieldMapping.assessment, null); assert.strictEqual(p.fieldMapping.confirmedCause, null);
    assert.ok(p.wireBody && p.wireBody.sections.length === 2);
    assert.strictEqual(p.idempotency.localLink, null); assert.strictEqual(p.idempotency.fmSearch.status, 'ok');
    assert.strictEqual(p.writeEnabled, false); assert.deepStrictEqual(p.blockers, ['WRITE_DISABLED']);
    assert.strictEqual(transport.calls.create, 0);
});

test('C. RECOVERY event is not a case trigger', async () => {
    const { flow, transport } = setup();
    const p = await flow.preview({ assetId: '30057', eventId: REC.eventId });
    assert.strictEqual(p.error, 'EVENT_NOT_ELIGIBLE'); assert.strictEqual(p.status, 409);
    const c = await flow.create({ assetId: '30057', eventId: REC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.error, 'EVENT_NOT_ELIGIBLE'); assert.strictEqual(transport.calls.create, 0);
});

test('D. write gate false -> create returns WRITE_DISABLED (503), zero FM mutation, no link', async () => {
    const { flow, transport, linkStore } = setup({ gate: false });
    const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.deepStrictEqual(c, { error: 'WRITE_DISABLED', status: 503, writeEnabled: false });
    assert.strictEqual(transport.calls.create, 0); assert.strictEqual(linkStore.get(ESC.eventId), null);
});

test('E. gate true + confirmation missing/wrong -> rejected, zero FM mutation', async () => {
    const { flow, transport } = setup({ gate: true });
    for (const confirm of [undefined, '', 'yes', 'create_maintenance_case', 'CREATE']) {
        const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm });
        assert.strictEqual(c.error, 'CONFIRMATION_REQUIRED'); assert.strictEqual(c.status, 400);
    }
    assert.strictEqual(transport.calls.create, 0);
});

test('F. gate true + exact confirm + valid event -> one mocked create, machine facts only, link persisted', async () => {
    const { flow, transport, linkStore } = setup({ gate: true });
    const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.outcome, 'created'); assert.strictEqual(c.fmDmsId, '555'); assert.strictEqual(c.workflow, 'Definition');
    assert.strictEqual(c.conditionEventId, ESC.eventId); assert.strictEqual(c.durable, true);
    assert.strictEqual(transport.calls.create, 1);
    const body = transport.calls.bodies[0];
    assert.strictEqual(body.url, 'https://tenant.test/api/v3/workspaces/907/items');
    const sent = {};
    for (const s of body.body.sections) for (const f of s.fields) sent[f.__self__.split('/').pop()] = f.value;
    assert.deepStrictEqual(Object.keys(sent).sort(), ['ANOMALY_AT_DETECTION', 'ASSET', 'CONDITION_EVENT_ID', 'PRIMARY_DRIVER', 'SOURCE', 'URGENCY']);
    assert.strictEqual(sent.CONDITION_EVENT_ID, ESC.eventId);
    assert.deepStrictEqual(sent.SOURCE, { link: '/api/v3/lookups/CUSTOM_LOOKUP_IOT_SOURCE/options/2' });
    assert.deepStrictEqual(sent.ASSET, { link: '/api/v3/workspaces/904/items/30057' });
    const link = linkStore.get(ESC.eventId);
    assert.strictEqual(link.fmDmsId, '555'); assert.strictEqual(link.assetId, '30057');
});

test('G. same event twice -> existing case returned, no duplicate create; survives a restart of the link store', async () => {
    const s = setup({ gate: true });
    const first = await s.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    const second = await s.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(first.outcome, 'created'); assert.strictEqual(second.outcome, 'existing'); assert.strictEqual(second.fmDmsId, '555');
    assert.strictEqual(s.transport.calls.create, 1);
    const reloaded = createCaseLinkStore(s.config, { log() {} });             // new process, same file
    assert.strictEqual(reloaded.get(ESC.eventId).fmDmsId, '555');
    const p = await s.flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.ok(p.blockers.includes('ALREADY_LINKED')); assert.strictEqual(p.existingCase.fmDmsId, '555');
});

test('G2. FM already holds an item for the event (search) -> adopted, no create; two items -> refused', async () => {
    const one = setup({ gate: true, search: async () => ['777'] });
    const c = await one.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.outcome, 'existing'); assert.strictEqual(c.reconciled, true); assert.strictEqual(c.fmDmsId, '777');
    assert.strictEqual(one.transport.calls.create, 0); assert.strictEqual(one.linkStore.get(ESC.eventId).fmDmsId, '777');
    const two = setup({ gate: true, search: async () => ['777', '778'] });
    const d = await two.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(d.error, 'DUPLICATE_BUSINESS_KEY'); assert.strictEqual(two.transport.calls.create, 0);
});

test('G3. FM search failing -> create refused (no blind create); search path absent -> documented, create allowed', async () => {
    const failing = setup({ gate: true, search: async () => { throw new Error('boom'); } });
    const c = await failing.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.error, 'FM_SEARCH_UNAVAILABLE'); assert.strictEqual(failing.transport.calls.create, 0);
    const none = setup({ gate: true, search: null });
    const p = await none.flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.strictEqual(p.idempotency.fmSearch.error, 'RECONCILE_PATH_UNAVAILABLE');
    const d = await none.flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(d.outcome, 'created'); assert.strictEqual(none.transport.calls.create, 1);
});

test('H. AI output absent and asset read failing -> preview still works', async () => {
    const { flow } = setup({ lastInsight: () => null, readAsset: async () => { throw new Error('FM down'); } });
    const p = await flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.strictEqual(p.eligible, true); assert.strictEqual(p.aiSummary, null); assert.strictEqual(p.asset.id, '30057'); assert.strictEqual(p.asset.title, null);
});

test('I. AI output present -> summary is context only; never in fields, never confirmedCause', async () => {
    const lastInsight = mode => mode === 'explain_asset_state'
        ? { insight: { summary: 'AI-SUMMARY bearing could be failing' }, at: '2026-10-07T16:48:00Z', assetId: '30057' }
        : { insight: { headline: 'AI-HEADLINE' }, at: '2026-10-07T16:49:00Z', assetId: '30057' };
    const { flow, transport } = setup({ gate: true, lastInsight });
    const p = await flow.preview({ assetId: '30057', eventId: ESC.eventId });
    assert.strictEqual(p.aiSummary.explainSummary, 'AI-SUMMARY bearing could be failing'); assert.strictEqual(p.aiSummary.briefingHeadline, 'AI-HEADLINE');
    assert.ok(!JSON.stringify(p.fieldMapping).includes('AI-') && !JSON.stringify(p.wireBody).includes('AI-'));
    await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.ok(!JSON.stringify(transport.calls.bodies[0]).includes('AI-'));
});

test('J+K+L. confirmedCause/assessment never sent, workflow Definition, no transition call', async () => {
    const { flow, transport } = setup({ gate: true });
    const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    const sent = JSON.stringify(transport.calls.bodies[0].body);
    for (const forbidden of ['CONFIRMED_CAUSE', 'ASSESSMENT', 'CONFIRMED_ISSUE', 'workflow', 'transition', 'TELEMETRY_IMPROVED', 'LEARNING_CASE_ID']) assert.ok(!sent.includes(forbidden), forbidden);
    assert.strictEqual(c.workflow, 'Definition'); assert.strictEqual(transport.calls.patch, 0);
});

test('M. malformed / unknown / foreign-asset eventId -> safe error, nothing written', async () => {
    const { flow, transport } = setup({ gate: true, events: [ESC, Object.assign({}, ESC, { eventId: 'other-asset-evt-1', assetId: '99999' })] });
    for (const [eventId, error] of [[null, 'INVALID_EVENT_ID'], ['', 'INVALID_EVENT_ID'], ['../../etc', 'INVALID_EVENT_ID'], ['x'.repeat(80), 'INVALID_EVENT_ID'],
        ['00000000-0000-0000-0000-000000000000', 'UNKNOWN_EVENT'], ['other-asset-evt-1', 'UNKNOWN_EVENT']]) {
        const c = await flow.create({ assetId: '30057', eventId, confirm: CONFIRM });
        assert.strictEqual(c.error, error, String(eventId));
    }
    assert.strictEqual(transport.calls.create, 0);
});

test('N. link store is durable only with event persistence; create still succeeds but reports durable:false', async () => {
    const { flow, transport, linkStore } = setup({ gate: true, durable: false });
    assert.strictEqual(linkStore.durable, false);
    const c = await flow.create({ assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
    assert.strictEqual(c.outcome, 'created'); assert.strictEqual(c.durable, false); assert.strictEqual(transport.calls.create, 1);
});

test('routes: preview GET + create POST — exact body, allowlist, confirm, gate off 503, no secret/context leak', async () => {
    const http = require('http'), express = require('express');
    const iotConfig = require('../../services/iot/config');
    const service = require('../../services/iot/service');
    const routePath = require.resolve('../../routes/iot');
    const dir = tmpDir();
    const rt = service.createRuntime({ eventPersistenceEnabled: true, eventStorePath: path.join(dir, 'events'), telemetryStorePath: path.join(dir, 'telemetry'), fusionManageCaseWrites: false });
    rt.events.append(ESC); rt.events.append(REC);
    const origShared = service.getShared; service.getShared = () => rt;
    const oldGate = iotConfig.fusionManageCaseWrites; iotConfig.fusionManageCaseWrites = false;
    iotConfig.adminClientSecret = ['TEST', '_ONLY', '_SECRET'].join('');
    delete require.cache[routePath];
    const app = express(); app.use(express.json()); app.use('/iot', require('../../routes/iot'));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const call = (method, p, body) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p, method, headers: { 'content-type': 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
    });
    try {
        const pv = await call('GET', '/iot/maintenance-case/preview?assetId=30057&eventId=' + ESC.eventId);
        assert.strictEqual(pv.status, 200);
        const data = JSON.parse(pv.body).data;
        assert.strictEqual(data.writeEnabled, false); assert.strictEqual(data.event.eventId, ESC.eventId);
        assert.doesNotMatch(pv.body, /TEST_ONLY_SECRET|adminClientSecret|apiKey|Bearer/);
        assert.strictEqual((await call('GET', '/iot/maintenance-case/preview?assetId=1&eventId=' + ESC.eventId)).status, 403);
        assert.strictEqual((await call('GET', '/iot/maintenance-case/preview?assetId=30057&eventId=' + REC.eventId)).status, 409);
        assert.strictEqual((await call('POST', '/iot/maintenance-case/create', { assetId: '30057', eventId: ESC.eventId })).status, 400);
        assert.strictEqual((await call('POST', '/iot/maintenance-case/create', { assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM, extra: 1 })).status, 400);
        assert.strictEqual((await call('POST', '/iot/maintenance-case/create', { assetId: '30057', eventId: ESC.eventId, confirm: 'nope' })).status, 400);
        assert.strictEqual((await call('POST', '/iot/maintenance-case/create', { assetId: '1', eventId: ESC.eventId, confirm: CONFIRM })).status, 403);
        const off = await call('POST', '/iot/maintenance-case/create', { assetId: '30057', eventId: ESC.eventId, confirm: CONFIRM });
        assert.strictEqual(off.status, 503);
        assert.deepStrictEqual(JSON.parse(off.body), { success: false, message: 'WRITE_DISABLED', writeEnabled: false });
        assert.strictEqual(rt.caseLinks.get(ESC.eventId), null);
        assert.strictEqual((await call('GET', '/iot/maintenance-case/preview')).status, 403);
    } finally {
        server.close(); service.getShared = origShared; iotConfig.fusionManageCaseWrites = oldGate; iotConfig.adminClientSecret = ''; delete require.cache[routePath];
    }
});
