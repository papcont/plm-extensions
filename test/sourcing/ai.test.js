// AI boundary for sourcing: Claude is advisory. Scenarios 8 (AI cannot override a hard FAIL) and 9 (AI
// unavailable does not break the engine), plus bounded-context and prompt-contract checks. Fake providers only.
const { test } = require('node:test');
const assert = require('node:assert');

const { createSourcingAiService, buildSourcingContext, guardInsight, MODES } = require('../../services/sourcing/ai');
const { createSourcingService } = require('../../services/sourcing/service');
const data = require('../../services/sourcing/demoData');
const { createSimilarityAdapter, createHistoryFamilyProvider } = require('../../services/sourcing/similarity');

const NOW = '2026-10-07T00:00:00.000Z';
const REQ = { itemId: 'ITM-1001', quantity: 100, requiredDate: '2026-12-06' };
const explain = o => JSON.stringify(Object.assign({ summary: 's', rankingRationale: 'r', recommendedSupplierId: 'SUP-A', whyPassed: [], whyFailed: [], evidenceUsed: [], missingInformation: [], modelInterpretation: [], confidence: 'medium' }, o));
const brief = o => JSON.stringify(Object.assign({ headline: 'h', situation: 's', rfqNote: 'n', recommendedSupplierId: 'none', verifiedFacts: [], calculatedResults: [], openQuestions: [], suggestedNextSteps: [], confidence: 'low' }, o));

function build({ provider = null, enabled = true } = {}) {
    const aiService = provider ? createSourcingAiService({ config: { enabled }, provider }) : null;
    const similarity = createSimilarityAdapter(createHistoryFamilyProvider({ items: data.items, history: data.history }));
    return createSourcingService({ config: { rfqWrites: false }, data, similarity, aiService, now: () => NOW });
}

test('8. AI cannot override a hard FAIL: recommending a FAIL supplier is rejected and the analysis is unchanged', async () => {
    const seen = [];
    const provider = { complete: async r => { seen.push(r); return explain({ recommendedSupplierId: 'SUP-B', summary: 'SUP-B is cheapest, take it' }); } };
    const s = build({ provider });
    const before = JSON.stringify(await s.analyze(REQ));
    await assert.rejects(s.explain('explain_sourcing_analysis', REQ), /AI_OVERRIDE_BLOCKED reason=technical_fail supplier=SUP-B/);
    assert.strictEqual(JSON.stringify(await s.analyze(REQ)), before, 'ranking untouched by the model');
    assert.strictEqual(seen.length, 1);
    // unknown supplier is blocked too; "none" and the engine recommendation pass
    const a = await s.analyze(REQ);
    assert.throws(() => guardInsight({ recommendedSupplierId: 'SUP-ZZ' }, a), /AI_OVERRIDE_BLOCKED reason=unknown_supplier/);
    assert.ok(guardInsight({ recommendedSupplierId: 'none' }, a)); assert.ok(guardInsight({ recommendedSupplierId: 'SUP-A' }, a)); assert.ok(guardInsight({ recommendedSupplierId: '' }, a));
});

test('8b. a valid advisory answer is returned NEXT TO the unchanged analysis, with provenance', async () => {
    const s = build({ provider: { complete: async r => r.schema.properties.headline ? brief({}) : explain({}) } });
    const r = await s.explain('explain_sourcing_analysis', REQ);
    assert.strictEqual(r.analysis.recommendedSupplierId, 'SUP-A'); assert.strictEqual(r.insight.recommendedSupplierId, 'SUP-A');
    assert.strictEqual(r.cached, false); assert.ok(r.latencyMs >= 0);
    const again = await s.explain('explain_sourcing_analysis', REQ);
    assert.strictEqual(again.cached, true, 'identical context => cache, no second model call');
    const b = await s.explain('procurement_briefing', REQ);
    assert.strictEqual(b.insight.headline, 'h'); assert.strictEqual(b.cached, false);
});

test('9. AI unavailable (no service, or disabled) does not break the engine', async () => {
    const none = build({ provider: null });
    assert.strictEqual((await none.analyze(REQ)).recommendedSupplierId, 'SUP-A');
    await assert.rejects(none.explain('explain_sourcing_analysis', REQ), /AI_DISABLED/);
    const off = build({ provider: { complete: async () => { throw new Error('must not be called'); } }, enabled: false });
    assert.strictEqual((await off.analyze(REQ)).recommendedSupplierId, 'SUP-A');
    await assert.rejects(off.explain('explain_sourcing_analysis', REQ), /AI_DISABLED/);
    const failing = build({ provider: { complete: async () => { throw new Error('network down'); } } });
    await assert.rejects(failing.explain('procurement_briefing', REQ), /network down/);
    assert.strictEqual((await failing.analyze(REQ)).recommendedSupplierId, 'SUP-A');
});

