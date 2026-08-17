// Device registry: device -> asset resolution, and per-device duplicate detection.
// Duplicates are identified by (deviceId, timestamp) — a replayed/retried uplink for the same
// instant is dropped so health/condition aren't computed twice on the same sample.
//
// Asset resolution order: static map (IOT_DEVICE_ASSET_MAP) > learned directory > identity.
// The directory is populated on demand by an optional injected async resolver (resolveDeviceAsset),
// which looks a device's hardware id up in Fusion Manage (Sensors workspace). This is what makes
// "enter the DevEUI on the PLM sensor -> telemetry routes to that asset" work for real hardware,
// without the bridge knowing anything Autodesk-specific.

function createRegistry(deviceAssetMap = {}, resolveDeviceAsset = null) {
    const lastTimestamp = new Map();  // deviceId -> last accepted ISO timestamp
    const directory = new Map();      // deviceId -> assetId, learned from resolveDeviceAsset

    return {
        // Ensure the directory knows this device before resolving. No-op if it's statically mapped,
        // already learned, or no resolver is configured. Resolution failures must never break
        // ingestion — on error we simply fall back to identity.
        async ensure(deviceId) {
            if (deviceAssetMap[deviceId] || directory.has(deviceId) || !resolveDeviceAsset) return;
            try {
                const assetId = await resolveDeviceAsset(deviceId);
                if (assetId) directory.set(deviceId, assetId);
            } catch { /* fall back to identity */ }
        },
        resolveAsset(deviceId) {
            return deviceAssetMap[deviceId] || directory.get(deviceId) || deviceId; // static > directory > identity
        },
        isDuplicate(deviceId, timestamp) {
            return lastTimestamp.get(deviceId) === timestamp;
        },
        markSeen(deviceId, timestamp) {
            lastTimestamp.set(deviceId, timestamp);
        },
        known(deviceId) {
            return Object.prototype.hasOwnProperty.call(deviceAssetMap, deviceId) || directory.has(deviceId);
        },
    };
}

module.exports = { createRegistry };
