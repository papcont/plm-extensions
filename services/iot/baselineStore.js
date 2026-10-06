// Per-asset baseline epoch: the instant from which learned-baseline samples count. Set only by an explicit
// operator re-baseline; restore (restart) then ignores all telemetry before it, so an old rest/standby
// baseline can never be reloaded after the operator declared a new one. Local JSON file, survives restarts.

const fs = require('node:fs');
const path = require('node:path');

function createBaselineStore(config = {}, logger = console) {
    const persist = !!config.telemetryPersistenceEnabled;
    const file = path.resolve(config.baselineStorePath || path.join(path.dirname(config.telemetryStorePath || 'storage/iot/telemetry'), 'baseline-epochs.json'));
    let data = {};
    if (persist && fs.existsSync(file)) {
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; }
        catch (err) { logger.log(' IoT/Baseline: ignored unreadable epoch file - ' + err.message); data = {}; }
    }

    function get(assetId) { return data[String(assetId)] || null; }

    // Record a new epoch (default: now). `reason` is a short operator note. Throws if it cannot be persisted
    // (persistence disabled, or the write fails): a re-baseline that would not survive a restart must not
    // report success. The in-memory copy is replaced only AFTER the file was written, so a failure leaves no
    // transient epoch behind.
    function set(assetId, { reason = null, now = new Date().toISOString() } = {}) {
        if (!persist) throw new Error('REBASELINE_NOT_DURABLE');
        const record = { baselineEpoch: now, startedAt: now, reason: reason ? String(reason).slice(0, 200) : null };
        const next = Object.assign({}, data, { [String(assetId)]: record });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(next, null, 1), 'utf8');
        fs.renameSync(tmp, file);
        data = next;
        return record;
    }

    return { get, set };
}

module.exports = { createBaselineStore };
