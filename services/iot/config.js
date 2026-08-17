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

    // Live asset condition write target (Assets workspace + the "IoT" section on it). Tenant-specific;
    // set per deployment via environment.js `exports.iot`. Section id is the numeric FM section id of the
    // IoT section on the asset item-details layout. The 6 field ids are fixed (IOT_CONDITION, ...).
    assetWorkspaceId   : process.env.IOT_ASSET_WS_ID || '904',
    conditionSectionId : process.env.IOT_CONDITION_SECTION_ID || '',       // e.g. '2358'; empty => writes skipped
    // 2-legged admin apps can only write by IMPERSONATING a user (PLM rejects pure client-credentials
    // writes: "no user in header"). This is the impersonated user's EMAIL (X-user-id header), which must
    // be a valid tenant user with write access. Defaults to the deployment's erpServiceAccountEmail.
    impersonateUser    : process.env.IOT_IMPERSONATE_USER || '',
    writeMinIntervalMs : Number(process.env.IOT_WRITE_MIN_INTERVAL_MS) || 30000,  // FM is not a time-series DB: throttle upserts
    floatDecimals      : (process.env.IOT_FLOAT_DECIMALS != null) ? Number(process.env.IOT_FLOAT_DECIMALS) : 2,  // must match the FM Float field precision

    // Optional unattended driver: tick the simulator server-side every N ms (default off = client-driven only).
    serverTickMs       : Number(process.env.IOT_SERVER_TICK_MS) || 0,

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

// Merge per-deployment settings from environment.js (loaded after this module) into the singleton.
// config.js is required before environment.js in app.js, so process.env wins where set, then the
// environment's optional `exports.iot` block fills the rest. Mutates in place because the runtime is
// created lazily (first request) from this same object. Safe to call once at startup.
config.applyDeployment = function(env) {
    if (!env) return config;
    const iot = env.iot || {};
    // 2-legged admin app: reuse the deployment's admin creds (same app the admin utilities use) unless
    // process.env already provided IoT-specific ones.
    config.adminClientId     = config.adminClientId     || iot.adminClientId     || env.adminClientId     || '';
    config.adminClientSecret = config.adminClientSecret || iot.adminClientSecret || env.adminClientSecret || '';
    config.tenantLink        = config.tenantLink        || iot.tenantLink        || (env.tenant ? 'https://' + env.tenant + '.autodeskplm360.net' : '');
    config.impersonateUser   = config.impersonateUser   || iot.impersonateUser   || env.erpServiceAccountEmail || '';
    // Only let the environment block override where the corresponding process.env var was NOT set.
    if (process.env.FUSION_MANAGE_IOT_WRITES == null && iot.fusionManageWrites  !== undefined) config.fusionManageWrites = !!iot.fusionManageWrites;
    if (process.env.IOT_RESOLVE_FROM_FM      == null && iot.resolveFromFm        !== undefined) config.resolveFromFm      = !!iot.resolveFromFm;
    if (process.env.IOT_CONDITION_SECTION_ID == null && iot.conditionSectionId   !== undefined) config.conditionSectionId = String(iot.conditionSectionId);
    if (process.env.IOT_ASSET_WS_ID          == null && iot.assetWorkspaceId     !== undefined) config.assetWorkspaceId   = String(iot.assetWorkspaceId);
    if (process.env.IOT_SERVER_TICK_MS       == null && iot.serverTickMs         !== undefined) config.serverTickMs       = Number(iot.serverTickMs);
    if (process.env.IOT_WRITE_MIN_INTERVAL_MS== null && iot.writeMinIntervalMs   !== undefined) config.writeMinIntervalMs = Number(iot.writeMinIntervalMs);
    if (process.env.IOT_FLOAT_DECIMALS       == null && iot.floatDecimals        !== undefined) config.floatDecimals      = Number(iot.floatDecimals);
    if (iot.deviceAssetMap) config.deviceAssetMap = Object.assign({}, config.deviceAssetMap, iot.deviceAssetMap);
    return config;
};

module.exports = config;
