// HTTP surface of /sourcing: input validation, deterministic analysis, AI disabled by default, RFQ create
// always refused while the gate is OFF. Real express listener on loopback; no network beyond that.
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const config = require('../../services/sourcing/config');

function start() {
    const app = express(); app.use(express.json());
    app.use('/sourcing', require('../../routes/sourcing'));
    return new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
}
function call(server, method, path, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : JSON.stringify(body);
        const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, res => {
            let buf = ''; res.on('data', d => buf += d); res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch (e) { reject(e); } });
        });
        req.on('error', reject); if (data) req.write(data); req.end();
    });
}

test('route: items, deterministic analysis, validation, AI off, RFQ preview dry-run, create refused with gate OFF', async () => {
    assert.strictEqual(config.rfqWrites, false, 'default gate OFF'); assert.strictEqual(config.ai.enabled, false, 'default AI OFF');
    const server = await start();
    try {
        const cfg = await call(server, 'GET', '/sourcing/config');
        assert.strictEqual(cfg.status, 200); assert.strictEqual(cfg.json.data.rfqWrites, false); assert.ok(!('ANTHROPIC_API_KEY' in cfg.json.data));
        const items = await call(server, 'GET', '/sourcing/items');
        assert.ok(items.json.data.some(i => i.id === 'ITM-1001') && !items.json.data.some(i => i.id === 'ITM-1001-STD'));

        const a = await call(server, 'GET', '/sourcing/analysis?itemId=ITM-1001&quantity=100&requiredDate=2026-12-06');
        assert.strictEqual(a.status, 200); assert.strictEqual(a.json.data.recommendedSupplierId, 'SUP-A');
        assert.strictEqual(a.json.data.candidates.find(c => c.supplierId === 'SUP-B').technicalStatus, 'FAIL');
        for (const q of ['itemId=../x', 'itemId=ITM-1001&quantity=-1', 'itemId=ITM-1001&quantity=1.5', 'itemId=ITM-1001&requiredDate=06.12.2026', '']) {
            assert.strictEqual((await call(server, 'GET', '/sourcing/analysis?' + q)).status, 400, q);
        }
        assert.strictEqual((await call(server, 'GET', '/sourcing/analysis?itemId=NOPE')).status, 404);

        const ai = await call(server, 'POST', '/sourcing/ai/explain', { itemId: 'ITM-1001', quantity: 100 });
        assert.strictEqual(ai.status, 503); assert.match(ai.json.message, /disabled/);
        assert.strictEqual((await call(server, 'POST', '/sourcing/ai/explain', { itemId: 'ITM-1001', extra: 1 })).status, 400);

        const p = await call(server, 'GET', '/sourcing/rfq/preview?itemId=ITM-1001&quantity=100&requiredDate=2026-12-06&supplierIds=SUP-A,SUP-C');
        assert.strictEqual(p.status, 200); assert.strictEqual(p.json.data.dryRun, true); assert.ok(p.json.data.blockers.includes('WRITE_DISABLED'));
        const pf = await call(server, 'GET', '/sourcing/rfq/preview?itemId=ITM-1001&quantity=100&supplierIds=SUP-B');
        assert.strictEqual(pf.status, 409); assert.strictEqual(pf.json.message, 'SUPPLIER_TECHNICALLY_FAILED');

        const body = { itemId: 'ITM-1001', quantity: 100, requiredDate: '2026-12-06', supplierIds: ['SUP-A'], confirm: 'CREATE_RFQ_DRAFT' };
        const c = await call(server, 'POST', '/sourcing/rfq/create', body);
        assert.strictEqual(c.status, 503); assert.strictEqual(c.json.message, 'WRITE_DISABLED'); assert.strictEqual(c.json.writeEnabled, false);
        assert.strictEqual((await call(server, 'POST', '/sourcing/rfq/create', Object.assign({}, body, { confirm: 'yes' }))).status, 400);
        assert.strictEqual((await call(server, 'POST', '/sourcing/rfq/create', Object.assign({}, body, { hack: true }))).status, 400);
    } finally { server.close(); }
});

test('route: assistant /ai/ask takes fixed question ids only; no-data questions get a fixed answer without the model; AI off => 503', async () => {
    const server = await start();
    try {
        const ask = b => call(server, 'POST', '/sourcing/ai/ask', b);
        assert.strictEqual((await ask({ itemId: 'ITM-1001', questionId: 'free text?' })).status, 400, 'unknown id');
        assert.strictEqual((await ask({ itemId: 'ITM-1001', questionId: '__proto__' })).status, 400, 'prototype keys are not ids');
        assert.strictEqual((await ask({ itemId: 'ITM-1001', questionId: 'why', extra: 1 })).status, 400, 'exact body');
        const w = await ask({ itemId: 'ITM-1001', questionId: 'whereUsed' });
        assert.strictEqual(w.status, 200); assert.strictEqual(w.json.data.deterministic, true); assert.match(w.json.data.insight.answer, /nicht verfügbar/);
        const r = await ask({ itemId: 'ITM-1001', questionId: 'revision' });
        assert.strictEqual(r.json.data.deterministic, true); assert.deepStrictEqual(r.json.data.insight.sources, ['Konferenz-Konfiguration']);
        assert.strictEqual((await ask({ itemId: 'ITM-1001', questionId: 'why' })).status, 503, 'AI disabled by default');
        const q = await call(server, 'GET', '/sourcing/ai/questions');
        assert.strictEqual(q.json.data.length, 7); assert.ok(q.json.data.find(x => x.id === 'revision').deterministic);
    } finally { server.close(); }
});
