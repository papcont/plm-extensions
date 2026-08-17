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
