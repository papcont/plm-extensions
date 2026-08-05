// Ephemeral in-memory progress state for an in-flight BOM transfer, polled by the client
// while the long POST /erp/transfer request is running. Not persisted - a page reload during
// a transfer loses the live display, but the transfer itself still runs to completion.

const progress = new Map();

function start(transferId) {
    progress.set(transferId, { step: '', current: 0, total: 0, detail: '', done: false });
}

function update(transferId, step, current, total, detail) {
    const entry = progress.get(transferId);
    if (!entry) return;
    entry.step    = step;
    entry.current = current;
    entry.total   = total;
    entry.detail  = detail || '';
}

function finish(transferId) {
    const entry = progress.get(transferId);
    if (entry) entry.done = true;
    setTimeout(function() { progress.delete(transferId); }, 60000);
}

function get(transferId) {
    return progress.get(transferId) || null;
}

module.exports = { start, update, finish, get };
