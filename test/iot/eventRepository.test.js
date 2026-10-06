// Durable Condition Event repository (Phase 2A-1): persistence, restart-restore, idempotency,
// multi-asset isolation, bounded reads, corrupt-storage tolerance, and the escalation/recovery arc
// through the runtime surviving a restart. Phase-1 behavior is covered by the rest of the suite.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { createEventRepository, EVENT_SCHEMA_VERSION } = require('../../services/iot/eventRepository');
const service = require('../../services/iot/service');
const simulator = require('../../services/iot/simulator');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'iot-events-'));
}
function cleanup(dir) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
function ev(assetId, eventId, timestamp, extra) {
    return Object.assign({ eventId, assetId, deviceId: 'dev-' + assetId, type: 'ESCALATION',
        from: 'NORMAL', to: 'WARNING', severity: 'WARNING', timestamp, status: 'OPEN' }, extra || {});
}

test('append persists and list returns chronological, bounded', () => {
    const dir = tmpDir();
    try {
        const repo = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        repo.append(ev('A', 'e1', '2026-01-01T10:02:00Z'));
        repo.append(ev('A', 'e2', '2026-01-01T10:01:00Z'));   // earlier timestamp, appended later
        repo.append(ev('A', 'e3', '2026-01-01T10:03:00Z'));
        const all = repo.list('A');
        assert.deepStrictEqual(all.map(e => e.eventId), ['e2', 'e1', 'e3'], 'sorted by timestamp');
        assert.strictEqual(all[0].schemaVersion, EVENT_SCHEMA_VERSION, 'schema stamped');
        assert.deepStrictEqual(repo.list('A', 2).map(e => e.eventId), ['e1', 'e3'], 'bounded to most recent 2');
    } finally { cleanup(dir); }
});

test('restart: a new repository on the same path restores persisted events', () => {
    const dir = tmpDir();
    try {
        const repo1 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        repo1.append(ev('A', 'e1', '2026-01-01T10:00:00Z'));
        repo1.append(ev('A', 'e2', '2026-01-01T10:05:00Z'));
        // simulate restart: brand-new repository instance, same store
        const repo2 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        assert.deepStrictEqual(repo2.list('A').map(e => e.eventId), ['e1', 'e2'], 'restored after restart');
        assert.strictEqual(repo2.latest('A').eventId, 'e2');
    } finally { cleanup(dir); }
});

test('idempotency: the same eventId is never stored twice (restart-restore + double append)', () => {
    const dir = tmpDir();
    try {
        const repo1 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        assert.strictEqual(repo1.append(ev('A', 'e1', '2026-01-01T10:00:00Z')).stored, true);
        assert.strictEqual(repo1.append(ev('A', 'e1', '2026-01-01T10:00:00Z')).stored, false, 'duplicate rejected');
        assert.strictEqual(repo1.list('A').length, 1);
        const repo2 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        assert.strictEqual(repo2.append(ev('A', 'e1', '2026-01-01T10:00:00Z')).reason, 'duplicate', 'still deduped after restart');
        assert.strictEqual(repo2.list('A').length, 1, 'no duplicate on disk');
    } finally { cleanup(dir); }
});

test('multi-asset isolation: events never leak between assets', () => {
    const dir = tmpDir();
    try {
        const repo = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        repo.append(ev('A', 'a1', '2026-01-01T10:00:00Z'));
        repo.append(ev('B', 'b1', '2026-01-01T10:00:00Z'));
        repo.append(ev('B', 'b2', '2026-01-01T10:01:00Z'));
        assert.deepStrictEqual(repo.list('A').map(e => e.eventId), ['a1']);
        assert.deepStrictEqual(repo.list('B').map(e => e.eventId), ['b1', 'b2']);
        // and across restart
        const repo2 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        assert.deepStrictEqual(repo2.list('A').map(e => e.eventId), ['a1']);
        assert.deepStrictEqual(repo2.list('B').map(e => e.eventId), ['b1', 'b2']);
    } finally { cleanup(dir); }
});

