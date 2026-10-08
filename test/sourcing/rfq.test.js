// RFQ draft + controlled flow: preview -> explicit confirm -> separate write gate -> idempotency -> ONE write.
// Scenario 10 (write disabled => zero mutation). Spy writer only; no Fusion Manage, no network.
const { test } = require('node:test');
const assert = require('node:assert');

const { buildRfqDraft, createRfqFlow, CONFIRM } = require('../../services/sourcing/rfq');
const { createSourcingService } = require('../../services/sourcing/service');
const data = require('../../services/sourcing/demoData');

const NOW = '2026-10-07T00:00:00.000Z';
const REQ = { itemId: 'ITM-1001', quantity: 100, requiredDate: '2026-12-06' };
function spyWriter() {
    const calls = { project: 0, create: 0, drafts: [] };
    return { calls, project: d => { calls.project++; return { target: 'mock', suppliers: d.suppliers.map(s => s.supplierId) }; },
        create: async d => { calls.create++; calls.drafts.push(d); return { ok: true, ref: 'RFQ-MOCK-1' }; } };
}
function setup({ gate = false, writer = spyWriter() } = {}) {
    const config = { rfqWrites: gate };
    const s = createSourcingService({ config, data, writer, now: () => NOW });
    return { s, writer, config, flow: s.rfq };
}

test('10. write disabled (default) => preview is dry-run with blockers, create is refused, writer never called', async () => {
    const { flow, writer } = setup();
    const p = await flow.preview(Object.assign({ supplierIds: ['SUP-A', 'SUP-C'] }, REQ));
    assert.strictEqual(p.dryRun, true); assert.strictEqual(p.writeEnabled, false);
    assert.ok(p.blockers.includes('WRITE_DISABLED')); assert.strictEqual(p.existing, null);
    assert.strictEqual(p.draft.suppliers.length, 2); assert.strictEqual(p.projected.target, 'mock');
    const c = await flow.create(Object.assign({ supplierIds: ['SUP-A', 'SUP-C'], confirm: CONFIRM }, REQ));
    assert.deepStrictEqual(c, { error: 'WRITE_DISABLED', status: 503, writeEnabled: false });
    assert.strictEqual(writer.calls.create, 0);
});

test('confirmation is required before anything else; wrong token is rejected with zero writes', async () => {
    const { flow, writer } = setup({ gate: true });
    for (const confirm of [undefined, '', 'yes', 'create_rfq_draft']) {
        const r = await flow.create(Object.assign({ supplierIds: ['SUP-A'], confirm }, REQ));
        assert.strictEqual(r.error, 'CONFIRMATION_REQUIRED'); assert.strictEqual(r.status, 400);
    }
    assert.strictEqual(writer.calls.create, 0);
});

test('a technically failed supplier can never be part of an RFQ draft', async () => {
    const { s, flow, writer } = setup({ gate: true });
    const a = await s.analyze(REQ);
    const d = buildRfqDraft(a, ['SUP-A', 'SUP-B']);
    assert.strictEqual(d.error, 'SUPPLIER_TECHNICALLY_FAILED'); assert.strictEqual(d.supplierId, 'SUP-B'); assert.ok(d.reasons.length);
    const c = await flow.create(Object.assign({ supplierIds: ['SUP-B'], confirm: CONFIRM }, REQ));
    assert.strictEqual(c.error, 'SUPPLIER_TECHNICALLY_FAILED'); assert.strictEqual(writer.calls.create, 0);
    assert.strictEqual(buildRfqDraft(a, ['SUP-ZZ']).error, 'UNKNOWN_SUPPLIER');
    assert.strictEqual(buildRfqDraft(a, []).error, 'NO_SUPPLIERS');
    assert.strictEqual(buildRfqDraft(a, ['SUP-F']).draft.suppliers[0].technicalStatus, 'UNKNOWN', 'UNKNOWN may be asked (that is what an RFQ clarifies)');
});

test('draft is deterministic: same request => same rfqKey, open questions derive from missing data, FAIL excluded', async () => {
    const { s } = setup();
    const a = await s.analyze(REQ);
    const d1 = buildRfqDraft(a, ['SUP-C', 'SUP-A'], { now: NOW }).draft, d2 = buildRfqDraft(a, ['SUP-A', 'SUP-C'], { now: NOW }).draft;
    assert.strictEqual(d1.rfqKey, d2.rfqKey); assert.strictEqual(d1.rfqKey.length, 32);
    assert.notStrictEqual(d1.rfqKey, buildRfqDraft(a, ['SUP-A']).draft.rfqKey);
    const C = d1.suppliers.find(x => x.supplierId === 'SUP-C');
    assert.ok(C.openQuestions.some(q => /quality record/.test(q))); assert.strictEqual(d1.suppliers.find(x => x.supplierId === 'SUP-A').openQuestions.length, 0);
    assert.strictEqual(d1.engine.recommendedSupplierId, 'SUP-A'); assert.strictEqual(d1.status, 'DRAFT'); assert.strictEqual(d1.quantity, 100);
});

test('gate ON + confirm + writer => exactly one write; the same key is idempotent afterwards', async () => {
    const { flow, writer } = setup({ gate: true });
    const params = Object.assign({ supplierIds: ['SUP-A', 'SUP-C'], confirm: CONFIRM }, REQ);
    const r1 = await flow.create(params);
    assert.deepStrictEqual(r1, { outcome: 'created', rfqKey: r1.rfqKey, ref: 'RFQ-MOCK-1' }); assert.strictEqual(writer.calls.create, 1);
    const r2 = await flow.create(params);
    assert.strictEqual(r2.outcome, 'existing'); assert.strictEqual(r2.rfqKey, r1.rfqKey); assert.strictEqual(writer.calls.create, 1);
    const p = await flow.preview(params);
    assert.ok(p.blockers.includes('ALREADY_CREATED')); assert.strictEqual(p.existing.ref, 'RFQ-MOCK-1');
    const other = await flow.create(Object.assign({}, params, { quantity: 101 }));
    assert.strictEqual(other.outcome, 'created'); assert.strictEqual(writer.calls.create, 2);
});

test('gate ON without a write target => NO_WRITE_TARGET, nothing created', async () => {
    const { flow } = setup({ gate: true, writer: null });
    const p = await flow.preview(Object.assign({ supplierIds: ['SUP-A'] }, REQ));
    assert.ok(p.blockers.includes('NO_WRITE_TARGET')); assert.strictEqual(p.projected, null);
    const c = await flow.create(Object.assign({ supplierIds: ['SUP-A'], confirm: CONFIRM }, REQ));
    assert.deepStrictEqual(c, { error: 'NO_WRITE_TARGET', status: 503 });
});

test('a failing writer is reported once, not retried, and leaves no idempotency record', async () => {
    const writer = { calls: 0, create: async () => { writer.calls++; return { ok: false, error: 'upstream 500' }; } };
    const { flow } = setup({ gate: true, writer });
    const params = Object.assign({ supplierIds: ['SUP-A'], confirm: CONFIRM }, REQ);
    const r = await flow.create(params);
    assert.strictEqual(r.error, 'CREATE_FAILED'); assert.strictEqual(r.status, 502); assert.strictEqual(writer.calls, 1);
    assert.strictEqual((await flow.preview(params)).existing, null);
});
