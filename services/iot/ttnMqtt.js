// TTN MQTT ingestion (pull). A local client connects OUT to The Things Stack's MQTT broker and pumps
// uplink messages into the same ingestUplink path the webhook would use. No public URL / inbound
// exposure — the server reaches out to TTN, not the other way round. Gated OFF by default; enable per
// deployment via environment.js `exports.iot.ttnMqtt`. TTN MQTT messages are the SAME JSON as the
// webhook (end_device_ids + uplink_message), so no special parsing is needed here.

const mqtt = require('mqtt');

// Parse one raw MQTT payload and feed it to ingest(). Exported so it can be unit-tested without a
// live broker. Never throws — a bad message must not kill the subscriber.
async function handleMessage(raw, ingest, logger = console) {
    let evt;
    try { evt = JSON.parse(raw.toString()); }
    catch (e) { logger.error('[iot] TTN MQTT: bad JSON (' + e.message + ')'); return { ok: false, reason: 'json' }; }
    try { const result = await ingest(evt); return { ok: true, result }; }
    catch (e) { logger.error('[iot] TTN MQTT ingest failed: ' + e.message); return { ok: false, reason: 'ingest' }; }
}

// Connect + subscribe. Returns the mqtt client, or null when gated off / misconfigured.
function start(config, ingest, logger = console) {
    const cfg = (config && config.ttnMqtt) || {};
    if (!cfg.enabled) return null;
    if (!cfg.host || !cfg.username || !cfg.apiKey) {
        logger.error('[iot] TTN MQTT enabled but host/username/apiKey missing - skipping');
        return null;
    }
    const url = 'mqtts://' + cfg.host + ':8883';
    const topic = cfg.topic || 'v3/+/devices/+/up';
    const client = mqtt.connect(url, { username: cfg.username, password: cfg.apiKey, reconnectPeriod: 5000 });
    client.on('connect', function () {
        client.subscribe(topic, function (err) {
            if (err) logger.error('[iot] TTN MQTT subscribe failed: ' + err.message);
            else logger.log('[iot] TTN MQTT connected, subscribed ' + topic);
        });
    });
    client.on('message', function (_topic, msg) { handleMessage(msg, ingest, logger); });
    client.on('error', function (e) { logger.error('[iot] TTN MQTT error: ' + e.message); });
    return client;
}

module.exports = { start, handleMessage };
