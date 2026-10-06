// Operator re-baseline (baselineEpoch) + restore of an anomaly-driven episode across a restart.
// Synthetic Dragino-like readings only; real runtime pipeline (bridge + tandem + events + baseline store).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const service = require('../../services/iot/service');
const canonical = require('../../services/iot/canonical');

function harness() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-rb-'));
    const dirs = { telemetryStorePath: path.join(root, 't'), eventStorePath: path.join(root, 'e'), baselineStorePath: path.join(root, 'b.json') };
    let t = Date.parse('2026-10-06T10:00:00Z');
    const silent = fn => { const log = console.log; console.log = () => {}; try { return fn(); } finally { console.log = log; } };
    const h = {
        root,
        tick: () => (t += 10000),
        now: () => new Date(t + 5000).toISOString(),
        // restart = a brand-new runtime on the same stores
        start: () => service.createRuntime(Object.assign({ telemetryPersistenceEnabled: true, eventPersistenceEnabled: true, deviceAssetMap: { dev: 'A1' },
            thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 }, temperature: { baseline: 40, warn: 60, critical: 75 } } }, dirs)),
        reading: v => canonical.createEvent({ deviceId: 'dev', deviceType: 'x', source: 'tts', timestamp: new Date(h.tick()).toISOString(),
            metrics: { vibrationG: v, temperature: 29.08, humidity: 37 },
            meta: { fPort: 7, vibrationModel: 'dynamic-magnitude-minus-1g', activityInference: 'unsupported' } }),
        feed: async (rt, v, n) => {
            const out = [];
            const log = console.log; console.log = () => {};
            try { for (let i = 0; i < n; i++) out.push(await rt.bridge.ingest(h.reading(typeof v === 'function' ? v(i) : v))); }
            finally { console.log = log; }
            return out;
        },
        rebaseline: (rt, opts) => silent(() => rt.rebaseline('A1', opts)),
        rest: i => (i % 3 ? 0.02 : 0.03),
        types: rt => rt.getEvents('A1').map(e => e.type + ':' + e.from + '>' + e.to),
        analytics: rt => rt.bridge.getAssetState('A1').analytics,
        done: () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ } },
    };
    return h;
}

test('re-baseline: clears the learned window, enters LEARNING, records the epoch', async () => {
    const h = harness();
    try {
        const rt = h.start();
        await h.feed(rt, h.rest, 60);
        assert.strictEqual(h.analytics(rt).modelState, 'READY');
        assert.strictEqual(h.analytics(rt).sampleCount, 59, 'snapshot is taken before the current reading is learned');
        const epoch = h.now();
        const rec = h.rebaseline(rt, { reason: 'normal operation', now: epoch });
        assert.strictEqual(rec.baselineEpoch, epoch);
        assert.strictEqual(rec.reason, 'normal operation');
        const a = h.analytics(rt);
        assert.strictEqual(a.modelState, 'LEARNING');
        assert.strictEqual(a.sampleCount, 0);
        assert.strictEqual(a.baselineEpoch, epoch);
    } finally { h.done(); }
});

test('restore never loads telemetry older than baselineEpoch; epoch survives restart (also mid-learning)', async () => {
    const h = harness();
    try {
        let rt = h.start();
        await h.feed(rt, h.rest, 60);                              // historical rest/standby samples
        const epoch = h.now();
        h.rebaseline(rt, { now: epoch });

        rt = h.start();                                            // restart right after re-baseline
        let a = h.analytics(rt);
        assert.strictEqual(a.sampleCount, 0, 'the 60 pre-epoch rest samples are NOT reloaded');
        assert.strictEqual(a.modelState, 'LEARNING');
        assert.strictEqual(a.baselineEpoch, epoch);

        await h.feed(rt, 0.3, 10);                                 // running machine, still learning
        rt = h.start();                                            // restart DURING learning
        a = h.analytics(rt);
        assert.strictEqual(a.baselineEpoch, epoch, 'epoch kept');
        assert.strictEqual(a.sampleCount, 10, 'only the 10 post-epoch samples, none of the old ones');
        assert.strictEqual(a.modelState, 'LEARNING');
        assert.strictEqual(a.baseline.vibration.median, 0.3);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(h.root, 'b.json'), 'utf8')).A1.baselineEpoch, epoch);
    } finally { h.done(); }
});

test('during LEARNING: no learned-anomaly events; fixed 2 g / 4 g guardrails still fire; READY from post-epoch data only', async () => {
    const h = harness();
    try {
        const rt = h.start();
        await h.feed(rt, h.rest, 60);
        h.rebaseline(rt, { now: h.now() });
        const before = rt.getEvents('A1').length;

        const learning = await h.feed(rt, 0.3, 12);               // 0.3 g would be CRITICAL vs the old rest baseline
        assert.ok(learning.every(r => r.accepted && r.condition.condition === 'NORMAL'), 'no anomaly transition while learning');
        assert.strictEqual(rt.getEvents('A1').length, before, '0 learned-anomaly events during LEARNING');
        assert.strictEqual(h.analytics(rt).modelState, 'LEARNING');

        const [warn] = await h.feed(rt, 2.5, 1);                   // fixed guardrail >= 2 g
        assert.strictEqual(warn.condition.condition, 'WARNING');
        const [crit] = await h.feed(rt, 4.5, 1);                   // fixed guardrail >= 4 g
        assert.strictEqual(crit.condition.condition, 'CRITICAL');
        assert.deepStrictEqual(h.types(rt).slice(before), ['ESCALATION:NORMAL>WARNING', 'ESCALATION:WARNING>CRITICAL']);

        await h.feed(rt, 0.3, 20);                                 // enough post-epoch samples
        const a = h.analytics(rt);
        assert.strictEqual(a.modelState, 'READY');
        assert.ok(a.sampleCount >= 20 && a.sampleCount <= 34, 'only post-epoch samples, got ' + a.sampleCount);
        assert.strictEqual(a.baseline.vibration.median, 0.3, 'baseline describes the post-epoch (running) state, not the old rest state');
    } finally { h.done(); }
});

