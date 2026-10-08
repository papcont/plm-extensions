const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSourcingService } = require('../../services/sourcing/service');
const { createHybridDataSource } = require('../../services/sourcing/dataSource');
const { decode, pairs } = require('../../services/sourcing/fmDataSource');

const item = { id: 'U-HALTER-800', title: 'U-Halter 800', family: 'sheet-metal', requirements: { process: 'LASER_CUTTING+BENDING', material: 'S235JR', maxDimensionMm: 800, certifications: [] }, source: 'fusion-manage' };
const supplier = { id: 'DEMO-SRC-SUP-001', name: 'Demo Supplier', country: null, status: null, source: 'fusion-manage' };
const capability = { supplierId: supplier.id, source: 'fusion-manage', processes: ['LASER_CUTTING+BENDING'], materials: ['S235JR'], maxDimensionMm: 1200, leadTimeDays: 4, capacityPerMonth: null, priceBreaks: [{ minQty: 10, unitPrice: 18.7 }] };

function source(provenance = {}) {
    return { name: 'fm', async load() { return { items: [item], suppliers: [supplier], capabilities: [capability], history: [], provenance: Object.assign({ item: 'fusion-manage', suppliers: 'fusion-manage', capabilities: 'fusion-manage', purchaseHistory: 'fusion-manage', similarity: 'unavailable' }, provenance) }; }, async similarity() { return { status: 'none', provider: null, rows: [] }; } };
}

test('FM text fields decode and preserve structured values', () => {
    assert.equal(decode('process&#61;LASER_CUTTING&#43;BENDING'), 'process=LASER_CUTTING+BENDING');
    assert.deepEqual(pairs('demo&#61;true; stableId&#61;DEMO-SRC-CAP-001'), { demo: 'true', stableId: 'DEMO-SRC-CAP-001' });
});

test('FM source has no local fallback and exposes provenance', async () => {
    const s = createSourcingService({ config: { rfqWrites: false }, source: source(), now: () => '2026-10-07T00:00:00.000Z' });
    const a = await s.analyze({ itemId: 'U-HALTER-800', quantity: 20, requiredDate: '2026-11-15' });
    assert.equal(a.dataSources.item, 'fusion-manage');
    assert.equal(a.dataSources.capabilities, 'fusion-manage');
    assert.equal(a.candidates.length, 1);
    assert.equal(a.candidates[0].technicalStatus, 'UNKNOWN', 'missing FM capacity stays UNKNOWN');
    await assert.rejects(() => s.analyze({ itemId: 'ITM-1001', quantity: 20 }), /UNKNOWN_ITEM/);
});

test('hybrid keeps FM facts and adds only explicit local similarity', async () => {
    const hybrid = createHybridDataSource(source());
    const s = createSourcingService({ config: { rfqWrites: false }, source: hybrid, now: () => '2026-10-07T00:00:00.000Z' });
    const a = await s.analyze({ itemId: 'U-HALTER-800', quantity: 20 });
    assert.equal(a.dataSources.item, 'fusion-manage');
    assert.equal(a.dataSources.similarity, 'history-family');
    assert.equal(a.similarity.provider, 'history-family');
});

test('hybrid adds labelled prototype capacity by stable supplier id; FM mode stays REVIEW', async () => {
    const meier = { id: 'DEMO-SRC-SUP-001', name: 'DEMO-SRC-SUP-001 Blechbieger Meier GmbH', source: 'fusion-manage' };
    const other = { id: 'DEMO-SRC-SUP-002', name: 'DEMO-SRC-SUP-002 Other', source: 'fusion-manage' };
    const cap = id => ({ supplierId: id, source: 'fusion-manage', processes: ['LASER_CUTTING+BENDING'], materials: ['S235JR'], maxDimensionMm: 1200, leadTimeDays: 4, capacityPerMonth: null, priceBreaks: [{ minQty: 10, unitPrice: 18.7 }] });
    const src = { name: 'fm', async load() { return { items: [item], suppliers: [meier, other], capabilities: [cap(meier.id), cap(other.id)], history: [], provenance: {} }; }, async similarity() { return { status: 'none', provider: null, rows: [] }; } };
    const run = async s => (await createSourcingService({ config: { rfqWrites: false }, source: s, now: () => '2026-10-07T00:00:00.000Z' }).analyze({ itemId: 'U-HALTER-800', quantity: 20 }));
    const fm = await run(src), hy = await run(createHybridDataSource(src));
    assert.equal(fm.summary.passCount, 0);
    assert.equal(fm.candidates.find(c => c.supplierId === meier.id).prototypeEvidence.length, 0);
    assert.equal(hy.recommendedSupplierId, meier.id);
    const m = hy.candidates.find(c => c.supplierId === meier.id);
    assert.equal(m.technicalChecks.find(t => t.check === 'capacity').source, 'prototype-local');
    assert.equal(m.technicalChecks.find(t => t.check === 'material').source, 'fusion-manage');
    assert.equal(hy.candidates.find(c => c.supplierId === other.id).technicalStatus, 'UNKNOWN');
});

