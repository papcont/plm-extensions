const { test } = require('node:test');
const assert = require('node:assert');
const { createFusionManageReadRepository } = require('../../services/iot/fusionManageReadRepository');

test('trusted FM reader uses read-only token scope and impersonated GET', async () => {
    const calls = [];
    const http = {
        post: async (url, body) => {
            calls.push(['post', url, body]);
            return { data: { access_token: 'test-token', expires_in: 3600 } };
        },
        get: async (url, options) => {
            calls.push(['get', url, options]);
            return { data: { title: 'Asset' } };
        },
    };
    const repo = createFusionManageReadRepository({
        adminClientId: 'client', adminClientSecret: 'secret',
        tenantLink: 'https://tenant.autodeskplm360.net', impersonateUser: 'user@example.com',
    }, http);

    assert.deepStrictEqual(await repo.getItem('904', '30057'), { title: 'Asset' });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[0][2].scope, 'data:read');
    assert.strictEqual(calls[1][1], 'https://tenant.autodeskplm360.net/api/v3/workspaces/904/items/30057');
    assert.strictEqual(calls[1][2].headers.Authorization, 'Bearer test-token');
    assert.strictEqual(calls[1][2].headers['X-user-id'], 'user@example.com');
});
