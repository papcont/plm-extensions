const axios = require('axios');
const { createBearer } = require('./fmAuth');

function createReadRepository(config, http = axios) {
    const bearer = createBearer(config, http, 'data:read');
    function configured() {
        return !!(config && config.adminClientId && config.adminClientSecret && config.tenantLink && config.impersonateUser);
    }
    async function request(method, path, params) {
        if (!configured()) throw new Error('FM_READ_NOT_CONFIGURED');
        const headers = { Authorization: 'Bearer ' + await bearer(), Accept: 'application/json', 'X-user-id': config.impersonateUser };
        const r = await http.request({ method, url: config.tenantLink + path, params, headers });
        return r.data;
    }
    async function getItem(workspaceId, dmsId) {
        return request('get', '/api/v3/workspaces/' + encodeURIComponent(workspaceId) + '/items/' + encodeURIComponent(dmsId));
    }
    async function listItems(workspaceId, { offset = 0, limit = 250 } = {}) {
        const data = await request('get', '/api/v3/workspaces/' + encodeURIComponent(workspaceId) + '/items', { offset, limit });
        return { items: Array.isArray(data.items) ? data.items : [], totalCount: Number(data.totalCount) || 0 };
    }
    async function listAllItems(workspaceId, { pageSize = 250, maxItems = 1000 } = {}) {
        const first = await listItems(workspaceId, { offset: 0, limit: pageSize });
        const out = first.items.slice(0, maxItems);
        for (let offset = out.length; offset < first.totalCount && out.length < maxItems; offset += pageSize) {
            const page = await listItems(workspaceId, { offset, limit: Math.min(pageSize, maxItems - out.length) });
            out.push(...page.items);
            if (!page.items.length) break;
        }
        return out;
    }
    return { configured, getItem, listItems, listAllItems };
}

module.exports = { createReadRepository };
