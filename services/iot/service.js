// IoT runtime: wires simulator -> device decode path -> bridge -> Tandem + Fusion Manage repos.
// The simulator's readings are encoded as real Netvox frames and put through the SAME decoder the
// hardware will use, so "swap simulator for hardware" changes only the source, nothing downstream.
// Ticking is client-driven (the UI polls /iot/tick) so there are no server-side timers to manage.

const baseConfig = require('./config');
const simulator = require('./simulator');
const netvox = require('./netvoxR718E');
const tts = require('./tts');
const chirpstack = require('./chirpstack');
const dragino = require('./draginoLHT65VIB');
const canonical = require('./canonical');
const condition = require('./condition');
const { createBridge } = require('./bridge');
const { createTandemRepository } = require('./tandemRepository');
const { createFusionManageRepository } = require('./fusionManageRepository');
const { createEventRepository } = require('./eventRepository');
const { createBaselineStore } = require('./baselineStore');
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
    const events = overrides.events || createEventRepository(config);   // durable condition-event store
    const baselines = overrides.baselines || createBaselineStore(config);   // per-asset re-baseline epoch (explicit, operator-set)
    // DevEUI -> asset resolver: test/override wins; otherwise the gated FM resolver (null unless configured).
    const resolveDeviceAsset = overrides.resolveDeviceAsset || createFmResolver(config);
    const bridge = createBridge({ config, tandem, fusionManage, events, baselines, resolveDeviceAsset });

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

    // Real-hardware ingestion path. Two envelope shapes are auto-detected on the same /iot/uplink door:
    //   - ChirpStack v4 event (SenseCAP M2's internal ChirpStack HTTP integration): has `deviceInfo`.
    //     ChirpStack already decoded via the Dragino codec, so we map its `object` -> canonical.
    //   - The Things Stack uplink (has `uplink_message`): raw Netvox bytes decoded by the Netvox adapter.
    // Both feed the same bridge — nothing downstream knows which transport delivered the reading.
    async function ingestUplink(envelope) {
        if (envelope && envelope.deviceInfo) {
            const parsed = chirpstack.parseUplink(envelope);
            const event = dragino.objectToCanonical(parsed.object, {
                deviceId: parsed.deviceId, timestamp: parsed.receivedAt, source: 'chirpstack', fPort: parsed.fPort,
            });
            return bridge.ingest(event);
        }
        const parsed = tts.parseUplink(envelope);
        // Dragino over TTS. Two sub-cases:
        //   a) a payload formatter is set in TTS -> decoded object present -> map it.
        //   b) no formatter -> only raw bytes; decode them ourselves on the Dragino data ports.
        // fPort discriminates from Netvox (which is fPort 6): Dragino data is on 2/9/10.
        if (dragino.isDraginoObject(parsed.decodedPayload)) {
            const event = dragino.objectToCanonical(parsed.decodedPayload, {
                deviceId: parsed.deviceId, timestamp: parsed.receivedAt, source: 'tts', fPort: parsed.fPort,
            });
            return bridge.ingest(event);
        }
        if (parsed.bytes && dragino.DATA_PORTS.includes(parsed.fPort)) {
            const decoded = dragino.decode(parsed.fPort, parsed.bytes);
            if (decoded) {
                const event = dragino.objectToCanonical(decoded, {
                    deviceId: parsed.deviceId, timestamp: parsed.receivedAt, source: 'tts', fPort: parsed.fPort,
                });
                return bridge.ingest(event);
            }
            return { accepted: false, stage: 'decode', reason: 'unsupported Dragino frame' };
        }
        if (!parsed.bytes) throw new Error('uplink missing frm_payload (raw bytes)');
        const decoded = netvox.decode(parsed.fPort, parsed.bytes);
        const event = netvox.toCanonical(decoded, { deviceId: parsed.deviceId, timestamp: parsed.receivedAt, source: 'tts' });
        return bridge.ingest(event);
    }

    function getState(assetId) {
        const resolvedAsset = assetId || bridge.registry.resolveAsset(deviceId);
        const current = bridge.getAssetState(resolvedAsset);
        if (current) return current;
        const latest = tandem.latest(resolvedAsset);
        if (!latest) return null;
        const points = tandem.history(resolvedAsset, 0);
        const events = points.map(p => p.conditionEvent).filter(Boolean).slice(-50);
        const metrics = latest.metrics || {};
        const vibration = (latest.vibration == null) ? canonical.vibrationMagnitude(metrics) : latest.vibration;
        const evaluated = latest.condition || condition.evaluate(
            latest.healthScore, metrics, config.thresholds, config.conditionBands).condition;
        return {
            summary: {
                assetId: String(resolvedAsset),
                deviceId: latest.deviceId,
                condition: evaluated,
                healthScore: latest.healthScore,
                vibration,
                temperature: metrics.temperature,
                humidity: metrics.humidity,
                lastTelemetry: latest.t,
                lastEvent: events.length ? events[events.length - 1].timestamp : null,
                tandemRef: String(resolvedAsset),
            },
            condition: evaluated,
            health: { score: latest.healthScore, vibration, temperature: metrics.temperature },
            analytics: null,
            events,
        };
    }

    // Operational event feed for the API: resolves the asset, normalizes the limit (default 50, invalid
    // -> default, capped to eventHistoryLimit), returns events NEWEST-FIRST and echoes the resolved asset.
    function getEventsFeed(assetId, limit) {
        const resolved = String(assetId || bridge.registry.resolveAsset(deviceId));
        const max = Number(config.eventHistoryLimit) || 500;
        let n = Number(limit);
        if (!Number.isFinite(n) || n <= 0) n = 50;     // default + invalid
        if (n > max) n = max;                          // cap excessive
        const chronological = events.list(resolved, n); // most-recent n, oldest-first
        return { assetId: resolved, events: chronological.slice().reverse() }; // newest-first for the feed
    }

    return {
        config, deviceId, tick, bridge, ingestUplink,
        getState,
        getHistory : (rangeMs, assetId) => tandem.history(assetId || bridge.registry.resolveAsset(deviceId), rangeMs),
        getEvents : (assetId, limit) => events.list(assetId || bridge.registry.resolveAsset(deviceId), limit),
        getEventsFeed,
        rebaseline : (assetId, opts) => bridge.rebaseline(assetId, opts),
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
let tickerHandle = null;
function isServerTickerRunning() { return tickerHandle !== null; }
function startServerTicker() {
    const rt = getShared();
    const ms = rt.config.serverTickMs;
    if (!ms || ms <= 0 || tickerHandle) return;
    let busy = false;
    tickerHandle = setInterval(async function() {
        if (busy) return;                       // skip if the previous tick is still in flight
        busy = true;
        try { await rt.tick(); } catch (e) { console.error('[iot] server tick failed:', e.message); }
        busy = false;
    }, ms);
    console.log('[iot] server ticker started: every ' + ms + 'ms');
}
function stopServerTicker() {
    if (!tickerHandle) return;
    clearInterval(tickerHandle);
    tickerHandle = null;
    console.log('[iot] server ticker stopped');
}

module.exports = { createRuntime, getShared, startServerTicker, stopServerTicker, isServerTickerRunning, readingToCanonical, accelReadingToCanonical };
