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
    return { getItem };
}

module.exports = { createFusionManageReadRepository };
