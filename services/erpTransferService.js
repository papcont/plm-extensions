const http  = require('http');
const https = require('https');

// keepAlive reuses TCP connections across the many PLM calls a large-BOM transfer makes instead
// of opening a fresh one each time - see erpDolibarrClient.js for why this matters especially on
// Windows under sustained request volume.
const axios = require('axios').create({
    timeout    : 30000,
    httpAgent  : new http.Agent({ keepAlive: true }),
    httpsAgent : new https.Agent({ keepAlive: true })
});

const bomTransformer = require('./erpBomTransformer');
const dolibarr       = require('./erpDolibarrClient');
const history        = require('./erpHistoryStore');
const progress       = require('./erpProgressStore');
const queue          = require('./erpTransferQueue');

// Axios error.message alone ("Request failed with status code 400") hides which call
// failed and why. Surface method/url/status/body so failures are diagnosable from the
// transfer history alone, without needing server console access.
function describeError(error) {

    if (error.response && error.config) {
        const body = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data);
        return `${error.config.method.toUpperCase()} ${error.config.url} -> ${error.response.status}: ${body}`;
    }

    return error.message;
}

async function getItemDetails(req, wsId, dmsId) {
    const url = req.app.locals.tenantLink + '/api/v3/workspaces/' + wsId + '/items/' + dmsId;
    const response = await axios.get(url, { headers: req.session.headers });
    return response.data;
}

async function getFlatBOM(req, wsId, dmsId) {

    const url = req.app.locals.tenantLink + '/api/v3/workspaces/' + wsId + '/items/' + dmsId
        + '/bom-items?revisionBias=release&rootId=' + dmsId;

    const headers = Object.assign({}, req.session.headers, {
        accept: 'application/vnd.autodesk.plm.bom.flat.bulk+json'
    });

    const response = await axios.get(url, { headers: headers });

    return (response.data && response.data.flatItems) ? response.data.flatItems : [];
}

async function getItemDetailsByLink(req, link) {
    const response = await axios.get(req.app.locals.tenantLink + link, { headers: req.session.headers });
    return response.data;
}

// Flat BOM entries only carry item.link/urn/title (no dmsId, no sections, no quantity) - the real
// item number lives behind item.link and needs its own fetch. Doing that one at a time (as this
// used to) means a large BOM (hundreds to thousands of unique parts) makes that many *sequential*
// PLM round trips - easily long enough for an unattended (webhook) transfer's access token to
// expire mid-transfer. That was the real cause, not the token lifetime itself. PLM (Autodesk's
// cloud API) handles concurrent reads fine, so this stage fetches at up to RESOLVE_CONCURRENCY at
// once instead - see resolveBOMPositions below for why the Dolibarr side of the work stays
// strictly sequential instead of following the same pattern.
const RESOLVE_CONCURRENCY = 6;

// A burst of concurrent requests against a local/modest Dolibarr install (Apache+PHP+MySQL on a
// dev machine, not a provisioned server) can trip a transient "socket hang up" - the connection
// resets, not an application error, and neither side actually disagrees about the data. Retrying
// a couple times is safe here specifically because both retried operations are search-before-act
// (getItemDetailsByLink is a plain GET; ensureProduct always re-checks findProductByRef first) -
// a retry after a hang-up just re-does the same safe check, it can never create a duplicate.
async function withTransientRetry(fn, attempts) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isTransient = error.code === 'ECONNRESET' || error.code === 'ECONNABORTED' || /socket hang up/i.test(error.message || '');
            if (!isTransient || attempt === attempts) throw error;
        }
    }
}