test('re-baseline ends an anomaly episode silently (no RECOVERY event); an unpersistable epoch is not reported as success', async () => {
    const h = harness();
    try {
        const rt = h.start();
        await h.feed(rt, h.rest, 60);
        await h.feed(rt, 0.3, 6);
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL']);
        h.rebaseline(rt, { now: h.now() });
        await h.feed(rt, 0.3, 5);
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL'], 'no artificial RECOVERY / ESCALATION from the re-baseline');

        const blocker = path.join(h.root, 'blocker');
        fs.writeFileSync(blocker, 'x');                            // a FILE where a directory is needed
        const failing = service.createRuntime({ telemetryPersistenceEnabled: true, telemetryStorePath: path.join(h.root, 't2'),
            baselineStorePath: path.join(blocker, 'x.json'), deviceAssetMap: { dev: 'A1' } });
        assert.throws(() => failing.rebaseline('A1', {}));
    } finally { h.done(); }
});

test('REGRESSION restart mid anomaly-driven episode: stays CRITICAL, no RECOVERY, no second ESCALATION; real recovery -> exactly one RECOVERY', async () => {
    const h = harness();
    try {
        let rt = h.start();
        await h.feed(rt, h.rest, 60);
        await h.feed(rt, 0.3, 8);                                  // stabilises to CRITICAL (anomaly-driven; 0.3 g < 2 g guardrail)
        const first = rt.getEvents('A1');
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL']);
        const escalationId = first[0].eventId;

        rt = h.start();                                            // restart mid-episode
        assert.deepStrictEqual(rt.getEvents('A1').map(e => e.eventId), [escalationId], 'event restored, same id');
        const after = await h.feed(rt, 0.3, 8);                    // the SAME anomalous readings continue
        assert.ok(after.every(r => r.condition.condition === 'CRITICAL'), 'condition stays CRITICAL: ' + after.map(r => r.condition.condition));
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL'], 'no false RECOVERY, no duplicate ESCALATION');
        assert.strictEqual(rt.getEvents('A1')[0].eventId, escalationId);

        const rec = await h.feed(rt, h.rest, 8);                   // genuine recovery
        assert.strictEqual(rec[rec.length - 1].condition.condition, 'NORMAL');
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL', 'RECOVERY:CRITICAL>NORMAL']);

        rt = h.start();                                            // restart again, back to normal
        await h.feed(rt, h.rest, 5);
        assert.deepStrictEqual(h.types(rt), ['ESCALATION:NORMAL>CRITICAL', 'RECOVERY:CRITICAL>NORMAL'], 'quiet restart creates nothing');
    } finally { h.done(); }
});

test('restart during a mixed threshold + anomaly episode (>= 2 g) creates no extra events', async () => {
    const h = harness();
    try {
        let rt = h.start();
        await h.feed(rt, h.rest, 60);
        await h.feed(rt, 2.5, 6);                                  // WARNING by guardrail at once, CRITICAL by learned anomaly after 3 samples
        const before = h.types(rt);
        assert.deepStrictEqual(before, ['ESCALATION:NORMAL>WARNING', 'ESCALATION:WARNING>CRITICAL']);
        rt = h.start();
        const after = await h.feed(rt, 2.5, 6);
        assert.ok(after.every(r => r.condition.condition === 'CRITICAL'));
        assert.deepStrictEqual(h.types(rt), before);
    } finally { h.done(); }
});

test('route /iot/admin/rebaseline: gated OFF (404), exact body, allowlisted asset', async () => {
    const express = require('express');
    const iotConfig = require('../../services/iot/config');
    const routePath = require.resolve('../../routes/iot');
    delete require.cache[routePath];
    const app = express(); app.use(express.json());
    app.use('/iot', require('../../routes/iot'));
    const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const call = body => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/iot/admin/rebaseline', method: 'POST', headers: { 'content-type': 'application/json' } }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
        });
        req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
    });
    const log = console.log; console.log = () => {};
    try {
        iotConfig.rebaselineEnabled = false;
        assert.strictEqual((await call({ assetId: '30057', confirm: 'REBASELINE' })).status, 404, 'default OFF');
        iotConfig.rebaselineEnabled = true;
        assert.strictEqual((await call({ assetId: '30057' })).status, 400, 'confirm required');
        assert.strictEqual((await call({ assetId: '30057', confirm: 'REBASELINE', x: 1 })).status, 400, 'no extra fields');
        assert.strictEqual((await call({ assetId: 30057, confirm: 'REBASELINE' })).status, 400, 'assetId must be a string');
        assert.strictEqual((await call({ assetId: '999', confirm: 'REBASELINE' })).status, 403, 'allowlist');
        const ok = await call({ assetId: '30057', confirm: 'REBASELINE', reason: 'unit test' });
        assert.strictEqual(ok.status, 200);
        assert.ok(JSON.parse(ok.body).data.baselineEpoch);
    } finally { console.log = log; iotConfig.rebaselineEnabled = false; server.close(); delete require.cache[routePath]; }
});
