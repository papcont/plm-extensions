// Read-only Fusion Manage lookup of Asset Services (907) items by CONDITION_EVENT_ID — the FM side of the
// idempotency check. Uses the proven v1 search endpoint/payload shape from routes/plm.js (/search) with the
// 2-legged read bearer + impersonation. Returns the dmsIds whose CONDITION_EVENT_ID equals the key.

const axios = require('axios');
const { createBearer } = require('./fmAuth');

const FIELD = 'CONDITION_EVENT_ID';

function createFusionManageCaseSearch(config, http = axios) {
    const bearer = createBearer(config, http, 'data:read');
    function configured() {
        return !!(config.adminClientId && config.adminClientSecret && config.tenantLink && config.impersonateUser);
    }
    async function searchByConditionEventId(eventId) {
        if (!configured()) throw new Error('FM_READ_NOT_CONFIGURED');
        const wsId = String(config.caseWorkspaceId || '907');
        // Shape verified read-only against the live tenant (2026-10-07): custom fields use fieldTypeID 0,
        // comparator 15 = text-equals (same as the variants-bom fingerprint search), the custom field must be
        // listed in `fields` to be echoed back, and the v1 search rejects an empty sort list.
        const body = {
            pageNo: 1, pageSize: 100, logicClause: 'AND',
            fields: [{ fieldID: 'DESCRIPTOR', fieldTypeID: 15 }, { fieldID: FIELD, fieldTypeID: 0 }],
            filter: [{ fieldID: FIELD, fieldTypeID: 0, filterType: { filterID: 15 }, filterValue: String(eventId) }],
            sort: [{ fieldID: 'DESCRIPTOR', fieldTypeID: 15, sortAscending: true }],
        };
        const r = await http.post(config.tenantLink + '/api/rest/v1/workspaces/' + encodeURIComponent(wsId) + '/items/search', body, {
            headers: { Authorization: 'Bearer ' + await bearer(), Accept: 'application/json', 'Content-Type': 'application/json', 'X-user-id': config.impersonateUser },
        });
        const rows = (r.data && Array.isArray(r.data.row)) ? r.data.row : [];
        return rows.filter(row => {
            const entry = (row.fields && row.fields.entry) || [];
            const f = entry.find(x => x.key === FIELD);
            return !f || String(f.fieldData && f.fieldData.value) === String(eventId);   // keep the row when the field is not echoed
        }).map(row => String(row.dmsId));
    }
    return { searchByConditionEventId, configured };
}

module.exports = { createFusionManageCaseSearch };
