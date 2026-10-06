// Durable Condition Event repository (Phase 2A-1). Condition events are discrete, low-frequency
// machine facts ("this asset crossed into WARNING") — unlike telemetry, they must survive a restart so a
// maintenance case can later reference one. This is the durable, asset-scoped, idempotent store for them.
//
// NOT Fusion Manage (FM stays business state), NOT the telemetry time-series (that's tandemRepository).
//
// Durable: a COMPLETE append-only NDJSON history on disk (one file per asset).
// In-memory: only a BOUNDED recent window (the last eventHistoryLimit valid events) — never the full
// catalog, no unbounded Map/Set/index, no database.
//
// Idempotency contract (honest): a duplicate eventId is rejected within the active in-memory window; on
// restart that recent window is reloaded with the same ids. An event that has aged out of the window is
// NOT deduped against the whole file. This is safe because the bridge never re-appends an old condition
// event — every real transition gets a fresh eventId. Corrupt persisted lines are skipped, never fatal.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EVENT_SCHEMA_VERSION = 1;

function createEventRepository(config = {}, logger = console) {
    const persistenceEnabled = !!config.eventPersistenceEnabled;
    const storeRoot = path.resolve(config.eventStorePath || 'storage/iot/events');
    const memLimit = Number(config.eventHistoryLimit) || 500;   // bound per-asset memory; file keeps full history
    const byAsset = new Map();     // assetId -> Map(eventId -> event)  (insertion order = chronological append)

    if (persistenceEnabled) {
        try { fs.mkdirSync(storeRoot, { recursive: true }); }
        catch (err) { logger.log(' IoT/Events: cannot create store - ' + err.message); }
    }

    function assetFile(assetId) {
        const key = crypto.createHash('sha256').update(String(assetId)).digest('hex');
        return path.join(storeRoot, key, 'events.ndjson');
    }

    // Load only the LAST memLimit valid events for an asset into the in-memory cache. The durable NDJSON
    // file keeps the complete append-only history; the process never holds the full catalog. A bounded
    // sliding window caps the in-memory structure to memLimit. Corrupt lines are skipped, foreign-asset
    // records ignored, and this never throws (a bad file must not break a restart).
    function loadAsset(assetId) {
        const map = new Map();
        if (!persistenceEnabled) return map;
        const file = assetFile(assetId);
        if (!fs.existsSync(file)) return map;
        let text;
        try { text = fs.readFileSync(file, 'utf8'); }
        catch (err) { logger.log(' IoT/Events: cannot read history - ' + err.message); return map; }
        const recent = [];                               // bounded to memLimit — not a full-file index
        let skipped = 0;
        for (const line of text.split(/\r?\n/)) {
            if (!line) continue;
            try {
                const e = JSON.parse(line);
                if (e && e.eventId && String(e.assetId) === String(assetId)) {
                    recent.push(e);
                    if (recent.length > memLimit) recent.shift();   // keep only the most recent memLimit
                } else skipped++;                        // foreign-asset / malformed-shape line
            } catch { skipped++; }                       // corrupt line: skip, do not fail the restore
        }
        if (skipped) logger.log(' IoT/Events: skipped ' + skipped + ' corrupt/foreign history line(s) for asset ' + assetId);
        for (const e of recent) map.set(e.eventId, e);   // bounded cache (<= memLimit), chronological order
        return map;
    }

    function mem(assetId) {
        const id = String(assetId);
        if (!byAsset.has(id)) byAsset.set(id, loadAsset(id));
        return byAsset.get(id);
    }

    // Persist one event. Returns { ok, skipped?, error? }. A failure is logged (observable) and surfaced
    // to the caller via `ok:false`; it never throws, so a transient storage error cannot kill telemetry
    // ingestion — the event is still held in memory and the caller learns persistence did not succeed.
    function persist(event) {
        if (!persistenceEnabled) return { ok: false, skipped: true };
        const file = assetFile(event.assetId);
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
            return { ok: true };
        } catch (err) {
            logger.log(' IoT/Events: persistence FAILED (event kept in memory, not durable) - ' + err.message);
            return { ok: false, error: err.message };
        }
    }

    // Append one condition event. Idempotent by eventId. Only real transitions reach here (the bridge
    // builds an event only on an actual condition change). Returns { stored, durable, persistenceError,
    // reason?, event }: `durable` is true only when the event was actually written to the NDJSON store,
    // so the caller never gets a false "persisted" claim.
    function append(event) {
        if (!event || !event.eventId || event.assetId == null || !event.timestamp) {
            return { stored: false, reason: 'invalid', durable: false };
        }
        const e = event.schemaVersion ? event : Object.assign({ schemaVersion: EVENT_SCHEMA_VERSION }, event);
        const m = mem(e.assetId);
        if (m.has(e.eventId)) return { stored: false, reason: 'duplicate', durable: true, event: m.get(e.eventId) };
        m.set(e.eventId, e);
        if (m.size > memLimit) m.delete(m.keys().next().value);   // bound in-memory growth (file keeps full history)
        const p = persist(e);
        return { stored: true, durable: !!p.ok, persistenceError: p.error || null, event: e };
    }

    // Asset-scoped, chronologically-sorted, bounded read. limit (>0) returns the most recent N.
    function list(assetId, limit) {
        const arr = Array.from(mem(assetId).values())
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const n = (limit && limit > 0) ? Math.min(limit, arr.length) : arr.length;
        return arr.slice(-n);
    }

    function latest(assetId) {
        const arr = list(assetId);
        return arr.length ? arr[arr.length - 1] : null;
    }

    return { append, list, latest, SCHEMA_VERSION: EVENT_SCHEMA_VERSION };
}

module.exports = { createEventRepository, EVENT_SCHEMA_VERSION };
