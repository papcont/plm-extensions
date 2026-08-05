// JSON-file backed transfer history (storage/erp/transfer-history.json).
// Avoids a native DB dependency for what is a small, append-mostly log.

const fs   = require('fs');
const path = 'storage/erp';
const file = path + '/transfer-history.json';
const maxEntries = 500;

function ensureFolder() {
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
}

function readAll() {
    ensureFolder();
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        return [];
    }
}

function writeAll(records) {
    ensureFolder();
    fs.writeFileSync(file, JSON.stringify(records.slice(0, maxEntries), null, 2));
}

function logTransfer(entry) {

    const records = readAll();

    const record = {
        id             : Date.now(),
        wsId           : entry.wsId,
        dmsId          : entry.dmsId,
        itemTitle      : entry.itemTitle || null,
        dolibarrBomId  : entry.dolibarrBomId || null,
        status         : entry.status,
        errorMessage   : entry.errorMessage || null,
        overridden     : entry.overridden || false,
        trigger        : entry.trigger || 'manual', // manual | retry | batch | webhook
        log            : entry.log || [],
        transferredAt  : new Date().toISOString()
    };

    records.unshift(record);
    writeAll(records);

    return record;
}

function getHistory(limit) {
    return readAll().slice(0, limit || 50);
}

function getById(id) {
    return readAll().find(function(record) { return String(record.id) === String(id); }) || null;
}

function getByItem(wsId, dmsId) {
    return readAll().find(function(record) { return String(record.wsId) === String(wsId) && String(record.dmsId) === String(dmsId); }) || null;
}

module.exports = { logTransfer, getHistory, getById, getByItem };
