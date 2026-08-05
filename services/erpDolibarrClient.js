const http  = require('http');
const https = require('https');

// keepAlive reuses TCP connections across the many sequential/rapid calls a large-BOM transfer
// makes instead of opening a fresh one each time - on Windows especially, without this, heavy
// short-lived-connection churn can exhaust the ephemeral port range and make new connections sit
// waiting on a port to free up (TIME_WAIT), which looks exactly like "Dolibarr is slow" even
// though a single isolated request responds instantly.
const axios = require('axios').create({
    timeout    : 30000,
    httpAgent  : new http.Agent({ keepAlive: true }),
    httpsAgent : new https.Agent({ keepAlive: true })
});

// Thin wrapper around the Dolibarr REST API used by the ERP BOM transfer.
// `dolibarr` is { apiUrl, apiKey } taken from app.locals (set from environment.js).
// Requests time out after 30s instead of hanging forever if Dolibarr is unreachable/slow.

function getHeaders(dolibarr) {
    return {
        'DOLAPIKEY'    : dolibarr.apiKey,
        'Content-Type' : 'application/json',
        'Accept'       : 'application/json'
    };
}

async function findProductByRef(dolibarr, reference) {

    const response = await axios.get(dolibarr.apiUrl + '/products', {
        headers : getHeaders(dolibarr),
        params  : { sqlfilters: `t.ref:=:'${reference}'` }
    });

    return (response.data && response.data.length > 0) ? response.data[0] : null;
}

async function createProduct(dolibarr, productData) {

    const response = await axios.post(dolibarr.apiUrl + '/products', productData, {
        headers : getHeaders(dolibarr)
    });

    return response.data;
}

async function createBOM(dolibarr, bomData) {

    const response = await axios.post(dolibarr.apiUrl + '/boms', bomData, {
        headers : getHeaders(dolibarr)
    });

    return (typeof response.data === 'number') ? response.data : response.data.id;
}

async function updateBOM(dolibarr, bomId, bomData) {

    const response = await axios.put(dolibarr.apiUrl + '/boms/' + bomId, bomData, {
        headers : getHeaders(dolibarr)
    });

    return response.data;
}

async function findBOMByProductRef(dolibarr, productRef) {

    const product = await findProductByRef(dolibarr, productRef);
    if (!product) return null;

    const response = await axios.get(dolibarr.apiUrl + '/boms', {
        headers : getHeaders(dolibarr),
        params  : { sqlfilters: `t.fk_product:=:${product.id}` }
    });

    return (response.data && response.data.length > 0) ? response.data[0] : null;
}

async function addBOMLine(dolibarr, bomId, lineData) {

    const response = await axios.post(dolibarr.apiUrl + '/boms/' + bomId + '/lines', lineData, {
        headers : getHeaders(dolibarr)
    });

    return (typeof response.data === 'number') ? response.data : response.data.id;
}

async function findBOMByProductId(dolibarr, productId) {

    const response = await axios.get(dolibarr.apiUrl + '/boms', {
        headers : getHeaders(dolibarr),
        params  : { sqlfilters: `t.fk_product:=:${productId}` }
    });

    return (response.data && response.data.length > 0) ? response.data[0] : null;
}

// --- ERP-neutral facade -----------------------------------------------------------------
// Everything above is Dolibarr's own shape. erpTransferService.js only calls the functions
// below, passing plain { ref, label, description } objects - no Dolibarr field names leak
// into the orchestration layer, so a future TimeLine client can implement the same facade.

const PRODUCT_TYPE          = 0; // Dolibarr: 0 = product, 1 = service
const PRODUCT_STATUS_ON_SALE = 1;
const BOM_TYPE_MANUFACTURING = 0;
const BOM_STATUS_VALIDATED   = 1;

