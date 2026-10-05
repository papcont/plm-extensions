const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTandemRepository } = require('../../services/iot/tandemRepository');

test('telemetry history survives a repository restart and remains asset-scoped', async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iot-telemetry-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const config = {
        telemetryPersistenceEnabled: true,
        telemetryStorePath: root,
        tandemEnabled: false,
        simulation: { historyLimit: 20 },
    };
    const timestamp = new Date(Date.now() - 60000).toISOString();

    const firstRuntime = createTandemRepository(config);
    await firstRuntime.push('30057', timestamp, { temperature: 22.4, humidity: 53 }, 100, {
        deviceId: 'lht65n-vib-01', deviceType: 'dragino-lht65n-vib', source: 'tts', fPort: 7,
        vibrationModel: 'dynamic-magnitude-minus-1g', activityInference: 'unsupported',
        observedMetrics: ['vibrationG'],
        condition: 'OFF', vibration: 0,
    });
    await firstRuntime.push('other-asset', timestamp, { temperature: 99 }, 10, {
        deviceId: 'other-device', condition: 'CRITICAL', vibration: 4,
    });

    const restartedRuntime = createTandemRepository(config);
    const history = restartedRuntime.history('30057', 24 * 60 * 60 * 1000);
    assert.equal(history.length, 1);
    assert.equal(history[0].metrics.temperature, 22.4);
    assert.equal(history[0].metrics.humidity, 53);
    assert.equal(history[0].deviceId, 'lht65n-vib-01');
    assert.equal(history[0].fPort, 7);
    assert.equal(history[0].vibrationModel, 'dynamic-magnitude-minus-1g');
    assert.equal(history[0].activityInference, 'unsupported');
    assert.deepEqual(history[0].observedMetrics, ['vibrationG']);
    assert.equal(restartedRuntime.latest('30057').condition, 'OFF');
});