test('FM records keep the dmsId they were read from; analysis exposes fmLinks only for FM records', async () => {
    const { createFmDataSource } = require('../../services/sourcing/fmDataSource');
    const { createDemoSourcingService } = require('../../services/sourcing/service');
    const f = (id, value) => ({ __self__: '/api/v3/workspaces/0/views/1/fields/' + id, value });
    const details = {
        '57/34051' : { title: 'U-Halter 800', sections: [{ fields: [f('DESCRIPTION', 'stableId&#61;DEMO-SRC-ITEM-001; process&#61;LASER_CUTTING&#43;BENDING'), f('TITLE', 'U-Halter 800'), f('DMS_ID', '999')] }] },
        '14/34012' : { title: 'Meier', sections: [{ fields: [f('NAME', 'DEMO-SRC-SUP-001 Blechbieger Meier GmbH'), f('DMS_ID', '999')] }] },
        '147/50001': { title: 'PO', sections: [{ fields: [f('NOTES', 'stableId&#61;DEMO-SRC-PO-0001; item&#61;DEMO-SRC-ITEM-001; supplier&#61;DEMO-SRC-SUP-001; quantity&#61;50'), f('NUMBER', 'X-1')] }] },
    };
    const readRepository = {
        async getItem(ws, dms) { return details[ws + '/' + dms]; },
        async listAllItems() { return [{ __self__: '/api/v3/workspaces/147/items/50001', descriptor: 'DEMO-SRC-PO-0001 Order' }]; },
    };
    const mapping = { workspaces: { items: { id: 57 }, suppliers: { id: 14 }, capabilities: { id: 63 }, purchaseHistory: { id: 147 }, rfq: { id: 148 } },
        primaryObject: { businessId: 'U-HALTER-800', fm: { dmsId: '34051' } }, relatedItems: { range: { dmsIds: [] } },
        suppliers: { dmsIds: { '001': '34012' } }, capabilities: { dmsIds: {} }, rfqAndQuotes: { records: [] } };
    const fm = createFmDataSource({ config: {}, mapping, readRepository });
    const d = await fm.load();
    assert.deepEqual(d.items[0].fm.record, { workspaceId: '57', dmsId: '34051' }, 'item link uses the GET dmsId, not the DMS_ID field');
    assert.deepEqual(d.suppliers[0].fm.record, { workspaceId: '14', dmsId: '34012' });
    assert.deepEqual(d.history[0].fm.record, { workspaceId: '147', dmsId: '50001' });

    const a = await createSourcingService({ config: { rfqWrites: false }, source: fm, now: () => '2026-10-07T00:00:00.000Z' }).analyze({ itemId: 'U-HALTER-800', quantity: 20 });
    assert.equal(a.fmLinks.items['U-HALTER-800'].dmsId, '34051');
    assert.equal(a.fmLinks.suppliers['DEMO-SRC-SUP-001'].dmsId, '34012');
    assert.equal(a.fmLinks.purchases['DEMO-SRC-PO-0001'].dmsId, '50001');

    const demo = await createDemoSourcingService().analyze({ itemId: 'ITM-1001', quantity: 100, requiredDate: null });
    for (const k of ['items', 'suppliers', 'capabilities', 'purchases']) assert.deepEqual(demo.fmLinks[k], {}, 'demo data never gets an FM link: ' + k);
});
