// Durable Condition Event -> Fusion Manage case link. The eventId is the business key; this file is the
// local idempotency guard that survives a restart (one event -> at most one FM item). Written ONLY after
// a successful FM create (or a read-only reconcile that found the item). The event NDJSON stays untouched.
// Mirrors baselineStore: local JSON next to the telemetry store, durable only with event persistence.

const fs = require('node:fs');
const path = require('node:path');

function createCaseLinkStore(config = {}, logger = console) {
    const persist = !!config.eventPersistenceEnabled;
    const file = path.resolve(config.caseLinkStorePath || path.join(path.dirname(config.telemetryStorePath || 'storage/iot/telemetry'), 'case-links.json'));
    let data = {};
    if (persist && fs.existsSync(file)) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; }
        catch (err) { logger.log(' IoT/CaseLinks: ignored unreadable link file - ' + err.message); data = {}; }
    }

    function get(eventId) { return data[String(eventId)] || null; }

    // Throws when not durable: a link that would not survive a restart must not report success.
    function set(eventId, link) {
        if (!persist) throw new Error('CASE_LINK_NOT_DURABLE');
        const record = Object.assign({ linkedAt: new Date().toISOString() }, link);
        const next = Object.assign({}, data, { [String(eventId)]: record });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 1), 'utf8');
        fs.renameSync(tmp, file);
        data = next;
        return record;
    }

    function latestForAsset(assetId) {
        const arr = Object.entries(data)
            .filter(([, l]) => String(l.assetId) === String(assetId))
            .map(([eventId, l]) => Object.assign({ eventId }, l))
            .sort((a, b) => String(a.linkedAt || '').localeCompare(String(b.linkedAt || '')));
        return arr.length ? arr[arr.length - 1] : null;
    }

    return { get, set, latestForAsset, durable: persist };
}

module.exports = { createCaseLinkStore };
