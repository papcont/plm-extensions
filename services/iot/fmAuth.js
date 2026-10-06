const axios = require('axios');

function createBearer(config, http = axios, scope = 'data:read data:write') {
    let token = null;
    let tokenExpMs = 0;
    return async function bearer() {
        if (token && Date.now() < tokenExpMs) return token;
        const response = await http.post(
            'https://developer.api.autodesk.com/authentication/v2/token',
            { grant_type: 'client_credentials', scope },
            { headers: {
                accept: 'application/json',
                authorization: 'Basic ' + Buffer.from(config.adminClientId + ':' + config.adminClientSecret).toString('base64'),
                'content-type': 'application/x-www-form-urlencoded',
            } });
        token = response.data.access_token;
        tokenExpMs = Date.now() + Math.max(0, (response.data.expires_in || 3600) - 60) * 1000;
        return token;
    };
}

module.exports = { createBearer };
