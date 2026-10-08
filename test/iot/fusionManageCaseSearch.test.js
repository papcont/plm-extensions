// Read-only CONDITION_EVENT_ID lookup (FM side of the idempotency check): payload shape, exact post-filter,
// read-only scope, not-configured guard. No network.
const { test } = require('node:test');
const assert = require('node:assert');
const { createFusionManageCaseSearch } = require('../../services/iot/fusionManageCaseSearch');

const CFG = { adminClientId: 'id', adminClientSecret: ['TEST', '_ONLY'].join(''), tenantLink: 'https://t.test', impersonateUser: 'svc@t.test', caseWorkspaceId: '907' };
function row(dmsId, value) { return { dmsId, fields: { entry: [{ key: 'DESCRIPTOR', fieldData: { value: 'x' } }, { key: 'CONDITION_EVENT_ID', fieldData: { value } }] } }; }
function http(rows) {
    const calls = [];
    return { calls, post: async (url, body, opts) => {
        calls.push({ url, body, opts });
        if (url.includes('/authentication/')) return { data: { access_token: 'tok', expires_in: 3600 } };
        return { data: { row: rows } };
    } };
}

test('search: v1 payload shape (type 0, comparator 15, field echoed, sort present), read scope, impersonation', async () => {
    const h = http([row(33979, 'E1')]);
    const matches = await createFusionManageCaseSearch(CFG, h).searchByConditionEventId('E1');
    assert.deepStrictEqual(matches, ['33979']);
    const auth = h.calls[0]; assert.strictEqual(auth.body.scope, 'data:read');
    const s = h.calls[1];
    assert.strictEqual(s.url, 'https://t.test/api/rest/v1/workspaces/907/items/search');
    assert.deepStrictEqual(s.body.filter, [{ fieldID: 'CONDITION_EVENT_ID', fieldTypeID: 0, filterType: { filterID: 15 }, filterValue: 'E1' }]);
    assert.ok(s.body.fields.some(f => f.fieldID === 'CONDITION_EVENT_ID' && f.fieldTypeID === 0));
    assert.strictEqual(s.body.sort.length, 1);
    assert.strictEqual(s.opts.headers['X-user-id'], 'svc@t.test');
    assert.strictEqual(s.opts.headers.Authorization, 'Bearer tok');
});

test('search: exact post-filter drops near-matches, keeps rows that do not echo the field, handles no rows', async () => {
    assert.deepStrictEqual(await createFusionManageCaseSearch(CFG, http([row(1, 'E1'), row(2, 'E10'), row(3, 'E1')])).searchByConditionEventId('E1'), ['1', '3']);
    assert.deepStrictEqual(await createFusionManageCaseSearch(CFG, http([{ dmsId: 9, fields: { entry: [] } }])).searchByConditionEventId('E1'), ['9']);
    assert.deepStrictEqual(await createFusionManageCaseSearch(CFG, http([])).searchByConditionEventId('E1'), []);
    assert.deepStrictEqual(await createFusionManageCaseSearch(CFG, { post: async () => ({ data: {} }) }).searchByConditionEventId('E1'), []);
});

test('search: not configured -> throws before any HTTP', async () => {
    const h = http([]);
    const s = createFusionManageCaseSearch({ tenantLink: 'https://t.test' }, h);
    assert.strictEqual(s.configured(), false);
    await assert.rejects(s.searchByConditionEventId('E1'), /FM_READ_NOT_CONFIGURED/);
    assert.strictEqual(h.calls.length, 0);
});
