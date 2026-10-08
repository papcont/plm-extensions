// Auth-capable Fusion Manage transport for the Maintenance Case writer's LIVE path. Reuses the shared
// 2-legged bearer (fmAuth) + X-user-id impersonation the summary writer uses. The case writer only
// invokes this when its gate is ON; in dry-run it is never constructed/called.
//
// create(url, body, headers) -> item location (response.headers.location)
// patch(url, body, headers)  -> upstream response
// getState(dmsId)            -> current workflow state name (for transition idempotency; not used in Gate-2)

const axios = require('axios');
const { createBearer } = require('./fmAuth');

function createFmTransport(config, http = axios) {
    const bearer = createBearer(config, http);
    async function auth(headers) {
        return Object.assign({ Authorization: 'Bearer ' + (await bearer()) }, headers || {});
    }
    return {
        async create(url, body, headers) {
            const r = await http.post(url, body, { headers: await auth(headers) });
            return (r.headers && r.headers.location) || null;
        },
        async patch(url, body, headers) {
            return http.patch(url, body, { headers: await auth(headers) });
        },
        async getState(itemUrl, headers) {
            const r = await http.get(config.tenantLink + itemUrl + '/views/1', { headers: await auth(headers) });
            const wf = r.data && (r.data.workflowState || r.data.currentState || (r.data.workflow && r.data.workflow.currentState));
            return wf && (wf.title || wf.name) || null;
        },
    };
}

module.exports = { createFmTransport };