test('corrupt storage: malformed lines are skipped, valid events still restore', () => {
    const dir = tmpDir();
    try {
        const repo1 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        repo1.append(ev('A', 'e1', '2026-01-01T10:00:00Z'));
        repo1.append(ev('A', 'e2', '2026-01-01T10:01:00Z'));
        // inject a corrupt line + a foreign-asset line into the asset's file
        const file = path.join(dir, crypto.createHash('sha256').update('A').digest('hex'), 'events.ndjson');
        fs.appendFileSync(file, 'this is not json\n');
        fs.appendFileSync(file, JSON.stringify({ eventId: 'x', assetId: 'OTHER', timestamp: '2026-01-01T10:02:00Z' }) + '\n');
        const repo2 = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: dir });
        assert.deepStrictEqual(repo2.list('A').map(e => e.eventId), ['e1', 'e2'], 'corrupt + foreign lines skipped, valid kept');
    } finally { cleanup(dir); }
});

test('append rejects invalid events (missing eventId/assetId/timestamp)', () => {
    const repo = createEventRepository({ eventPersistenceEnabled: false });
    assert.strictEqual(repo.append(null).stored, false);
    assert.strictEqual(repo.append({ assetId: 'A', timestamp: 't' }).reason, 'invalid');
    assert.strictEqual(repo.append({ eventId: 'e', timestamp: 't' }).reason, 'invalid');
    assert.strictEqual(repo.append({ eventId: 'e', assetId: 'A' }).reason, 'invalid');
});

test('persistence OFF: events held in memory only, nothing written', () => {
    const dir = tmpDir();
    try {
        const repo = createEventRepository({ eventPersistenceEnabled: false, eventStorePath: dir });
        repo.append(ev('A', 'e1', '2026-01-01T10:00:00Z'));
        assert.strictEqual(repo.list('A').length, 1, 'in memory');
        const repo2 = createEventRepository({ eventPersistenceEnabled: false, eventStorePath: dir });
        assert.strictEqual(repo2.list('A').length, 0, 'nothing persisted');
    } finally { cleanup(dir); }
});

test('bounded restore: durable file keeps ALL events, memory keeps only the last eventHistoryLimit', () => {
    const dir = tmpDir();
    try {
        const cfg = { eventPersistenceEnabled: true, eventStorePath: dir, eventHistoryLimit: 5 };
        const repo1 = createEventRepository(cfg);
        const ids = [];
        for (let i = 1; i <= 12; i++) {
            const id = 'e' + String(i).padStart(2, '0');
            ids.push(id);
            repo1.append(ev('A', id, '2026-01-01T10:' + String(i).padStart(2, '0') + ':00Z'));
        }
        // durable file still holds all 12 valid events
        const file = path.join(dir, crypto.createHash('sha256').update('A').digest('hex'), 'events.ndjson');
        const valid = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(e => e && e.assetId === 'A');
        assert.strictEqual(valid.length, 12, 'complete append-only history on disk');

        // restart: memory holds only the most recent 5, newest-correct, chronological order, no crash
        const repo2 = createEventRepository(cfg);
        const restored = repo2.list('A');
        assert.strictEqual(restored.length, 5, 'in-memory window bounded to eventHistoryLimit');
        assert.deepStrictEqual(restored.map(e => e.eventId), ids.slice(-5), 'the 5 newest, chronological');
        assert.strictEqual(repo2.latest('A').eventId, 'e12');
    } finally { cleanup(dir); }
});

test('persistence failure is surfaced (durable:false), never throws, event stays in memory', () => {
    const dir = tmpDir();
    try {
        const filePath = path.join(dir, 'this-is-a-file');
        fs.writeFileSync(filePath, 'x');                      // a FILE where the store expects a directory
        const logs = [];
        const repo = createEventRepository({ eventPersistenceEnabled: true, eventStorePath: filePath }, { log: m => logs.push(m) });
        const r = repo.append(ev('A', 'e1', '2026-01-01T10:00:00Z'));
        assert.strictEqual(r.stored, true, 'event accepted into memory');
        assert.strictEqual(r.durable, false, 'not durable on write failure (no false success)');
        assert.ok(r.persistenceError, 'persistence error surfaced to caller');
        assert.strictEqual(repo.list('A').length, 1, 'event still readable from memory');
        assert.ok(logs.some(l => /persistence FAILED/i.test(l)), 'failure is logged (observable)');
    } finally { cleanup(dir); }
});

