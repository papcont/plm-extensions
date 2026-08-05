// Registers and receives Autodesk Fusion Manage `workflow.transition` webhooks so a BOM
// transfer can start automatically once a Lean Change Order reaches "Approved" (workspace 1033,
// workflow 1, state 1167). The target state is reachable via three different transitions
// (1778 Perform Direct Approval, 1787 Set Complete & Release Items, 1789 Upon (final) Approval) -
// the Autodesk API scopes a webhook to one transition at a time, so all three are registered
// against the same callback; the receiver double-checks the resulting state before transferring.
// Reference: FM Postman Collection/Fusion Manage REST API.postman_collection.json,
// "Create Webhook at workflow transition" - confirmed request shape (X-Tenant header, scope URN).

const axios          = require('axios').create({ timeout: 15000 });
const crypto         = require('crypto');
const serviceAccount = require('./erpServiceAccountStore');
const registrations  = require('./erpWebhookRegistrationStore');

const WEBHOOKS_URL = 'https://developer.api.autodesk.com/webhooks/v1/systems/adsk.flc.production/events/workflow.transition/hooks';
const AUTH_URL      = 'https://developer.api.autodesk.com/authentication/v2/token';

function buildScopeUrn(tenant, workspaceId, workflowId, transitionId) {
    return 'urn:adsk.plm:tenant.workspace.workflow.transition:' + tenant.toUpperCase() + '.' + workspaceId + '.' + workflowId + '.' + transitionId;
}

// Uses the current interactive session's 3-legged token (same one every /plm/* call already
// uses) - registering a webhook is an explicit, logged-in admin action, not something the
// server does unattended at boot.
async function registerTransitionWebhooks(req, config) {

    const headers = Object.assign({}, req.session.headers, { 'X-Tenant': req.app.locals.tenant.toUpperCase() });
    const results = [];

    for (const transitionId of config.transitionIds) {

        try {

            const response = await axios.post(WEBHOOKS_URL, {
                callbackUrl : config.callbackUrl,
                scope       : { 'workflow.transition': buildScopeUrn(req.app.locals.tenant, config.workspaceId, config.workflowId, transitionId) },
                token       : config.secret
            }, { headers: headers });

            // 201 Created returns an empty body - the new hook's id is in the Location header
            // (".../hooks/{hookId}").
            const location = response.headers && response.headers.location;
            const hookId   = location ? location.split('/').pop() : null;

            results.push({ transitionId: transitionId, success: true, hookId: hookId });

        } catch (error) {
            results.push({ transitionId: transitionId, success: false, error: (error.response && error.response.data) || error.message });
        }

    }

    return results;
}

async function unregisterWebhook(req, hookId) {
    const headers = Object.assign({}, req.session.headers, { 'X-Tenant': req.app.locals.tenant.toUpperCase() });
    await axios.delete(WEBHOOKS_URL + '/' + hookId, { headers: headers });
}

// No interactive user is logged in when Autodesk calls the webhook back. 2-legged
// client-credentials + X-user-id impersonation needs a tenant-admin-side mapping that isn't set
// up here (confirmed: fails with "Mapped user is either not present or not valid" regardless of
// target user) - so instead this refreshes the designated service account's own 3-legged
// session (erpServiceAccountEmail in environment.js), the same grant every normal login uses
// minus the interactive step. That account just needs to have logged into the app once - see
// routes/landing.js, which captures the refresh token automatically on every login.
async function getServiceHeaders(req) {

    const email = req.app.locals.erpServiceAccountEmail;
    if (!email) throw new Error('applications.erp erpServiceAccountEmail is not configured in environment.js');

    const refreshToken = serviceAccount.getRefreshToken(email);
    if (!refreshToken) throw new Error('No refresh token on file for ' + email + ' - that account needs to log into the app at least once');

    const response = await axios.post(AUTH_URL,
        new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: req.app.locals.clientId }),
        { headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' } }
    );

    // Refresh tokens rotate on use - the one just spent is now invalid, so the new one must be
    // saved immediately or the next webhook call would fail.
    serviceAccount.saveRefreshToken(email, response.data.refresh_token);

    return {
        'Content-Type' : 'application/json',
        Accept         : 'application/json',
        'X-Tenant'     : req.app.locals.tenant,
        Authorization  : 'Bearer ' + response.data.access_token
    };
}

// rawBody must be the exact bytes Autodesk sent (see app.js's bodyParser verify callback) -
// hashing the re-serialized JSON object would not match. No secret configured = reject, not
// skip: an inbound endpoint that can trigger a real ERP transfer must not be optionally secured.
function verifySignature(secret, rawBody, signatureHeader) {

    if (!secret || !signatureHeader || !rawBody) return false;

    const expected = 'sha1hash=' + crypto.createHmac('sha1', secret).update(rawBody).digest('hex');
    const expectedBuf = Buffer.from(expected);
    const actualBuf    = Buffer.from(signatureHeader);

    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

// Called once at server startup (see app.js) so a changed tunnel URL (Cloudflare Quick Tunnel,
// or any other reverse proxy) doesn't require a manual POST /erp/webhooks/register every time -
// uses the service account's own refresh token (getServiceHeaders) instead of an interactive
// req.session, since there is no logged-in admin at boot. No-ops quietly if the feature isn't
// configured or the service account hasn't logged in yet (same as any other unattended path here).
async function ensureWebhooksRegistered(app) {

    const config = app.locals.applications.erp && app.locals.applications.erp.leanChangeOrderWebhook;
    if (!config || !Array.isArray(config.transitionIds) || config.transitionIds.length === 0 || !config.callbackUrl) return;

    const stored = registrations.get();

    if (stored && stored.callbackUrl === config.callbackUrl && stored.registrations.length === config.transitionIds.length) {
        console.log(' ERP: Lean Change Order webhooks already registered for ' + config.callbackUrl);
        return;
    }

    const headers = await getServiceHeaders({ app: app });
    const fakeReq = { app: app, session: { headers: headers } };

    if (stored && Array.isArray(stored.registrations)) {
        for (const registration of stored.registrations) {
            try { await unregisterWebhook(fakeReq, registration.hookId); } catch (error) { /* best-effort - hook may already be gone */ }
        }
    }

    const results       = await registerTransitionWebhooks(fakeReq, config);
    const successful     = results.filter(function(r) { return r.success; });
    const failed         = results.filter(function(r) { return !r.success; });

    registrations.save(config.callbackUrl, successful.map(function(r) { return { transitionId: r.transitionId, hookId: r.hookId }; }));

    if (failed.length > 0) console.log(' ERP: some Lean Change Order webhook registrations failed - ' + JSON.stringify(failed));
    console.log(' ERP: Lean Change Order webhooks auto-registered for ' + config.callbackUrl + ' (' + successful.length + '/' + config.transitionIds.length + ')');

}

module.exports = { registerTransitionWebhooks, unregisterWebhook, getServiceHeaders, verifySignature, ensureWebhooksRegistered };
