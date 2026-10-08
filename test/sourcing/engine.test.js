// Deterministic sourcing engine against the reproducible demo seed (fixed `now`). Scenarios 1-7 of the
// sourcing test plan + determinism/unit checks. No AI, no network, no Fusion Manage.
const { test } = require('node:test');
const assert = require('node:assert');

const engine = require('../../services/sourcing/engine');
const data = require('../../services/sourcing/demoData');
const { createSimilarityAdapter, createHistoryFamilyProvider } = require('../../services/sourcing/similarity');
const { createSourcingService } = require('../../services/sourcing/service');
const { TECH, CONFLICT } = require('../../services/sourcing/model');

const NOW = '2026-10-07T00:00:00.000Z';
const cfg = { rfqWrites: false };
function svc(opts = {}) {
    const similarity = opts.noSimilarity ? null : createSimilarityAdapter(createHistoryFamilyProvider({ items: data.items, history: data.history }));
    return createSourcingService({ config: cfg, data, similarity, now: () => NOW });
}
const by = (a, id) => a.candidates.find(c => c.supplierId === id);
const HOUSING = { itemId: 'ITM-1001', quantity: 100, requiredDate: '2026-12-06' };

test('1. technically valid supplier with clean history ranks first and is recommended', async () => {
    const a = await svc().analyze(HOUSING);
    assert.strictEqual(a.recommendedSupplierId, 'SUP-A');
    const A = by(a, 'SUP-A');
    assert.strictEqual(A.rank, 1); assert.strictEqual(A.technicalStatus, TECH.PASS);
    assert.ok(A.overallScore >= 95); assert.strictEqual(A.confidence, 'high'); assert.deepStrictEqual(A.missingData, []);
    assert.strictEqual(A.purchaseCount, 3); assert.strictEqual(A.qualityTrend, 'STABLE');
    assert.strictEqual(a.summary.passCount, 3); assert.strictEqual(a.summary.failCount, 3); assert.strictEqual(a.summary.unknownCount, 1);
});

test('2. cheapest suppliers are technical FAIL: no overall score, ranked after every PASS/UNKNOWN, never recommended', async () => {
    const a = await svc().analyze(HOUSING);
    const cheapest = a.candidates.filter(c => c.unitPrice != null).sort((x, y) => x.unitPrice - y.unitPrice)[0];
    assert.strictEqual(cheapest.supplierId, 'SUP-G');
    for (const id of ['SUP-G', 'SUP-B']) {
        const c = by(a, id);
        assert.strictEqual(c.technicalStatus, TECH.FAIL);
        assert.strictEqual(c.commercialScore, 100, 'price is visibly the best');     // transparency ...
        assert.strictEqual(c.overallScore, null);                                   // ... but no overall score
        assert.ok(c.rank > Math.max(...a.candidates.filter(x => x.technicalStatus !== TECH.FAIL).map(x => x.rank)));
        assert.ok(c.technicalReasons.length >= 1);
    }
    assert.match(by(a, 'SUP-B').technicalReasons[0], /toleranceClass: requires fine, supplier offers medium/);
    assert.notStrictEqual(a.recommendedSupplierId, 'SUP-B'); assert.notStrictEqual(a.recommendedSupplierId, 'SUP-G');
});

test('3. no history => null history/quality scores, missing data listed, confidence not high', async () => {
    const C = by(await svc().analyze(HOUSING), 'SUP-C');
    assert.strictEqual(C.technicalStatus, TECH.PASS);
    assert.strictEqual(C.historyScore, null); assert.strictEqual(C.qualityScore, null); assert.strictEqual(C.purchaseCount, 0);
    assert.ok(C.missingData.includes('history') && C.missingData.includes('qualityHistory'));
    assert.ok(C.dataCompleteness < 1); assert.notStrictEqual(C.confidence, 'high');
    assert.ok(C.overallScore != null, 'still scored on the data that exists');
});