// Dolibarr silently rewrites "special" characters in `ref` to underscores when it stores a
// product/BOM - confirmed empirically (not just whitespace): runs of whitespace collapse to one
// underscore, and each of  ' " ` \ / : ; * ? = [ ] | $ ,  individually becomes one underscore
// (not collapsed when repeated). If we search using the original ref, that search never matches
// what's actually stored, so ensureProduct/ensureBOM think nothing exists yet and try to create
// it again - which then fails against Dolibarr's own uniqueness check ("ErrorProductAlreadyExists")
// once two different BOM lines resolve to refs that only differ by one of these characters (e.g.
// "M2 x 2,5" vs "M2 x 2.5" both sanitize to overlapping forms, or "50/50" collides after the
// slash is stripped). Sanitizing before every search AND create keeps what we send in sync with
// what Dolibarr will actually store. Known gap: a literal " or a <tag>-looking substring gets
// stripped (not replaced) by Dolibarr's own input sanitization - not replicated here, since real
// PLM part numbers/titles essentially never contain those.
//
// Parentheses are the one exception: Dolibarr's storage layer happily keeps them in a ref, but
// findProductByRef's own sqlfilters query uses parentheses for grouping - a ref value containing
// a literal "(" or ")" breaks that query's syntax outright ("Bad syntax of the search string"),
// confirmed against a real BOM part named "... (mm) ..." on a 643-line assembly. We don't need to
// preserve Dolibarr's exact storage behavior here, only be internally consistent between search
// and create, so parentheses are stripped too rather than trying to escape them for sqlfilters.
function sanitizeRef(ref) {
    return String(ref).trim().replace(/\s+/g, '_').replace(/['"`\\\/:;*?=\[\]|$,()]/g, '_');
}

// Process-lifetime cache of ref -> Dolibarr product, so a large BOM's product-existence check
// isn't repeated on every future transfer (webhook-triggered re-transfers of the same assembly
// are the common case). Only saves the read - creation still goes through Dolibarr every time a
// ref is genuinely new, and writes stay exactly as sequential as before.
// ponytail: no invalidation - stale only if a product is deleted/renamed directly in Dolibarr
// outside this app, which doesn't happen in normal operation. Restart the server to clear it.
const productCache = new Map(); // sanitizedRef -> { id }

async function ensureProduct(dolibarr, neutralItem) {

    const ref = sanitizeRef(neutralItem.ref);
    if (productCache.has(ref)) return productCache.get(ref);

    const existing = await findProductByRef(dolibarr, ref);
    if (existing) {
        productCache.set(ref, existing);
        return existing;
    }

    const productId = await createProduct(dolibarr, {
        ref         : ref,
        label       : neutralItem.label,
        description : neutralItem.description || '',
        type        : PRODUCT_TYPE,
        status      : PRODUCT_STATUS_ON_SALE
    });

    const product = { id: productId };
    productCache.set(ref, product);
    return product;
}

async function ensureBOM(dolibarr, neutralBOM, productId) {

    const payload = {
        ref         : sanitizeRef(neutralBOM.ref),
        label       : neutralBOM.label,
        description : neutralBOM.description || '',
        bomtype     : BOM_TYPE_MANUFACTURING,
        status      : BOM_STATUS_VALIDATED,
        fk_product  : productId,
        qty         : 1,
        efficiency  : 1
    };

    const existing = await findBOMByProductId(dolibarr, productId);

    if (existing) {
        await updateBOM(dolibarr, existing.id, payload);
        return { id: existing.id, isNew: false };
    }

    const bomId = await createBOM(dolibarr, payload);
    return { id: bomId, isNew: true };
}

// onProgress(current, total) is called after each line so the caller can surface a live
// "X of N" counter - the facade owns the per-line API call, the caller owns what that
// progress looks like on screen. Sequential on purpose: this local Dolibarr install could not
// tolerate concurrent writes (see resolveBOMPositions in erpTransferService.js for the same
// finding against ensureProduct) - and unlike that find-or-create call, a plain BOM-line POST
// has no idempotency check, so retrying/parallelizing it risks creating duplicate lines.
async function addBOMLines(dolibarr, bomId, lines, onProgress) {

    const ids = [];

    for (let i = 0; i < lines.length; i++) {
        ids.push(await addBOMLine(dolibarr, bomId, lines[i]));
        if (onProgress) onProgress(i + 1, lines.length);
    }

    return ids;
}

module.exports = {
    findProductByRef,
    createProduct,
    createBOM,
    updateBOM,
    findBOMByProductRef,
    addBOMLine,
    ensureProduct,
    ensureBOM,
    addBOMLines,
    sanitizeRef
};
