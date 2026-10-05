// Guards the Fusion Manage write gating so an unconfigured tenant never fires a broken PATCH.
// The live PATCH itself needs real 2-legged creds and is not unit-tested (same stance as the resolver).

const { test } = require('node:test');
const assert = require('node:assert');
const { createFusionManageRepository } = require('../../services/iot/fusionManageRepository');

const summary = { assetId: '30057', condition: 'NORMAL', healthScore: 96, vibration: 1.4, temperature: 41, lastTelemetry: '2026-08-17T10:00:00.000Z' };

test('writes off => dry-run, no network', async () => {
    const repo = createFusionManageRepository({ fusionManageWrites: false });
    const r = await repo.upsertConditionSummary(summary);
    assert.equal(r.mode, 'dry-run');
    assert.equal(r.written, false);
});

test('writes on but mapping/creds missing => blocked-no-mapping, no network', async () => {
    const repo = createFusionManageRepository({ fusionManageWrites: true, adminClientId: '', adminClientSecret: '' });
    const r = await repo.upsertConditionSummary(summary);
    assert.equal(r.mode, 'blocked-no-mapping');
    assert.equal(r.written, false);
});

test('writes on, creds present but no section id => still blocked (never PATCHes without a target section)', async () => {
    const repo = createFusionManageRepository({
        fusionManageWrites: true, adminClientId: 'x', adminClientSecret: 'y',
        tenantLink: 'https://t.autodeskplm360.net', assetWorkspaceId: '904', conditionSectionId: '',
    });
    const r = await repo.upsertConditionSummary(summary);
    assert.equal(r.mode, 'blocked-no-mapping');
});

test('live writes ignore timestamp-only and sub-precision sensor changes', async () => {
    const patches = [];
    const http = {
        post: async () => ({ data: { access_token: 'test-token', expires_in: 3600 } }),
        patch: async (url, body) => { patches.push({ url, body }); },
    };
    const repo = createFusionManageRepository({
        fusionManageWrites: true,
        adminClientId: 'x', adminClientSecret: 'y', impersonateUser: 'user@example.com',
        tenantLink: 'https://t.autodeskplm360.net', assetWorkspaceId: '904', conditionSectionId: '2358',
        floatDecimals: 1,
        floatDecimalsByField: { IOT_VIBRATION: 2, IOT_TEMPERATURE: 1, IOT_HUMIDITY: 1 },
        writeMinIntervalMs: 0,
    }, console, http);

    const liveSummary = { ...summary, vibration: 1.44 };
    const first = await repo.upsertConditionSummary({
        ...liveSummary, temperature: 22.39, humidity: 53.04,
    });
    const unchanged = await repo.upsertConditionSummary({
        ...liveSummary, temperature: 22.41, humidity: 53.03, lastTelemetry: '2026-08-17T10:20:00.000Z',
    });
    const changed = await repo.upsertConditionSummary({
        ...liveSummary, temperature: 22.46, humidity: 53.03, lastTelemetry: '2026-08-17T10:40:00.000Z',
    });

    assert.equal(first.mode, 'live');
    assert.equal(unchanged.mode, 'unchanged');
    assert.equal(changed.mode, 'live');
    assert.equal(patches.length, 2);
    const firstFields = patches[0].body.sections[0].fields;
    assert.equal(firstFields.find(f => f.__self__.endsWith('/IOT_VIBRATION')).value, '1.44');
    assert.equal(firstFields.find(f => f.__self__.endsWith('/IOT_TEMPERATURE')).value, '22.4');
    assert.equal(firstFields.find(f => f.__self__.endsWith('/IOT_HUMIDITY')).value, '53');
});