test('4. capability FAIL with past purchases is surfaced as a conflict; FAIL stays authoritative', async () => {
    const a = await svc().analyze(HOUSING);
    const E = by(a, 'SUP-E');
    assert.strictEqual(E.technicalStatus, TECH.FAIL); assert.strictEqual(E.purchaseCount, 2);
    assert.strictEqual(E.conflicts.length, 1); assert.strictEqual(E.conflicts[0].type, CONFLICT.CAPABILITY_HISTORY);
    assert.match(E.conflicts[0].detail, /2 past purchase/);
    assert.ok(a.conflicts.some(c => c.supplierId === 'SUP-E' && c.type === CONFLICT.CAPABILITY_HISTORY));
    assert.strictEqual(E.overallScore, null);
});

test('5. urgent required date changes the ranking (short lead time wins, long lead time flagged LATE)', async () => {
    const relaxed = await svc().analyze(HOUSING);
    const urgent = await svc().analyze(Object.assign({}, HOUSING, { requiredDate: '2026-10-25' }));
    assert.strictEqual(relaxed.recommendedSupplierId, 'SUP-A');
    assert.strictEqual(urgent.recommendedSupplierId, 'SUP-C');
    assert.strictEqual(by(urgent, 'SUP-A').deliveryRisk, 'LATE'); assert.strictEqual(by(urgent, 'SUP-A').deliveryScore, 0);
    assert.strictEqual(by(urgent, 'SUP-C').deliveryRisk, null);
    assert.strictEqual(by(urgent, 'SUP-B').technicalStatus, TECH.FAIL, 'urgency never rescues a FAIL');
});

test('6. quantity changes the ranking through price breaks', async () => {
    const small = await svc().analyze({ itemId: 'ITM-2002', quantity: 50, requiredDate: '2026-12-06' });
    const large = await svc().analyze({ itemId: 'ITM-2002', quantity: 500, requiredDate: '2026-12-06' });
    assert.strictEqual(small.recommendedSupplierId, 'SUP-C'); assert.strictEqual(by(small, 'SUP-C').unitPrice, 26); assert.strictEqual(by(small, 'SUP-A').unitPrice, 30);
    assert.strictEqual(large.recommendedSupplierId, 'SUP-A'); assert.strictEqual(by(large, 'SUP-A').unitPrice, 21); assert.strictEqual(by(large, 'SUP-C').unitPrice, 25);
});

test('7. similar prior procurement adds history evidence; without a similarity provider sourcing still works', async () => {
    const req = { itemId: 'ITM-2002', quantity: 50, requiredDate: '2026-12-06' };
    const withSim = await svc().analyze(req);
    const noSim = await svc({ noSimilarity: true }).analyze(req);
    assert.strictEqual(withSim.similarity.status, 'ok'); assert.strictEqual(withSim.similarityEvidence.length, 2);
    assert.strictEqual(by(withSim, 'SUP-C').similarPurchaseCount, 2); assert.strictEqual(by(withSim, 'SUP-C').historyScore, 64);
    assert.strictEqual(by(withSim, 'SUP-C').evidence.similar[0].similarItemId, 'ITM-2001');
    assert.strictEqual(noSim.similarity.status, 'none'); assert.strictEqual(noSim.similarityEvidence.length, 0);
    assert.strictEqual(by(noSim, 'SUP-C').historyScore, null); assert.ok(by(noSim, 'SUP-C').missingData.includes('history'));
    // missing scores are excluded (neutral), never penalized or faked; evidence shows up as completeness/confidence
    assert.ok(by(withSim, 'SUP-C').dataCompleteness > by(noSim, 'SUP-C').dataCompleteness);
    assert.strictEqual(noSim.recommendedSupplierId, 'SUP-C', 'engine never blocks on similarity');
});

test('standard-profile alternative is surfaced with its last purchase', async () => {
    const a = await svc().analyze(HOUSING);
    assert.deepStrictEqual(a.standardAlternatives, [{ itemId: 'ITM-1001-STD', title: 'Flange housing, standard profile (catalog)', lastSupplierId: 'SUP-G', lastUnitPrice: 19, lastDate: '2026-06-02' }]);
});