// ---- API feed contract (getEventsFeed: resolve asset, normalize limit, newest-first) ----
function fakeFeedRepo(chrono) {
    let lastLimit;
    return {
        lastLimit: () => lastLimit,
        list: (assetId, limit) => { lastLimit = limit; const n = (limit && limit > 0) ? limit : chrono.length; return chrono.slice(-n); },
        append: () => ({ stored: true, durable: false }),
    };
}

test('API feed: newest-first, assetId echoed, default/explicit/invalid/excessive limit, missing assetId', () => {
    const chrono = ['e1', 'e2', 'e3', 'e4', 'e5'].map((id, i) => ev('30057', id, '2026-01-01T10:0' + i + ':00Z'));
    const repo = fakeFeedRepo(chrono);
    const rt = service.createRuntime({ events: repo });

    // newest-first + assetId echoed
    const r = rt.getEventsFeed('30057', 10);
    assert.strictEqual(r.assetId, '30057', 'assetId echoed');
    assert.deepStrictEqual(r.events.map(e => e.eventId), ['e5', 'e4', 'e3', 'e2', 'e1'], 'newest-first');

    // default limit (undefined) = 50
    rt.getEventsFeed('30057'); assert.strictEqual(repo.lastLimit(), 50, 'default limit 50');
    // explicit limit
    const three = rt.getEventsFeed('30057', 3);
    assert.strictEqual(repo.lastLimit(), 3); assert.deepStrictEqual(three.events.map(e => e.eventId), ['e5', 'e4', 'e3']);
    // invalid limit -> default
    rt.getEventsFeed('30057', 'abc'); assert.strictEqual(repo.lastLimit(), 50, 'non-numeric -> default');
    rt.getEventsFeed('30057', -5); assert.strictEqual(repo.lastLimit(), 50, 'negative -> default');
    rt.getEventsFeed('30057', 0); assert.strictEqual(repo.lastLimit(), 50, 'zero -> default');
    // excessive limit -> capped to eventHistoryLimit (500)
    rt.getEventsFeed('30057', 99999); assert.strictEqual(repo.lastLimit(), 500, 'excessive capped to 500');
    // missing assetId -> resolved default (identity-mapped demo device)
    const def = rt.getEventsFeed(null, 5);
    assert.strictEqual(def.assetId, rt.config.simulation.deviceId, 'missing assetId resolves to default asset');
});

test('ARC: runtime escalation/recovery events are durable and survive a restart; events are enriched', async () => {
    const dir = tmpDir();
    try {
        const rt = service.createRuntime({ eventPersistenceEnabled: true, eventStorePath: dir });
        const total = simulator.totalTicks(simulator.DEFAULT_SCENARIO);
        for (let i = 0; i < total; i++) await rt.tick();
        const assetId = rt.config.simulation.deviceId;        // identity-mapped asset
        const events = rt.getEvents(assetId);
        assert.ok(events.length >= 2, 'arc produced events, got ' + events.length);
        const types = new Set(events.map(e => e.type));
        assert.ok(types.has('ESCALATION') && types.has('RECOVERY'), 'both escalation and recovery persisted');
        // enrichment present (structured v1 shape)
        const sample = events[0];
        assert.strictEqual(sample.schemaVersion, EVENT_SCHEMA_VERSION);
        assert.strictEqual(sample.schemaVersion, 1);
        assert.strictEqual(sample.status, 'OPEN', 'new events start OPEN');
        for (const f of ['from', 'to', 'detectedAt', 'metrics', 'baselineRef', 'telemetryWindowRef']) {
            assert.ok(f in sample, 'enriched field present: ' + f);
        }
        assert.ok(typeof sample.metrics.vibration === 'number' && sample.metrics.vibrationUnit, 'metrics.vibration + unit');
        assert.ok(sample.baselineRef && sample.baselineRef.modelState, 'baselineRef carries modelState');
        assert.ok(sample.telemetryWindowRef.toTs, 'telemetry window toTs populated');
        assert.ok(sample.telemetryWindowRef.fromTs, 'telemetry window fromTs populated (prior reading exists in the arc)');
        // restart: a fresh runtime on the same store restores the same events (no duplicates, same order)
        const rt2 = service.createRuntime({ eventPersistenceEnabled: true, eventStorePath: dir });
        const restored = rt2.getEvents(assetId);
        assert.deepStrictEqual(restored.map(e => e.eventId), events.map(e => e.eventId), 'restart restores same events');
    } finally { cleanup(dir); }
});
