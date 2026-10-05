// ChirpStack v4 uplink-event envelope adapter. The SenseCAP M2 gateway runs ChirpStack internally;
// its HTTP integration POSTs a decoded uplink event to /iot/uplink. Layers kept distinct:
//   LoRaWAN raw payload  ->  ChirpStack event  ->  decoded device object  ->  canonical event.
// This module only handles the envelope: it pulls devEui + fPort + raw bytes + the already-decoded
// `object` out of the event. ChirpStack decodes with the device profile's JS codec (the official
// Dragino LHT65N-VIB codec), so `object` is populated here — device mapping stays in draginoLHT65VIB.js.

// Parse a ChirpStack v4 HTTP-integration uplink event into a transport-neutral message.
// Returns { deviceId, fPort, fCnt, bytes, object, receivedAt }. DevEUI is upper-cased to match the
// Fusion Manage IOT_DEVICE_ID convention (device→asset resolution is case-sensitive downstream).
function parseUplink(event) {
    if (!event || typeof event !== 'object') throw new Error('ChirpStack event not an object');
    const info = event.deviceInfo;
    if (!info || typeof info !== 'object') throw new Error('ChirpStack event missing deviceInfo');
    const devEui = info.devEui || info.devEUI;
    if (!devEui) throw new Error('ChirpStack event missing deviceInfo.devEui');

    let bytes;
    if (typeof event.data === 'string' && event.data.length > 0) {
        bytes = Array.from(Buffer.from(event.data, 'base64')); // ChirpStack `data` is base64 raw frm_payload
    }
    return {
        deviceId   : String(devEui).toUpperCase(),
        fPort      : event.fPort,
        fCnt       : event.fCnt,
        bytes,
        object     : event.object || null,   // decoded by the device-profile codec in ChirpStack
        receivedAt : event.time,
    };
}

// Build a minimal ChirpStack uplink event from a decoded object — for local replay without hardware.
function buildUplink({ deviceId, fPort, object, bytes, fCnt = 0, time }) {
    const event = {
        deviceInfo : { devEui: String(deviceId) },
        fPort, fCnt,
        object     : object || {},
        time       : time || new Date().toISOString(),
    };
    if (bytes) event.data = Buffer.from(bytes).toString('base64');
    return event;
}

module.exports = { parseUplink, buildUplink };