test('poor quality trend lowers the quality score and is flagged', async () => {
    const D = by(await svc().analyze(HOUSING), 'SUP-D');
    assert.strictEqual(D.qualityTrend, 'WORSENING'); assert.ok(D.qualityScore < 30); assert.strictEqual(D.technicalStatus, TECH.PASS);
    assert.ok(D.rank > 2, 'quality trend pushes it below A and C despite the best price');
});

test('missing capability record => UNKNOWN (not FAIL, not PASS), every check unknown, nothing scored', async () => {
    const F = by(await svc().analyze(HOUSING), 'SUP-F');
    assert.strictEqual(F.technicalStatus, TECH.UNKNOWN);
    assert.ok(F.technicalChecks.filter(c => c.check !== 'supplierStatus').every(c => c.status === TECH.UNKNOWN));
    assert.strictEqual(F.overallScore, null); assert.ok(F.missingData.includes('capability'));
});

test('BLOCKED supplier and insufficient capacity are hard technical FAILs', () => {
    const item = data.items[0];
    const cap = data.capabilities.find(c => c.supplierId === 'SUP-A');
    assert.strictEqual(engine.technical(item, 100, { id: 'X', status: 'BLOCKED' }, cap).status, TECH.FAIL);
    const t = engine.technical(item, 5000, { id: 'SUP-A', status: 'APPROVED' }, cap);
    assert.strictEqual(t.status, TECH.FAIL); assert.match(t.reasons[0], /capacity: quantity 5000 exceeds monthly capacity 2000/);
});

test('no required date => delivery score null and requiredDate listed as missing; price breaks below the smallest tier fall back', async () => {
    const a = await svc().analyze({ itemId: 'ITM-1001', quantity: 100, requiredDate: null });
    assert.strictEqual(by(a, 'SUP-A').deliveryScore, null); assert.ok(by(a, 'SUP-A').missingData.includes('requiredDate'));
    assert.strictEqual(a.recommendedSupplierId, 'SUP-A');
    assert.strictEqual(engine.quotePrice({ priceBreaks: [{ minQty: 100, unitPrice: 9 }] }, 10), null);
});

test('determinism: identical inputs produce byte-identical output', async () => {
    const [x, y] = [await svc().analyze(HOUSING), await svc().analyze(HOUSING)];
    assert.strictEqual(JSON.stringify(x), JSON.stringify(y));
});

test('similarity adapter: rows are normalized, invalid rows dropped, provider errors are reported not thrown', async () => {
    const good = { similarItemId: 'I2', similarityScore: '0.75', historicalSupplier: 'S1', historicalPrice: '12.5', historicalQuantity: 10, historicalDate: '2026-01-01' };
    const ad = createSimilarityAdapter({ name: 'p', findSimilar: async () => [good, { similarItemId: 'I3', similarityScore: 1.4, historicalSupplier: 'S1' }, { similarItemId: 'I1', similarityScore: 0.9, historicalSupplier: 'S1' }, null] });
    const r = await ad.findSimilar({ id: 'I1' });
    assert.strictEqual(r.status, 'ok'); assert.deepStrictEqual(r.rows, [{ similarItemId: 'I2', similarityScore: 0.75, historicalSupplier: 'S1', historicalPrice: 12.5, historicalQuantity: 10, historicalDate: '2026-01-01' }]);
    const bad = createSimilarityAdapter({ name: 'p', findSimilar: async () => { throw new Error('boom'); } });
    assert.deepStrictEqual(await bad.findSimilar({ id: 'I1' }), { status: 'unavailable', provider: 'p', rows: [], error: 'boom' });
    assert.deepStrictEqual(await createSimilarityAdapter(null).findSimilar({ id: 'I1' }), { status: 'none', provider: null, rows: [] });
});
