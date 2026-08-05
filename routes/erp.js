const express        = require('express');
const router         = express.Router();
const axios          = require('axios').create({ timeout: 30000 });
const transferService = require('../services/erpTransferService');
const history         = require('../services/erpHistoryStore');
const progress        = require('../services/erpProgressStore');
const webhookManager  = require('../services/erpWebhookManager');
const webhookRegistrations = require('../services/erpWebhookRegistrationStore');
const bomTransformer  = require('../services/erpBomTransformer');

router.get('/config', function(req, res) {

    const dolibarr = req.app.locals.dolibarr;

    res.json({
        success : true,
        data    : {
            configured        : !!(dolibarr.apiUrl && dolibarr.apiKey),
            workspaceId       : (req.app.locals.applications.erp && req.app.locals.applications.erp.workspaceId) || req.app.locals.common.workspaceIds.items,
            itemNumberFieldId : (req.app.locals.applications.erp && req.app.locals.applications.erp.itemNumberFieldId) || 'NUMBER'
        }
    });

});

router.post('/transfer', async function(req, res) {

    console.log(' /erp/transfer');

    const { wsId, dmsId, transferId, override, trigger } = req.body;

    if (!wsId || !dmsId) {
        return res.status(400).json({ success: false, message: 'wsId and dmsId are required' });
    }

    try {
        const result = await transferService.transferBOM(req, wsId, dmsId, transferId, override === true || override === 'true', trigger || 'manual');
        res.json({ success: result.success, message: result.message, requiresOverride: result.requiresOverride || false, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }

});

router.get('/transfer-progress/:id', function(req, res) {
    res.json({ success: true, data: progress.get(req.params.id) });
});

router.post('/transfer-batch', async function(req, res) {

    console.log(' /erp/transfer-batch');

    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, message: 'items array is required' });
    }

    try {
        const results = await transferService.batchTransfer(req, items);
        const successCount = results.filter(function(r) { return r.success; }).length;
        res.json({ success: true, message: `Transferred ${successCount} of ${items.length} BOMs`, data: { results } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }

});

// Dolibarr's API base (.../api/index.php) isn't its web UI base - strip the API suffix to get
// the browsable card URL. Computed on read, not stored, so it always follows the current config.
function withDolibarrUrl(record, req) {
    if (!record || !record.dolibarrBomId) return record;
    const webBase = (req.app.locals.dolibarr.apiUrl || '').replace(/\/api\/index\.php$/, '');
    return Object.assign({}, record, { dolibarrUrl: webBase ? webBase + '/bom/bom_card.php?id=' + record.dolibarrBomId : null });
}

router.get('/transfer-history', function(req, res) {
    const limit = parseInt(req.query.limit) || 50;
    const rows  = history.getHistory(limit).map(function(record) { return withDolibarrUrl(record, req); });
    res.json({ success: true, data: { history: rows } });
});

router.get('/transfer-status/:id', function(req, res) {
    const record = history.getById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: 'Transfer not found' });
    res.json({ success: true, data: withDolibarrUrl(record, req) });
});

router.get('/transfer-item/:wsId/:dmsId', function(req, res) {
    const record = history.getByItem(req.params.wsId, req.params.dmsId);
    if (!record) return res.status(404).json({ success: false, message: 'No transfer found for this item' });
    res.json({ success: true, data: withDolibarrUrl(record, req) });
});

