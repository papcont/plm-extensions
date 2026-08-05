// Serializes every BOM transfer (manual button, retry, batch, webhook) through one chain so no
// two ever run concurrently - two overlapping transfers that happen to share a component ref
// could otherwise both miss the "already exists" check in ensureProduct/ensureBOM and race to
// create it twice. A plain promise chain is enough for this app's scale (a handful of change-
// order approvals, not a storm of thousands) - no queue library, no persistence: if the process
// restarts, whatever was mid-flight is gone, same as every other in-memory state in this app.
// ponytail: single global lane, not per-tenant/per-workspace - fine while there's one tenant.

let tail = Promise.resolve();

function enqueue(fn) {

    const result = tail.then(fn, fn);
    tail = result.then(function() {}, function() {}); // keep the chain alive past a rejection

    return result;
}

module.exports = { enqueue };
