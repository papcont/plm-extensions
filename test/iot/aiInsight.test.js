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

// ---- UI truth alignment + technician_briefing ----
const briefing = { headline: 'h', currentSituation: 'c', knownFacts: ['k'], unknowns: ['u'], recommendedChecks: ['r'], handoverNote: 'n', confidence: 'low' };

test('UI formatters: null/missing -> N/A or "not available"; numeric 0 stays 0.00; stale flagged', () => {
    const f = require('../../public/javascripts/apps/cm-format');
    assert.strictEqual(f.anomalyText(null), 'N/A');
    assert.strictEqual(f.anomalyText(undefined), 'N/A');
    assert.strictEqual(f.anomalyText(NaN), 'N/A');
    assert.strictEqual(f.anomalyText(0), '0.00');
    assert.strictEqual(f.anomalyText(0.912), '0.91');
    assert.strictEqual(f.vibrationText(undefined, 'g'), 'not available');
    assert.strictEqual(f.vibrationText(null, 'g'), 'not available');
    assert.strictEqual(f.vibrationText(0.02, 'g'), '0.02 g');
    assert.strictEqual(f.vibrationText(0, 'g'), '0 g');
    const now = Date.parse('2026-10-06T20:00:00Z');
    assert.match(f.staleText('2026-10-06T16:49:00Z', now), /stale · 191 min/);
    assert.strictEqual(f.staleText('2026-10-06T19:55:00Z', now), '');
    assert.strictEqual(f.staleText(undefined, now), '');
});

test('briefing: valid shape passes; extra field, long text, >6 items, bad confidence rejected', () => {
    const { validate } = require('../../services/iot/ai/aiService');
    assert.deepStrictEqual(validate(JSON.stringify(briefing), 'technician_briefing'), briefing);
    const bad = o => assert.throws(() => validate(JSON.stringify(Object.assign({}, briefing, o)), 'technician_briefing'), /AI_BAD_SHAPE/);
    bad({ action: 'close case' });
    bad({ headline: 'x'.repeat(201) });
    bad({ currentSituation: 'x'.repeat(801) });
    bad({ knownFacts: Array(7).fill('x') });
    bad({ unknowns: Array(7).fill('x') });
    bad({ recommendedChecks: Array(7).fill('x') });
    bad({ confidence: 'certain' });
    assert.throws(() => validate(JSON.stringify(good), 'technician_briefing'), /AI_BAD_SHAPE/);   // explain shape is not a briefing
    assert.throws(() => validate(JSON.stringify(briefing)), /AI_BAD_SHAPE/);                         // and vice versa
});

test('modes: separate cache entries per mode, hit per same mode, own system prompt + schema, no tools', async () => {
    const { BRIEFING_SYSTEM, SYSTEM } = require('../../services/iot/ai/aiService');
    const seen = [];
    const provider = { complete: async r => { seen.push(r); return JSON.stringify(r.schema.properties.headline ? briefing : good); } };
    const svc = createAiService({ config: { enabled: true }, provider });
    const ctx = { a: 1 };
    await svc.explainAssetState(ctx); await svc.technicianBriefing(ctx);
    assert.strictEqual(seen.length, 2);                       // same context, other mode -> own call
    await svc.explainAssetState(ctx); await svc.technicianBriefing(ctx);
    assert.strictEqual(seen.length, 2);                       // same mode + context -> cache hit
    assert.strictEqual(seen[0].system, SYSTEM);
    assert.strictEqual(seen[1].system, BRIEFING_SYSTEM);
    assert.ok(seen[1].user.includes('technician briefing'));
    for (const r of seen) assert.deepStrictEqual(Object.keys(r).sort(), ['schema', 'system', 'user']);   // provider gets nothing else
    const off = createAiService({ config: { enabled: false }, provider });
    await assert.rejects(off.technicianBriefing(ctx), /AI_DISABLED/);
    assert.strictEqual(seen.length, 2);
});

test('briefing system prompt keeps the domain guardrails and the KNOWN/UNKNOWN/CHECK split', () => {
    const { BRIEFING_SYSTEM } = require('../../services/iot/ai/aiService');
    for (const re of [/acceleration.*in g/i, /NOT vibration velocity/, /10816/, /FFT/, /RPM/, /load/, /not a diagnosis/,
        /CURRENT/, /NORMAL state does not invalidate/, /RUL/, /autonomous maintenance/, /not available/, /outdated/, /confirmedCause/,
        /KNOWN, UNKNOWN and RECOMMENDED CHECK/, /not a diagnosis and not an instruction/])
        assert.match(BRIEFING_SYSTEM, re);
});