// Lean Change Order -> BOM auto-transfer. One-time, interactive admin action: registers the
// 3 transitions that all lead into the "Approved" state (see services/erpWebhookManager.js for
// why 3 - Autodesk scopes a webhook per transition, not per state). Requires
// applications.erp.leanChangeOrderWebhook to be configured (settings/custom.js); unset by
// default, so this never runs against the Dolibarr demo unless deliberately turned on.
router.post('/webhooks/register', async function(req, res) {

    const config = (req.app.locals.applications.erp && req.app.locals.applications.erp.leanChangeOrderWebhook) || {};

    if (!Array.isArray(config.transitionIds) || config.transitionIds.length === 0 || !config.callbackUrl) {
        return res.status(400).json({ success: false, message: 'applications.erp.leanChangeOrderWebhook (transitionIds, callbackUrl) is not configured' });
    }

    try {
        const results = await webhookManager.registerTransitionWebhooks(req, config);
        const successful = results.filter(function(r) { return r.success; });
        webhookRegistrations.save(config.callbackUrl, successful.map(function(r) { return { transitionId: r.transitionId, hookId: r.hookId }; }));
        res.json({ success: true, data: { results } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }

});

router.post('/webhooks/unregister/:hookId', async function(req, res) {
    try {
        await webhookManager.unregisterWebhook(req, req.params.hookId);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

function parseItemUrn(urn) {
    const idSegments = urn.split(':').pop().split('.'); // "TENANT.WSID.DMSID"
    return { wsId: idSegments[idSegments.length - 2], dmsId: idSegments[idSegments.length - 1] };
}

// The Managed Items tab (view 11) lists every level of the assembly the change touches - the
// top assembly AND each of its own parts - not just the item the change was raised against.
// where-used tells us, for a given affected item, which assembly (if any) already contains it;
// if that assembly is itself in the affected set, this item is a sub-component of another
// managed item and should be skipped - only items with no in-set parent are the real targets.
async function isSubComponentOfAnotherAffectedItem(req, wsId, dmsId, affectedUrns) {
    const url = req.app.locals.tenantLink + '/api/v3/workspaces/' + wsId + '/items/' + dmsId + '/where-used?limit=100&offset=0';
    const response = await axios.get(url, { headers: req.session.headers });
    const edges = (response.data && response.data.edges) || [];
    return edges.some(function(edge) { return affectedUrns.has(edge.child); });
}

function sleep(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

const RETRY_DELAYS_MS = [30000, 120000, 600000]; // 30s, 2min, 10min - 3 retries after the first attempt

// Webhook-triggered transfers run unattended - give a transient failure (Dolibarr hiccup, PLM
// rate limit) a few chances before giving up, instead of leaving a single failed attempt as the
// final word. The backoff wait happens BETWEEN transferBOM calls, never while holding the shared
// transfer queue (see erpTransferQueue.js), so a slow retry here never blocks unrelated transfers.
// ponytail: retries are in-memory (setTimeout) - a server restart mid-backoff drops the pending
// retry silently. Upgrade to a persisted retry queue if that turns out to matter in practice.
async function transferWithRetry(req, wsId, dmsId, override) {

    let result;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {

        const trigger = (attempt === 0) ? 'webhook' : 'webhook-retry';
        result = await transferService.transferBOM(req, wsId, dmsId, null, override, trigger);

        if (result.success) return result;

        if (attempt < RETRY_DELAYS_MS.length) {
            const delay = RETRY_DELAYS_MS[attempt];
            console.log(' /erp/webhooks/lean-change-order - transfer for ' + wsId + '/' + dmsId + ' failed (attempt ' + (attempt + 1) + '/' + (RETRY_DELAYS_MS.length + 1) + '), retrying in ' + (delay / 1000) + 's');
            await sleep(delay);
        }

    }

    return result; // all attempts exhausted - caller decides whether/how to notify

}

// Optional (off unless applications.erp.leanChangeOrderWebhook.notifyOnFailure is configured):
// writes a status/link into a tenant-defined field on the CHANGE ORDER item, then runs an
// on-demand Fusion Manage script on that same item - the script itself (authored in the tenant,
// not here) composes and sends the actual email using that field. Keeps the "who gets notified,
// what the email says" decision entirely in Fusion Manage, where the tenant admin already owns it.
async function notifyTransferFailure(req, changeOrder, changeOrderData, failedItem, record, notifyConfig, publicOrigin) {

    if (!notifyConfig || !notifyConfig.fieldId || !notifyConfig.scriptId) return;

    try {

        const fieldSelf = bomTransformer.findFieldSelf(changeOrderData, notifyConfig.fieldId);
        if (!fieldSelf) {
            console.log(' /erp/webhooks/lean-change-order - notify field ' + notifyConfig.fieldId + ' not found on ' + changeOrder.wsId + '/' + changeOrder.dmsId + ', skipping notification');
            return;
        }

        const link    = publicOrigin + '/erp?historyId=' + record.id;
        const message = 'ERP transfer failed for ' + (failedItem.title || (failedItem.wsId + '/' + failedItem.dmsId))
            + ' after ' + (RETRY_DELAYS_MS.length + 1) + ' attempts: ' + record.errorMessage + ' - ' + link;

        const changeOrderPath = '/api/v3/workspaces/' + changeOrder.wsId + '/items/' + changeOrder.dmsId;

        await axios.patch(req.app.locals.tenantLink + changeOrderPath, {
            sections: [{ fields: [{ __self__: fieldSelf, value: message }] }]
        }, { headers: req.session.headers });

        await axios.post(req.app.locals.tenantLink + changeOrderPath + '/scripts/' + notifyConfig.scriptId, {}, { headers: req.session.headers });

        console.log(' /erp/webhooks/lean-change-order - notification script triggered for ' + changeOrder.wsId + '/' + changeOrder.dmsId);

    } catch (error) {
        console.log(' /erp/webhooks/lean-change-order - failed to trigger failure notification: ' + (error.response ? JSON.stringify(error.response.data) : error.message));
    }

}

router.post('/webhooks/lean-change-order', async function(req, res) {

    const config    = (req.app.locals.applications.erp && req.app.locals.applications.erp.leanChangeOrderWebhook) || {};
    const signature = req.headers['x-adsk-signature'];

    if (!webhookManager.verifySignature(config.secret, req.rawBody, signature)) {
        console.log(' /erp/webhooks/lean-change-order - rejected: invalid signature');
        return res.status(401).json({ success: false, message: 'Invalid signature' });
    }

    // Acknowledge immediately - Autodesk expects a fast response; the actual transfer (fetching
    // the BOM, ensuring products/lines in Dolibarr) can take a while and runs after this.
    res.status(200).json({ success: true, message: 'Webhook received' });

    try {

        const resourceUrn = req.body && req.body.resourceUrn;
        if (!resourceUrn) {
            console.log(' /erp/webhooks/lean-change-order - no resourceUrn in payload');
            return;
        }

        const changeOrder = parseItemUrn(resourceUrn);

        req.session.headers = await webhookManager.getServiceHeaders(req);

        // `.lifecycle` is the item's REVISION lifecycle (Unreleased/Released) - a different axis
        // entirely from the workflow step. The actual workflow state (Creation/Review/Approved/...)
        // lives in `.currentState`.
        const changeOrderUrl = req.app.locals.tenantLink + '/api/v3/workspaces/' + changeOrder.wsId + '/items/' + changeOrder.dmsId;
        const changeOrderResponse = await axios.get(changeOrderUrl, { headers: req.session.headers });
        const currentStateTitle = changeOrderResponse.data && changeOrderResponse.data.currentState && changeOrderResponse.data.currentState.title;
        const approvedTitle     = config.approvedLifecycleTitle || 'Approved';

        // Logged, not enforced: this workflow can auto-advance Approved -> Closed immediately
        // (see the "Close" transition), so by the time this check runs the state may already
        // have moved past "Approved" even though the transition into it is exactly what fired
        // this webhook. The webhook's own scope (only the 3 transitions that lead into Approved
        // were registered) is the real gate here - a live re-check would just race the workflow.
        if (currentStateTitle !== approvedTitle) {
            console.log(' /erp/webhooks/lean-change-order - ' + changeOrder.wsId + '/' + changeOrder.dmsId + ' is now "' + currentStateTitle + '" (expected "' + approvedTitle + '" at the moment of transition, likely auto-advanced since) - proceeding anyway');
        }

        // The change order item itself has no BOM - it manages the real item(s) it affects
        // (the same "Managed/Affected Items" relationship Change Orders use, view 11).
        const managedResponse = await axios.get(req.app.locals.tenantLink + '/api/v3/workspaces/' + changeOrder.wsId + '/items/' + changeOrder.dmsId + '/views/11', { headers: req.session.headers });
        const affectedItems   = (managedResponse.data && managedResponse.data.affectedItems) || [];

        if (affectedItems.length === 0) {
            console.log(' /erp/webhooks/lean-change-order - ' + changeOrder.wsId + '/' + changeOrder.dmsId + ' has no managed items, nothing to transfer');
            return;
        }

        const affectedUrns  = new Set(affectedItems.map(function(affected) { return affected.item.urn; }));
        const topLevelItems = [];

        for (const affected of affectedItems) {
            const parts = affected.item.link.split('/'); // /api/v3/workspaces/{wsId}/items/{dmsId}
            const wsId  = parts[4];
            const dmsId = parts[6];

            if (await isSubComponentOfAnotherAffectedItem(req, wsId, dmsId, affectedUrns)) {
                console.log(' /erp/webhooks/lean-change-order - skipping ' + wsId + '/' + dmsId + ' - it is a sub-component of another managed item, not the top assembly');
                continue;
            }

            topLevelItems.push({ wsId: wsId, dmsId: dmsId, title: affected.item.title });
        }

        // Each item's retries run independently and concurrently - a slow backoff on one failing
        // item must not delay the others (see transferWithRetry for why that's still queue-safe).
        await Promise.all(topLevelItems.map(async function(item) {

            console.log(' /erp/webhooks/lean-change-order - triggering transfer for ' + item.wsId + '/' + item.dmsId + ' (from ' + changeOrder.wsId + '/' + changeOrder.dmsId + ')');
            const result = await transferWithRetry(req, item.wsId, item.dmsId, true); // override: the approval itself is the release signal

            if (!result.success) {
                const publicOrigin = new URL(config.callbackUrl).origin;
                await notifyTransferFailure(req, changeOrder, changeOrderResponse.data, item, result.record, config.notifyOnFailure, publicOrigin);
            }

        }));

    } catch (error) {
        console.log(' /erp/webhooks/lean-change-order - error: ' + (error.response ? JSON.stringify(error.response.data) : error.message));
    }

});

module.exports = router;
