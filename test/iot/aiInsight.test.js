const { test } = require('node:test');
const assert = require('node:assert');
const { buildContext } = require('../../services/iot/ai/contextBuilder');
const { createAiService } = require('../../services/iot/ai/aiService');

const state = {
    summary: { condition: 'NORMAL', healthScore: 100, vibration: 0.02, temperature: 29.08, humidity: 37,
        lastTelemetry: '2026-10-06T17:46:54.626Z', secretish: 'must-not-leak' },
    analytics: { modelState: 'READY', sampleCount: 200, anomalyScore: null, primaryDriver: null, trend: 'STABLE',
        baseline: { vibration: { median: 0.02, lower: -0.01, upper: 0.05 }, temperature: { median: 29.08 } } },
};
const kase = { caseId: 'A000019-SRV001', workflow: 'Definition', urgency: 'Predictive Service',
    assessment: 'CONFIRMED_ISSUE', confirmedCause: 'Controlled test finding', anomalyAtDetection: '0.91',
    primaryDriver: 'vibration', conditionEventId: 'LIVE-TEST-2A5B-003', itemUrl: 'https://tenant/x' };
const good = { summary: 's', currentStateExplanation: 'c', historicalContext: 'h', humanAssessmentContext: 'a',
    suggestedChecks: ['x'], limitations: ['y'], confidence: 'medium' };

test('context is an allowlist: null stays null, no extra fields, current vs historical separated', () => {
    const ctx = buildContext({ state, asset: { id: 'A000019', title: 'A000019 - Unterbau' }, kase,
        now: Date.parse('2026-10-06T18:46:54.626Z') });
    assert.strictEqual(ctx.currentMachineState.anomalyScore, null);
    assert.strictEqual(ctx.currentMachineState.dataAgeMinutes, 60);
    assert.deepStrictEqual(ctx.learnedBaseline.vibrationNormalBandG, [0, 0.05]);
    assert.strictEqual(ctx.historicalDetection.anomalyAtDetection, 0.91);
    assert.strictEqual(ctx.maintenanceCase.confirmedCause, 'Controlled test finding');
    const json = JSON.stringify(ctx);
    assert.ok(!json.includes('must-not-leak') && !json.includes('itemUrl'));
});

test('disabled service never calls the provider; valid output is cached; bad shape is rejected', async () => {
    let calls = 0;
    const provider = { complete: async ({ schema }) => { calls++; assert.strictEqual(schema.additionalProperties, false); return JSON.stringify(good); } };
    await assert.rejects(createAiService({ config: { enabled: false }, provider }).explainAssetState({}), /AI_DISABLED/);
    assert.strictEqual(calls, 0);

    const svc = createAiService({ config: { enabled: true }, provider });
    await svc.explainAssetState({ a: 1 });
    await svc.explainAssetState({ a: 1 });
    assert.strictEqual(calls, 1);

    const bad = createAiService({ config: { enabled: true }, provider: { complete: async () => JSON.stringify(Object.assign({}, good, { confidence: 'certain' })) } });
    await assert.rejects(bad.explainAssetState({}), /AI_BAD_SHAPE/);
    const extra = createAiService({ config: { enabled: true }, provider: { complete: async () => JSON.stringify(Object.assign({ action: 'close case' }, good)) } });
    await assert.rejects(extra.explainAssetState({}), /AI_BAD_SHAPE/);
});

test('provider: one request, exact model, maxRetries 0, no tools/fallback/betas, bounded output', async () => {
    const { createAnthropicProvider } = require('../../services/iot/ai/providers/anthropic');
    const reqs = [];
    const client = { messages: { create: async r => { reqs.push(r); return { stop_reason: 'end_turn', content: [{ type: 'text', text: '{}' }] }; } } };
    await createAnthropicProvider({ model: 'm-1' }, client).complete({ system: 's', user: 'u', schema: {} });
    assert.strictEqual(reqs.length, 1);
    const r = reqs[0];
    assert.strictEqual(r.model, 'm-1');
    assert.ok(r.max_tokens > 0 && r.max_tokens <= 4000);
    for (const k of ['tools', 'tool_choice', 'fallbacks', 'betas']) assert.ok(!(k in r), k);
    const src = require('fs').readFileSync(require.resolve('../../services/iot/ai/providers/anthropic'), 'utf8');
    assert.match(src, /maxRetries: 0/);
    assert.doesNotMatch(src, /fallbacks|betas/);
    for (const stop of ['refusal', 'max_tokens']) {
        const c = { messages: { create: async () => ({ stop_reason: stop, content: [] }) } };
        await assert.rejects(createAnthropicProvider({}, c).complete({ system: 's', user: 'u', schema: {} }), /AI_/);
    }
});

