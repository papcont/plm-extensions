const axios = require('axios');
const { createBearer } = require('./fmAuth');

function createFusionManageReadRepository(config, http = axios) {
    const bearer = createBearer(config, http, 'data:read');
    function configured() {
        return !!(config.adminClientId && config.adminClientSecret && config.tenantLink && config.impersonateUser);
    }
    async function getItem(workspaceId, dmsId) {
        if (!configured()) throw new Error('FM_READ_NOT_CONFIGURED');
        const headers = {
            Authorization: 'Bearer ' + await bearer(),
            Accept: 'application/json',
            'X-user-id': config.impersonateUser,
        };
        const response = await http.get(
            config.tenantLink + '/api/v3/workspaces/' + encodeURIComponent(workspaceId) + '/items/' + encodeURIComponent(dmsId),
            { headers });
        return response.data;
    }
    // Direct BOM children of an item (one level). FM wraps the page in an array on some tenants.
    async function getBomChildren(workspaceId, dmsId) {
        if (!configured()) throw new Error('FM_READ_NOT_CONFIGURED');
        const response = await http.get(
            config.tenantLink + '/api/v3/workspaces/' + encodeURIComponent(workspaceId) + '/items/' + encodeURIComponent(dmsId) + '/bom-items',
            { headers: { Authorization: 'Bearer ' + await bearer(), Accept: 'application/json', 'X-user-id': config.impersonateUser } });
        const page = Array.isArray(response.data) ? response.data[0] : response.data;
        return ((page && page.items) || []).map(row => row.item).filter(Boolean);
    }
    return { getItem, getBomChildren };
}

module.exports = { createFusionManageReadRepository };