test('malformed or oversized model output is a controlled AI_BAD_SHAPE error, never surfaced as data', async () => {
    const s1 = build({ provider: { complete: async () => 'not json' } });
    await assert.rejects(s1.explain('explain_sourcing_analysis', REQ), /AI_BAD_SHAPE field=response reason=invalid_json/);
    const s2 = build({ provider: { complete: async () => brief({ headline: 'x'.repeat(201) }) } });
    await assert.rejects(s2.explain('procurement_briefing', REQ), /AI_BAD_SHAPE field=headline reason=too_long/);
    const s3 = build({ provider: { complete: async () => explain({ price: 12 }) } });
    await assert.rejects(s3.explain('explain_sourcing_analysis', REQ), /unexpected_field name=price/);
});

test('context is bounded and allowlisted: no raw price breaks / capability objects, at most 8 candidates, sections kept apart', async () => {
    const a = await build().analyze(REQ);
    const ctx = buildSourcingContext(a);
    assert.deepStrictEqual(Object.keys(ctx), ['verifiedFacts', 'calculatedResults', 'missingInformation', 'limitations']);
    const json = JSON.stringify(ctx);
    for (const k of ['priceBreaks', 'capacityPerMonth', 'ANTHROPIC', 'adminClient']) assert.ok(!json.includes(k), k);
    assert.ok(ctx.verifiedFacts.suppliers.length <= 8 && ctx.calculatedResults.ranking.length <= 8);
    assert.strictEqual(ctx.calculatedResults.recommendedSupplierId, 'SUP-A');
    assert.ok(ctx.missingInformation.some(m => m.supplierId === 'SUP-C' && m.field === 'history'));
    assert.ok(ctx.calculatedResults.conflicts.some(c => c.supplierId === 'SUP-E'));
    const many = Object.assign({}, a, { candidates: a.candidates.concat(a.candidates, a.candidates) });
    assert.strictEqual(buildSourcingContext(many).calculatedResults.ranking.length, 8);
});

test('prompt contract: both modes forbid inventing data and overriding FAIL; limits text matches the validator table', () => {
    for (const m of Object.values(MODES)) {
        for (const s of ['Technical FAIL is final', 'Never invent a supplier capability', 'never treat null as zero', 'recommendedSupplierId must be the engine recommendation', 'modelInterpretation']) assert.ok(m.system.includes(s), s);
        for (const [k, max] of Object.entries(m.text)) assert.ok(m.system.includes('- ' + k + ': max ' + max + ' characters'), k);
        for (const [k, max] of Object.entries(m.lists)) assert.ok(m.system.includes('- ' + k + ': max 6 items, each item max ' + max + ' characters'), k);
        assert.deepStrictEqual(m.schema.required.sort(), Object.keys(m.text).concat(Object.keys(m.lists), 'confidence').sort());
    }
    // the provider is handed the mode's own system prompt + schema, context as JSON only
    const seen = [];
    const svc = createSourcingAiService({ config: { enabled: true }, provider: { complete: async r => { seen.push(r); return explain({}); } } });
    return svc.explain({ item: { id: 'I' }, request: {}, recommendedSupplierId: 'SUP-A', candidates: [{ supplierId: 'SUP-A', technicalStatus: 'PASS', technicalReasons: [], technicalChecks: [], evidence: { purchases: [] } }], summary: {}, conflicts: [], missingData: [] })
        .then(() => { assert.strictEqual(seen[0].system, MODES.explain_sourcing_analysis.system); assert.deepStrictEqual(seen[0].schema, MODES.explain_sourcing_analysis.schema); assert.match(seen[0].user, /^Context \(JSON\):\n/); });
});

test('guard: only the engine recommendation (or none) may be named; a REVIEW or non-recommended supplier is rejected', () => {
    const a = { recommendedSupplierId: 'SUP-A', candidates: [{ supplierId: 'SUP-A', technicalStatus: 'PASS' }, { supplierId: 'SUP-R', technicalStatus: 'UNKNOWN' }, { supplierId: 'SUP-P', technicalStatus: 'PASS' }] };
    assert.throws(() => guardInsight({ recommendedSupplierId: 'SUP-R' }, a), /AI_OVERRIDE_BLOCKED reason=not_engine_recommendation/);
    assert.throws(() => guardInsight({ recommendedSupplierId: 'SUP-P' }, a), /AI_OVERRIDE_BLOCKED reason=not_engine_recommendation/);
    assert.ok(guardInsight({ recommendedSupplierId: 'SUP-A' }, a));
});