// Two deliberately different concurrency strategies, learned live against a real large BOM:
// PLM (Autodesk's cloud API) handles concurrent reads fine, so stage 1 fetches item details in
// parallel - that's most of the round trips for a BOM with many distinct components. Dolibarr
// (a modest local Apache+PHP+MySQL install, not a provisioned server) could NOT tolerate ANY
// concurrent product-creation writes - even 3 at a time caused MySQL lock contention severe
// enough to make requests hang for tens of seconds each, far worse than running them one at a
// time. So stage 2 (ensureProduct) stays fully sequential - safe, and still only pays once per
// UNIQUE component instead of once per BOM line.
async function resolveBOMPositions(req, dolibarrConfig, flatItems, itemNumberFieldId, transferId, validationOptions) {

    const total = flatItems.length;

    // Stage 1: resolve every position's PLM item (ref/label), deduped by link, concurrently.
    const itemPromises = new Map(); // link -> Promise<{ref,label}>

    function getItem(link) {
        if (!itemPromises.has(link)) {
            itemPromises.set(link, withTransientRetry(function() {
                return getItemDetailsByLink(req, link);
            }, 3).then(function(itemDetails) {
                return {
                    ref   : bomTransformer.extractItemRef(itemDetails, itemNumberFieldId),
                    label : itemDetails.title || 'Unknown'
                };
            }));
        }
        return itemPromises.get(link);
    }

    const resolvedItems = new Array(total);
    let itemsDone        = 0;

    {
        let nextIndex = 0;
        async function worker() {
            while (nextIndex < total) {
                const i    = nextIndex++;
                const link = flatItems[i].item && flatItems[i].item.link;
                if (link) resolvedItems[i] = await getItem(link);
                itemsDone++;
                if (transferId) progress.update(transferId, 'Lade Teile-Informationen', itemsDone, total, resolvedItems[i] && resolvedItems[i].label);
            }
        }
        await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, total) || 1 }, worker));
    }

    // Stage 2: ensure each unique Dolibarr product ONE AT A TIME (see note above). A plain Map is
    // enough here - no in-flight-promise dance needed since nothing runs concurrently in this loop.
    const productByKey = new Map(); // sanitized ref -> product
    const lines         = new Array(total);
    const labels        = new Array(total);
    let linesDone        = 0;

    for (let i = 0; i < total; i++) {

        const resolvedItem = resolvedItems[i];

        if (resolvedItem) {

            const key = dolibarr.sanitizeRef(resolvedItem.ref);

            if (!productByKey.has(key)) {
                const violations = bomTransformer.validateNeutralItem(resolvedItem, 'bomLine[' + i + ']', validationOptions);
                if (violations.length > 0) throw new bomTransformer.ValidationError(violations);
                productByKey.set(key, await withTransientRetry(function() {
                    return dolibarr.ensureProduct(dolibarrConfig, resolvedItem);
                }, 3));
            }

            lines[i]  = { fk_product: productByKey.get(key).id, qty: 1, qty_frozen: 0, efficiency: 1 };
            labels[i] = resolvedItem.label;

        }

        linesDone++;
        if (transferId) progress.update(transferId, 'Verarbeite BOM-Positionen', linesDone, total, labels[i]);

    }

    const filteredLines  = [];
    const filteredLabels = [];
    for (let i = 0; i < total; i++) {
        if (lines[i]) {
            filteredLines.push(Object.assign({ position: filteredLines.length + 1 }, lines[i]));
            filteredLabels.push(labels[i]);
        }
    }

    return { lines: filteredLines, labels: filteredLabels };

}

// Coarse milestones, not a full HTTP trace - enough to see where a transfer got to without
// instrumenting every single axios call. Timestamped so gaps (e.g. a slow PLM call) are visible.
function logStep(log, message) {
    log.push({ at: new Date().toISOString(), message: message });
}

