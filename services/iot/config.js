// IoT feature configuration. Env-overridable (same convention as environment.js), safe defaults.
// Nothing secret here; live-write toggles default OFF so dev never hits real Tandem/Fusion Manage.

function bool(v, def) {
    if (v == null) return def;
    return String(v).toLowerCase() === 'true';
}
function json(v, def) {
    if (!v) return def;
    try { return JSON.parse(v); } catch { return def; }
}

const config = {
    // simulator | tts
    source : (process.env.IOT_SOURCE || 'simulator').toLowerCase(),

    tandemEnabled       : bool(process.env.TANDEM_ENABLED, false),
    tandemIngestionUrl  : process.env.TANDEM_INGESTION_URL || '',   // real Tandem stream URL; empty = stand-in only
    fusionManageWrites  : bool(process.env.FUSION_MANAGE_IOT_WRITES, false),

    // device id -> Fusion Manage asset id. Default: identity for the demo motor.
    deviceAssetMap : json(process.env.IOT_DEVICE_ASSET_MAP, { 'MOTOR-DEMO-001': 'MOTOR-DEMO-001' }),

    // Data-driven DevEUI -> asset resolution from the Sensors workspace (replaces the static map for
    // real devices). GATED: needs the flag + 2-legged admin creds + tenant link, else it stays off
    // and the static map is used. An inbound uplink has no user session, hence client-credentials.
    resolveFromFm     : bool(process.env.IOT_RESOLVE_FROM_FM, false),
    adminClientId     : process.env.ADMIN_CLIENT_ID || '',
    adminClientSecret : process.env.ADMIN_CLIENT_SECRET || '',
    tenantLink        : process.env.IOT_TENANT_LINK || '',                 // https://<tenant>.autodeskplm360.net
    sensorWorkspaceId : process.env.IOT_SENSOR_WS_ID || '968',
    deviceIdFieldId   : process.env.IOT_DEVICE_ID_FIELD || 'IOT_DEVICE_ID',

    // Health/condition thresholds. Vibration is overall velocity magnitude (mm/s), roughly
    // ISO 10816 medium-machine bands; temperature in °C. Tune per asset later — NOT universal truth.
    thresholds : {
        vibration   : { baseline: 1.5, warn: 4.5, critical: 7.1 },
        temperature : { baseline: 40,  warn: 60,  critical: 75  },
    },

    // Health -> condition bands (health score 0-100).
    conditionBands : { normal: 80, observe: 60, warning: 40 }, // >=80 NORMAL, 60-79 OBSERVE, 40-59 WARNING, <40 CRITICAL

    // Simulation cadence. tickMs = wall interval between emitted readings; timeScale compresses
    // simulated time so a long run demos fast (each tick advances timeScale*tickMs of sim time).
    simulation : {
        tickMs    : Number(process.env.IOT_TICK_MS) || 1000,
        timeScale : Number(process.env.IOT_TIME_SCALE) || 60,   // 1 real min ~= 1 sim hour
        deviceId  : process.env.IOT_DEVICE_ID || 'MOTOR-DEMO-001',
        historyLimit : Number(process.env.IOT_HISTORY_LIMIT) || 2000,
    },
};

module.exports = config;
