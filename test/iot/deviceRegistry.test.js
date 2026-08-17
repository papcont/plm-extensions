// Data-driven DevEUI -> asset resolution: the registry's static map / learned directory / identity
// order, on-demand learning via an injected resolver (with caching + failure tolerance), and the
// bridge routing a real-device uplink to the resolved asset.
const { test } = require('node:test');
const assert = require('node:assert');

const { createRegistry } = require('../../services/iot/deviceRegistry');
const { createBridge } = require('../../services/iot/bridge');
const canonical = require('../../services/iot/canonical');

const baseCfg = { deviceAssetMap: { 'MOTOR-DEMO-001': 'MOTOR-DEMO-001' }, thresholds: {}, conditionBands: {} };

function mockRepos() {
    return {
        tandem: { push: async () => ({ delivered: 'stored' }), history: () => [] },
        fusionManage: {
            upsertConditionSummary: async () => ({ mode: 'dry-run' }),
            recordConditionEvent: async () => ({ mode: 'dry-run' }),
        },
    };
}

test('resolveAsset order: static map > directory > identity', async () => {
    let calls = 0;
    const reg = createRegistry({ 'MOTOR-DEMO-001': 'ASSET-1' }, async () => { calls++; return 'ASSET-FROM-FM'; });

    // static map wins, resolver not consulted
    await reg.ensure('MOTOR-DEMO-001');
    assert.equal(reg.resolveAsset('MOTOR-DEMO-001'), 'ASSET-1');
    assert.equal(calls, 0);

    // unknown device: learned from the resolver, then cached (resolver called once)
    await reg.ensure('70B3D57ED0056789');
    await reg.ensure('70B3D57ED0056789');
    assert.equal(reg.resolveAsset('70B3D57ED0056789'), 'ASSET-FROM-FM');
    assert.equal(calls, 1);
});

test('identity fallback when there is no resolver or it yields null', async () => {
    const none = createRegistry({});
    await none.ensure('DEV-X');
    assert.equal(none.resolveAsset('DEV-X'), 'DEV-X');           // no resolver -> identity

    const nuller = createRegistry({}, async () => null);
    await nuller.ensure('DEV-Y');
    assert.equal(nuller.resolveAsset('DEV-Y'), 'DEV-Y');         // resolver miss -> identity
});

test('a resolver error never breaks resolution (falls back to identity)', async () => {
    const reg = createRegistry({}, async () => { throw new Error('FM unreachable'); });
    await assert.doesNotReject(reg.ensure('DEV-Z'));
    assert.equal(reg.resolveAsset('DEV-Z'), 'DEV-Z');
});

test('bridge routes a real-device uplink to the FM-resolved asset', async () => {
    const { tandem, fusionManage } = mockRepos();
    const cfg = Object.assign({}, baseCfg, {
        thresholds: { vibration: { baseline: 1.5, warn: 4.5, critical: 7.1 }, temperature: { baseline: 40, warn: 60, critical: 75 } },
        conditionBands: { normal: 80, observe: 60, warning: 40 },
        deviceAssetMap: {},
    });
    const bridge = createBridge({
        config: cfg, tandem, fusionManage,
        resolveDeviceAsset: async (dev) => (dev === '70B3D57ED0056789' ? '30223' : null),
    });

    const event = canonical.createEvent({
        deviceId: '70B3D57ED0056789', deviceType: 'netvox-r718e', source: 'tts',
        timestamp: '2026-08-12T10:00:00.000Z',
        metrics: { velocityX: 1, velocityY: 1, velocityZ: 1, temperature: 35 },
    });
    const res = await bridge.ingest(event);
    assert.equal(res.accepted, true);
    assert.equal(res.assetId, '30223');                          // routed to the PLM asset, not the DevEUI
});
