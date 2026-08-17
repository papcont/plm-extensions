// IoT runtime: wires simulator -> device decode path -> bridge -> Tandem + Fusion Manage repos.
// The simulator's readings are encoded as real Netvox frames and put through the SAME decoder the
// hardware will use, so "swap simulator for hardware" changes only the source, nothing downstream.
// Ticking is client-driven (the UI polls /iot/tick) so there are no server-side timers to manage.

const baseConfig = require('./config');
const simulator = require('./simulator');
const netvox = require('./netvoxR718E');
const tts = require('./tts');
const { createBridge } = require('./bridge');
const { createTandemRepository } = require('./tandemRepository');
const { createFusionManageRepository } = require('./fusionManageRepository');
const { createFmResolver } = require('./sensorDirectory');

// Turn a logical simulator reading into a canonical event by going through Netvox encode -> TTS
// envelope -> Netvox decode. Exported so the hardware-swap test can prove parity with real bytes.
function readingToCanonical(reading, { deviceId, timestamp, source }) {
    const frame = netvox.encode(netvox.REPORT.VELOCITY_TEMP, reading);
    const uplink = tts.buildUplink({ deviceId, fPort: frame.fPort, bytes: frame.bytes, receivedAt: timestamp });
    const parsed = tts.parseUplink(uplink);
    const decoded = netvox.decode(parsed.fPort, parsed.bytes);
    return netvox.toCanonical(decoded, { deviceId, timestamp, source: source || 'simulator' });
}

function accelReadingToCanonical(reading, { deviceId, timestamp, source }) {
    const frame = netvox.encode(netvox.REPORT.ACCEL, reading);
    const uplink = tts.buildUplink({ deviceId, fPort: frame.fPort, bytes: frame.bytes, receivedAt: timestamp });
    const parsed = tts.parseUplink(uplink);
    const decoded = netvox.decode(parsed.fPort, parsed.bytes);
    return netvox.toCanonical(decoded, { deviceId, timestamp, source: source || 'simulator' });
}

function createRuntime(overrides = {}) {
    const config = Object.assign({}, baseConfig, overrides);
    const tandem = createTandemRepository(config);
    const fusionManage = createFusionManageRepository(config);
    // DevEUI -> asset resolver: test/override wins; otherwise the gated FM resolver (null unless configured).
    const resolveDeviceAsset = overrides.resolveDeviceAsset || createFmResolver(config);
    const bridge = createBridge({ config, tandem, fusionManage, resolveDeviceAsset });

    const deviceId = config.simulation.deviceId;
    const scenario = simulator.DEFAULT_SCENARIO;
    const total = simulator.totalTicks(scenario);
    const stepMs = config.simulation.tickMs * config.simulation.timeScale;
    const startTime = Date.now();
    let tickIndex = 0;

    // Advance one simulated sample through the full pipeline. Returns the bridge result.
    async function tick() {
        const i = tickIndex % total;                     // loop the scenario for continuous demo
        const reading = simulator.readingAt(scenario, i);
        const timestamp = new Date(startTime + tickIndex * stepMs).toISOString();

        const event = readingToCanonical(reading, { deviceId, timestamp, source: config.source });
        const result = await bridge.ingest(event);

        // Enrich with acceleration detail every 5th tick (offset timestamp so it isn't deduped).
        if (tickIndex % 5 === 0) {
            const accelTs = new Date(startTime + tickIndex * stepMs + 1).toISOString();
            const accelEvent = accelReadingToCanonical(
                { accelerationX: reading.accelerationX, accelerationY: reading.accelerationY,
                  accelerationZ: reading.accelerationZ, battery: 3.6 },
                { deviceId, timestamp: accelTs, source: config.source });
            await bridge.ingest(accelEvent);
        }

        tickIndex++;
        return Object.assign({ tick: tickIndex, simState: reading.state }, result);
    }

    // Real-hardware / TTS ingestion path: a The Things Stack uplink (from SenseCAP M2 -> TTS)
    // decoded by the same Netvox adapter, into the same bridge. This is the endpoint the future
    // webhook will call — it already works today with replayed/fixture uplinks.
    async function ingestUplink(envelope) {
        const parsed = tts.parseUplink(envelope);
        if (!parsed.bytes) throw new Error('uplink missing frm_payload (raw bytes)');
        const decoded = netvox.decode(parsed.fPort, parsed.bytes);
        const event = netvox.toCanonical(decoded, { deviceId: parsed.deviceId, timestamp: parsed.receivedAt, source: 'tts' });
        return bridge.ingest(event);
    }

    return {
        config, deviceId, tick, bridge, ingestUplink,
        getState : () => bridge.getAssetState(bridge.registry.resolveAsset(deviceId)),
        getHistory : rangeMs => tandem.history(bridge.registry.resolveAsset(deviceId), rangeMs),
        reset : () => { tickIndex = 0; },
    };
}

// Lazily-created shared runtime for the HTTP route (single demo asset).
let shared = null;
function getShared() { if (!shared) shared = createRuntime(); return shared; }

// Optional unattended driver. The demo is normally client-driven (the dashboard polls /iot/tick), so
// there are no timers by default. When config.serverTickMs > 0 (set per deployment) this ticks the
// pipeline server-side so the asset's IoT fields keep updating even with no browser open. Gated OFF by
// default; call once at startup. ponytail: single global interval, one asset — fine for the demo.
let tickerStarted = false;
function startServerTicker() {
    const rt = getShared();
    const ms = rt.config.serverTickMs;
    if (!ms || ms <= 0 || tickerStarted) return;
    tickerStarted = true;
    let busy = false;
    setInterval(async function() {
        if (busy) return;                       // skip if the previous tick is still in flight
        busy = true;
        try { await rt.tick(); } catch (e) { console.error('[iot] server tick failed:', e.message); }
        busy = false;
    }, ms);
    console.log('[iot] server ticker started: every ' + ms + 'ms');
}

module.exports = { createRuntime, getShared, startServerTicker, readingToCanonical, accelReadingToCanonical };
