// DevEUI -> asset resolver, backed by the Fusion Manage Sensors workspace. This is the data-driven
// replacement for the static IOT_DEVICE_ASSET_MAP: a device's hardware id (IOT_DEVICE_ID) is looked
// up on the Sensors items, and that sensor's ASSET reference is the asset telemetry routes to. So at
// hardware time you only enter the DevEUI on the PLM sensor — no code/env change per device.
//
// GATED, like the other Autodesk integrations: createFmResolver returns null (disabled) unless the
// flag + 2-legged admin creds + tenant link are configured. An inbound uplink (webhook) has no user
// session, so this uses client-credentials auth — the same pattern the admin utilities in
// routes/plm.js use. No endpoints/secrets are invented; it hits the same /api/v3 REST as the proxy.

const axios = require('axios');

// -> async (deviceId) => assetId | null, or null when not configured.
function createFmResolver(config) {
    const enabled = config.resolveFromFm && config.adminClientId && config.adminClientSecret
                 && config.tenantLink && config.sensorWorkspaceId && config.deviceIdFieldId;
    if (!enabled) return null;

    let token = null, tokenExpMs = 0;
    async function bearer() {
        if (token && Date.now() < tokenExpMs) return token;
        const r = await axios.post(
            'https://developer.api.autodesk.com/authentication/v2/token',
            { grant_type: 'client_credentials', scope: 'data:read' },
            { headers: {
                accept: 'application/json',
                authorization: 'Basic ' + Buffer.from(config.adminClientId + ':' + config.adminClientSecret).toString('base64'),
                'content-type': 'application/x-www-form-urlencoded',
            } });
        token = r.data.access_token;
        tokenExpMs = Date.now() + Math.max(0, (r.data.expires_in || 3600) - 60) * 1000;
        return token;
    }

    // ponytail: linear scan (list items -> read each -> match IOT_DEVICE_ID). Fine for a handful of
    // sensors; if a tenant grows to hundreds, switch to the v3 item search API with a field filter.
    return async function resolve(deviceId) {
        const headers = { Authorization: 'Bearer ' + await bearer(), Accept: 'application/json' };
        const base = config.tenantLink + '/api/v3/workspaces/' + config.sensorWorkspaceId + '/items';
        const list = await axios.get(base, { headers });
        for (const item of (list.data || [])) {
            const dmsId = (item.__self__ || '').split('/').pop();
            if (!dmsId) continue;
            const det = await axios.get(base + '/' + dmsId, { headers });
            const fields = (det.data.sections || []).flatMap(s => s.fields || []);
            const idField = fields.find(f => (f.__self__ || '').endsWith('/' + config.deviceIdFieldId));
            if (idField && idField.value === deviceId) {
                const asset = fields.find(f => (f.__self__ || '').endsWith('/ASSET'));
                const link = asset && asset.value && asset.value.link;
                return link ? link.split('/').pop() : null;   // asset dmsId
            }
        }
        return null;
    };
}

module.exports = { createFmResolver };
