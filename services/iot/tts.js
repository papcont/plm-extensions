// The Things Stack uplink envelope adapter. Keeps four layers distinct:
//   LoRaWAN raw payload  ->  TTS envelope  ->  decoded device payload  ->  canonical event.
// This module only handles the envelope layer: it pulls deviceId + fPort + raw bytes (or an
// already-decoded payload) out of a TTS uplink. Device decoding stays in netvoxR718E.js.

// Parse a TTS uplink envelope into a transport-neutral message.
// Returns { deviceId, fPort, fCnt, bytes, decodedPayload, receivedAt }.
function parseUplink(envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('TTS uplink not an object');
    const up = envelope.uplink_message;
    if (!up || typeof up !== 'object') throw new Error('TTS uplink missing uplink_message');
    const ids = envelope.end_device_ids || {};
    const deviceId = ids.device_id || ids.dev_eui;
    if (!deviceId) throw new Error('TTS uplink missing end_device_ids.device_id');

    let bytes;
    if (typeof up.frm_payload === 'string' && up.frm_payload.length > 0) {
        bytes = Array.from(Buffer.from(up.frm_payload, 'base64')); // TTS frm_payload is base64
    }
    return {
        deviceId,
        fPort          : up.f_port,
        fCnt           : up.f_cnt,
        bytes,
        decodedPayload : up.decoded_payload,
        receivedAt     : envelope.received_at,
    };
}

// Build a minimal TTS uplink envelope from a raw frame — for local replay without hardware.
function buildUplink({ deviceId, fPort, bytes, fCnt = 0, receivedAt }) {
    return {
        end_device_ids : { device_id: deviceId },
        received_at    : receivedAt || new Date().toISOString(),
        uplink_message : {
            f_port      : fPort,
            f_cnt       : fCnt,
            frm_payload : Buffer.from(bytes).toString('base64'),
        },
    };
}

module.exports = { parseUplink, buildUplink };