async function transferBOMNow(req, wsId, dmsId, transferId, override, trigger) {

    const dolibarrConfig     = req.app.locals.dolibarr;
    const erpSettings        = req.app.locals.applications.erp || {};
    const itemNumberFieldId  = erpSettings.itemNumberFieldId || 'NUMBER';
    // Off by default (0) - only enforce a max field length once a target ERP (e.g. TimeLine)
    // actually requires it. Never regress today's working Dolibarr transfers over this.
    const validationOptions = { maxTextLength: erpSettings.maxFieldLength || 0 };
    const log                = [];

    if (!dolibarrConfig.apiUrl || !dolibarrConfig.apiKey) {
        throw new Error('Dolibarr is not configured. Set dolibarrApiUrl / dolibarrApiKey in environment.js.');
    }

    let itemDetails;

    try {

        itemDetails = await getItemDetails(req, wsId, dmsId);
        logStep(log, 'Fetched item details: ' + itemDetails.title);

        // Non-blocking gate: off unless releasedLifecycleValues is configured (today's Dolibarr
        // demo has it unset, so this never fires). When configured and the item isn't in an
        // allowed state, hand control back to the user instead of failing - they can still force
        // the transfer through (override=true). No history record is written for this prompt
        // itself, only for the transfer that actually happens afterwards.
        const releasedValues = erpSettings.releasedLifecycleValues;
        if (Array.isArray(releasedValues) && releasedValues.length > 0 && !override) {
            const lifecycleTitle = bomTransformer.extractLifecycleTitle(itemDetails);
            if (!releasedValues.includes(lifecycleTitle)) {
                return {
                    success: false,
                    requiresOverride: true,
                    message: 'Artikel ist nicht freigegeben oder im falschen Lebenszyklusstatus ("' + (lifecycleTitle || 'unbekannt') + '").'
                };
            }
        }

        const flatItems = await getFlatBOM(req, wsId, dmsId);
        logStep(log, 'Fetched flat BOM: ' + flatItems.length + ' position(s)');

        if (flatItems.length === 0) {
            const record = history.logTransfer({
                wsId: wsId, dmsId: dmsId, itemTitle: itemDetails.title, trigger: trigger || 'manual',
                status: 'error', errorMessage: 'No BOM items found', log: log
            });
            return { success: false, message: 'No BOM items found for this item', record };
        }

        if (transferId) progress.start(transferId);

        const mainItem = bomTransformer.transformItem(itemDetails, itemNumberFieldId);
        const bomHeader = {
            ref         : 'BOM-' + mainItem.ref,
            label       : 'BOM for ' + mainItem.label,
            description : 'Bill of Materials imported from Fusion Manage'
        };

        const headerViolations = bomTransformer.validateNeutralItem(mainItem, 'item', validationOptions)
            .concat(bomTransformer.validateNeutralItem(bomHeader, 'bomHeader', validationOptions));
        if (headerViolations.length > 0) throw new bomTransformer.ValidationError(headerViolations);

        const product = await dolibarr.ensureProduct(dolibarrConfig, mainItem);
        logStep(log, 'Ensured Dolibarr product ' + mainItem.ref + ' (#' + product.id + ')');

        const { lines: dolibarrLines, labels: lineLabels } = await resolveBOMPositions(req, dolibarrConfig, flatItems, itemNumberFieldId, transferId, validationOptions);
        logStep(log, 'Resolved ' + dolibarrLines.length + ' Dolibarr BOM line(s)');

        const bom = await dolibarr.ensureBOM(dolibarrConfig, bomHeader, product.id);
        const dolibarrBomId = bom.id;
        logStep(log, (bom.isNew ? 'Created' : 'Updated') + ' Dolibarr BOM ' + bomHeader.ref + ' (#' + dolibarrBomId + ')');

        if (bom.isNew) {
            await dolibarr.addBOMLines(dolibarrConfig, dolibarrBomId, dolibarrLines, function(current, total) {
                if (transferId) progress.update(transferId, 'Erstelle Stücklistenzeilen', current, total, lineLabels[current - 1]);
            });
            logStep(log, 'Added ' + dolibarrLines.length + ' line(s) to BOM #' + dolibarrBomId);
        }

        // Positions existed in the flat BOM but none carried a resolvable item link - the
        // transfer "succeeded" in that nothing crashed, but there's nothing to inspect in
        // Dolibarr either. Flag it instead of reporting a clean success.
        const isEmptyResult = dolibarrLines.length === 0;

        const record = history.logTransfer({
            wsId: wsId, dmsId: dmsId, itemTitle: itemDetails.title, trigger: trigger || 'manual',
            dolibarrBomId: dolibarrBomId, status: isEmptyResult ? 'warning' : 'success', overridden: !!override,
            errorMessage: isEmptyResult ? 'BOM positions were found but none resolved to a transferable item' : null,
            log: log
        });

        return { success: true, message: 'BOM transferred successfully', dolibarrBomId: dolibarrBomId, itemsTransferred: dolibarrLines.length, record };

    } catch (error) {

        const message = error.isRejection ? error.message : describeError(error);
        logStep(log, 'FAILED: ' + message);

        const record = history.logTransfer({
            wsId: wsId, dmsId: dmsId, itemTitle: itemDetails ? itemDetails.title : null, trigger: trigger || 'manual',
            status: error.isRejection ? 'rejected' : 'error', errorMessage: message, log: log
        });

        return { success: false, message: message, record: record };

    } finally {

        if (transferId) progress.finish(transferId);

    }
}

// Every caller (manual button, retry, batch, webhook) goes through here so the queue can
// guarantee no two transfers ever run at the same time - see services/erpTransferQueue.js.
function transferBOM(req, wsId, dmsId, transferId, override, trigger) {
    return queue.enqueue(function() {
        return transferBOMNow(req, wsId, dmsId, transferId, override, trigger);
    });
}

async function batchTransfer(req, items) {

    const results = [];

    for (const item of items) {
        const result = await transferBOM(req, item.wsId, item.dmsId, null, false, 'batch');
        results.push(Object.assign({}, item, result));
    }

    return results;
}

module.exports = { transferBOM, batchTransfer };