test('route: technician-briefing is POST-only, exact body, 403/503, never leaks context or key', async () => {
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
    const P = '/iot/ai/technician-briefing';
    try {
        assert.strictEqual((await call('GET', P + '?assetId=30057')).status, 404);
        assert.strictEqual((await call('POST', P, { assetId: '30057', extra: 1 })).status, 400);
        assert.strictEqual((await call('POST', P, { assetId: 30057 })).status, 400);
        assert.strictEqual((await call('POST', P, {})).status, 400);
        assert.strictEqual((await call('POST', P, { assetId: '999' })).status, 403);
        const off = await call('POST', P, { assetId: '30057' });
        assert.strictEqual(off.status, 503);
        assert.ok(!off.body.includes('context') && !off.body.includes('sk-secret-test-key'));
    } finally { server.close(); iotConfig.ai.apiKey = ''; }
});

test('no-write guarantee: AI modules never import an FM write path or HTTP client', () => {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '../../services/iot/ai');
    const files = [...fs.readdirSync(dir).map(f => path.join(dir, f)).filter(f => f.endsWith('.js')), path.join(dir, 'providers/anthropic.js')];
    for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        assert.doesNotMatch(src, /fusionManageRepository|axios|\.patch\(|\.put\(|\.delete\(/, f);
        assert.doesNotMatch(src, /tools\s*:|tool_choice/, f);
    }
});

// ---- validation diagnostics: structured reason, never model text ----
const brief = o => JSON.stringify(Object.assign({}, briefing, o));
const reasonOf = (raw, mode = 'technician_briefing') => { try { require('../../services/iot/ai/aiService').validate(raw, mode); } catch (e) { return e.message; } return null; };

test('diagnostics: every rejection names field + reason + numbers (no content)', () => {
    assert.strictEqual(reasonOf(brief({ headline: 'x'.repeat(247) })), 'AI_BAD_SHAPE field=headline reason=too_long actual=247 max=200');
    assert.strictEqual(reasonOf(brief({ currentSituation: 'x'.repeat(801) })), 'AI_BAD_SHAPE field=currentSituation reason=too_long actual=801 max=800');
    assert.strictEqual(reasonOf(brief({ handoverNote: 'x'.repeat(801) })), 'AI_BAD_SHAPE field=handoverNote reason=too_long actual=801 max=800');
    assert.strictEqual(reasonOf(brief({ knownFacts: Array(7).fill('x') })), 'AI_BAD_SHAPE field=knownFacts reason=too_many_items actual=7 max=6');
    assert.strictEqual(reasonOf(brief({ unknowns: Array(7).fill('x') })), 'AI_BAD_SHAPE field=unknowns reason=too_many_items actual=7 max=6');
    assert.strictEqual(reasonOf(brief({ recommendedChecks: Array(7).fill('x') })), 'AI_BAD_SHAPE field=recommendedChecks reason=too_many_items actual=7 max=6');
    assert.strictEqual(reasonOf(brief({ recommendedChecks: ['ok', 'y'.repeat(801)] })), 'AI_BAD_SHAPE field=recommendedChecks reason=item_too_long index=1 actual=801 max=800');
    assert.strictEqual(reasonOf(brief({ confidence: 'certain' })), 'AI_BAD_SHAPE field=confidence reason=invalid_enum');
    assert.strictEqual(reasonOf(brief({ foo: 1 })), 'AI_BAD_SHAPE field=response reason=unexpected_field name=foo');
    assert.strictEqual(reasonOf(brief({ 'x y!<script>': 1 })), 'AI_BAD_SHAPE field=response reason=unexpected_field name=xyscript');
    assert.strictEqual(reasonOf('not json'), 'AI_BAD_SHAPE field=response reason=invalid_json');
    assert.strictEqual(reasonOf('[]'), 'AI_BAD_SHAPE field=response reason=not_an_object');
    const noHead = Object.assign({}, briefing); delete noHead.headline;
    assert.strictEqual(reasonOf(JSON.stringify(noHead)), 'AI_BAD_SHAPE field=headline reason=missing');
    assert.strictEqual(reasonOf(brief({ knownFacts: [1] })), 'AI_BAD_SHAPE field=knownFacts reason=item_not_a_string index=0');
});

test('diagnostics never echo model text, even for a secret-looking value', () => {
    const msg = reasonOf(brief({ headline: 'SECRET-MODEL-TEXT ' + 'x'.repeat(300), knownFacts: ['SECRET-MODEL-TEXT'] }));
    assert.match(msg, /^AI_BAD_SHAPE field=headline reason=too_long/);
    assert.ok(!msg.includes('SECRET-MODEL-TEXT'));
});

test('a briefing exactly at every limit is accepted', () => {
    const full = { headline: 'h'.repeat(200), currentSituation: 'c'.repeat(800), handoverNote: 'n'.repeat(800),
        knownFacts: Array(6).fill('k'.repeat(800)), unknowns: Array(6).fill('u'.repeat(800)), recommendedChecks: Array(6).fill('r'.repeat(800)), confidence: 'high' };
    assert.deepStrictEqual(reasonOf(JSON.stringify(full)), null);
});

test('briefing prompt states exactly the validator limits', () => {
    const { BRIEFING_SYSTEM, MODES } = require('../../services/iot/ai/aiService');
    const m = MODES.technician_briefing;
    for (const [k, max] of Object.entries(m.text)) assert.ok(BRIEFING_SYSTEM.includes('- ' + k + ': max ' + max + ' characters'), k);
    for (const [k, max] of Object.entries(m.lists)) assert.ok(BRIEFING_SYSTEM.includes('- ' + k + ': max 6 items, each item max ' + max + ' characters'), k);
    assert.deepStrictEqual([m.text.headline, m.text.currentSituation, m.text.handoverNote], [200, 800, 800]);
    for (const s of ['exactly "low", "medium" or "high"', 'no others', 'Keep the response concise', 'short factual sentences', 'Do not repeat the same fact']) assert.ok(BRIEFING_SYSTEM.includes(s), s);
});

test('route: a rejected model answer is logged by reason only; HTTP stays generic', async () => {
    const http = require('http'), express = require('express');
    const iotConfig = require('../../services/iot/config');
    const prov = require('../../services/iot/ai/providers/anthropic');
    const repo = require('../../services/iot/fusionManageReadRepository');
    const origProv = prov.createAnthropicProvider, origRepo = repo.createFusionManageReadRepository;
    let providerCalls = 0;
    prov.createAnthropicProvider = () => ({ complete: async () => { providerCalls++; return brief({ headline: 'SECRET-MODEL-TEXT ' + 'x'.repeat(300) }); } });
    repo.createFusionManageReadRepository = () => ({ getItem: async () => ({ sections: [] }) });
    const routePath = require.resolve('../../routes/iot');
    delete require.cache[routePath];                       // re-load so the route binds the stubs
    iotConfig.ai.enabled = true;
    const logs = []; const origLog = console.log; console.log = (...a) => logs.push(a.join(' '));
    const app = express(); app.use(express.json()); app.locals.tenant = 't'; app.locals.tenantLink = 'https://t';
    app.use('/iot', require('../../routes/iot'));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    try {
        const res = await new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/iot/ai/technician-briefing', method: 'POST', headers: { 'content-type': 'application/json' } }, r => {
                let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d }));
            });
            req.on('error', reject); req.write('{"assetId":"30057"}'); req.end();
        });
        assert.strictEqual(res.status, 502);
        assert.deepStrictEqual(JSON.parse(res.body), { success: false, message: 'AI Insight could not be generated' });
        assert.strictEqual(providerCalls, 1);
        const log = logs.join('\n');
        assert.match(log, /AI_BAD_SHAPE field=headline reason=too_long actual=\d+ max=200/);
        assert.ok(!log.includes('SECRET-MODEL-TEXT') && !res.body.includes('SECRET-MODEL-TEXT'));
    } finally {
        console.log = origLog; server.close(); iotConfig.ai.enabled = false;
        prov.createAnthropicProvider = origProv; repo.createFusionManageReadRepository = origRepo; delete require.cache[routePath];
    }
});

test('briefing prompt forbids commands/requests in handoverNote; neutral advisory handoverNote is accepted', () => {
    const { BRIEFING_SYSTEM } = require('../../services/iot/ai/aiService');
    assert.ok(BRIEFING_SYSTEM.includes('handoverNote must not contain commands, requests, or instructions'));
    assert.ok(BRIEFING_SYSTEM.includes('Use neutral advisory wording'));
    for (const s of ['"Consider..."', '"Suggested follow-up..."', '"Recommended review..."', '"Please verify..."', '"Inspect..."'])
        assert.ok(BRIEFING_SYSTEM.includes(s), s);
    assert.strictEqual(reasonOf(brief({ handoverNote: 'Last reading NORMAL but 250 minutes old. Suggested follow-up: review the data feed and the open case.' })), null);
    assert.ok(BRIEFING_SYSTEM.includes('not a diagnosis and not an instruction') && BRIEFING_SYSTEM.includes('NORMAL state does not invalidate'));  // earlier guardrails intact
});