test('invalid (non-JSON) model output is a controlled error', async () => {
    const svc = createAiService({ config: { enabled: true }, provider: { complete: async () => 'not json' } });
    await assert.rejects(svc.explainAssetState({}), /AI_BAD_SHAPE/);
});

test('system prompt keeps the domain guardrails', () => {
    const { SYSTEM } = require('../../services/iot/ai/aiService');
    for (const re of [/acceleration.*in g/i, /NOT vibration velocity/, /10816/, /FFT/, /RPM/, /load/, /not a diagnosis/,
        /CURRENT/, /NORMAL state does not invalidate/, /RUL/, /autonomous maintenance/, /suggestions/, /not available/, /outdated/, /confirmedCause/])
        assert.match(SYSTEM, re);
});

test('route: POST only, exact body, allowlist 403, disabled 503, no key/context exposure', async () => {
    const http = require('http');
    const express = require('express');
    const iotConfig = require('../../services/iot/config');
    iotConfig.ai.enabled = false; iotConfig.ai.apiKey = 'sk-secret-test-key';
    const app = express();
    app.use(express.json());
    app.use('/iot', require('../../routes/iot'));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const call = (method, path, body) => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path, method, headers: { 'content-type': 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
    try {
        assert.strictEqual((await call('GET', '/iot/ai/explain?assetId=30057')).status, 404);
        assert.strictEqual((await call('POST', '/iot/ai/explain', { assetId: '30057', extra: 1 })).status, 400);
        assert.strictEqual((await call('POST', '/iot/ai/explain', { assetId: 30057 })).status, 400);
        assert.strictEqual((await call('POST', '/iot/ai/explain', { assetId: '999' })).status, 403);
        const off = await call('POST', '/iot/ai/explain', { assetId: '30057' });
        assert.strictEqual(off.status, 503);
        assert.ok(!off.body.includes('context'));
        const cfg = await call('GET', '/iot/config');
        assert.ok(!cfg.body.includes('sk-secret-test-key') && !/apiKey/i.test(cfg.body));
    } finally { server.close(); iotConfig.ai.apiKey = ''; }
});

test('cache key: age bucketed per 15 min; every other fact changes the key; insight has exact fields', async () => {
    const { cacheKey } = require('../../services/iot/ai/aiService');
    const mk = (age, over = {}) => buildContext({ state: JSON.parse(JSON.stringify(state)), asset: { id: 'A', title: 'A' }, kase: Object.assign({}, kase, over),
        now: Date.parse(state.summary.lastTelemetry) + age * 60000 });
    assert.strictEqual(mk(191).currentMachineState.dataAgeMinutes, 191);
    assert.ok(JSON.stringify(mk(191)).includes('191 minutes'));            // model keeps the real age
    assert.strictEqual(cacheKey(mk(191)), cacheKey(mk(192)));
    assert.notStrictEqual(cacheKey(mk(191)), cacheKey(mk(206)));
    assert.notStrictEqual(cacheKey(mk(191)), cacheKey(mk(191, { assessment: 'FALSE_ALARM' })));
    assert.notStrictEqual(cacheKey(mk(191)), cacheKey(mk(191, { confirmedCause: 'other' })));
    const withState = patch => { const st = JSON.parse(JSON.stringify(state)); patch(st);
        return cacheKey(buildContext({ state: st, asset: { id: 'A', title: 'A' }, kase, now: Date.parse(state.summary.lastTelemetry) + 191 * 60000 })); };
    const base = cacheKey(mk(191));
    assert.notStrictEqual(base, withState(st => { st.summary.vibration = 0.4; }));
    assert.notStrictEqual(base, withState(st => { st.analytics.anomalyScore = 0.5; }));
    assert.notStrictEqual(base, withState(st => { st.summary.condition = 'WARNING'; }));

    const svc = createAiService({ config: { enabled: true }, provider: { complete: async () => JSON.stringify(good) } });
    const out = await svc.explainAssetState({ a: 1 });
    assert.deepStrictEqual(Object.keys(out).sort(), Object.keys(good).sort());
    assert.ok(!('cached' in out));
});
