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
    // simulator | tts | chirpstack  (only gates simulator ticking; /iot/uplink accepts either envelope)
    source : (process.env.IOT_SOURCE || 'simulator').toLowerCase(),

    tandemEnabled       : bool(process.env.TANDEM_ENABLED, false),
    tandemIngestionUrl  : process.env.TANDEM_INGESTION_URL || '',   // real Tandem stream URL; empty = stand-in only
    telemetryPersistenceEnabled: bool(process.env.IOT_TELEMETRY_PERSISTENCE, false),
    telemetryStorePath  : process.env.IOT_TELEMETRY_STORE_PATH || 'storage/iot/telemetry',
    fusionManageWrites  : bool(process.env.FUSION_MANAGE_IOT_WRITES, false),

    // Durable condition-event store (services/iot/eventRepository.js). Low-frequency discrete events
    // (escalation/recovery) persisted to NDJSON so they survive a restart. Gated OFF by default like the
    // telemetry store; enable per deployment to keep events across restarts. FM is NOT touched by this.
    eventPersistenceEnabled: bool(process.env.IOT_EVENT_PERSISTENCE, false),
    eventStorePath      : process.env.IOT_EVENT_STORE_PATH || 'storage/iot/events',
    eventHistoryLimit   : Number(process.env.IOT_EVENT_HISTORY_LIMIT) || 500,

    // Operator re-baseline (explicit; never automatic). The control route is separately gated, default OFF.
    baselineStorePath   : process.env.IOT_BASELINE_STORE_PATH || '',   // '' => baseline-epochs.json next to the telemetry store
    rebaselineEnabled   : bool(process.env.IOT_REBASELINE_ENABLED, false),

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
    floatDecimalsByField: json(process.env.IOT_FLOAT_DECIMALS_BY_FIELD, {}),

    // Optional unattended driver: tick the simulator server-side every N ms (default off = client-driven only).
    serverTickMs       : Number(process.env.IOT_SERVER_TICK_MS) || 0,

    // TTN MQTT ingestion (pull): a local client subscribes to The Things Stack's broker and feeds
    // uplinks into the bridge. No public URL needed. GATED OFF; enable per deployment via environment.js
    // `exports.iot.ttnMqtt = { enabled:true, username:'<app-id>@ttn', apiKey:'<ttn-app-api-key>' }`.
    ttnMqtt : {
        enabled  : bool(process.env.IOT_TTN_MQTT_ENABLED, false),
        host     : process.env.IOT_TTN_MQTT_HOST || 'eu1.cloud.thethings.network',
        username : process.env.IOT_TTN_MQTT_USERNAME || '',   // e.g. contelos-iot@ttn
        apiKey   : process.env.IOT_TTN_MQTT_API_KEY || '',    // TTN application API key with uplink read
        topic    : process.env.IOT_TTN_MQTT_TOPIC || 'v3/+/devices/+/up',
    },

    // Health/condition thresholds. Vibration is the amplitude from canonical.vibrationMagnitude — its
    // UNIT depends on the device: velocity mm/s (Netvox R718E, defaults below, ~ISO 10816 medium-machine)
    // or peak acceleration g (Dragino LHT65N-VIB). A Dragino deployment MUST override vibration with
    // g-scale bands via environment.js `exports.iot.thresholds`, e.g.
    //   thresholds: { vibration: { baseline: 0.5, warn: 2, critical: 4 } }
    // Temperature in °C. Tune per asset later — NOT universal truth.
    // ponytail: one global vibration band per deployment; a deployment mixing mm/s + g sensors on
    // different assets would need per-device thresholds — not built until a deployment actually mixes them.
    thresholds : {
        vibration   : { baseline: 1.5, warn: 4.5, critical: 7.1 },
        temperature : { baseline: 40,  warn: 60,  critical: 75  },
    },

    // Health -> condition bands (health score 0-100).
    conditionBands : { normal: 80, observe: 60, warning: 40 }, // >=80 NORMAL, 60-79 OBSERVE, 40-59 WARNING, <40 CRITICAL

    // Learned-baseline analytics (services/iot/analytics.js). Per-asset: learns each asset's own normal
    // vibration/temperature band and scores how far the current reading deviates (robust median/MAD).
    // Units-agnostic (works on the canonical amplitude, mm/s or g). All knobs documented in analytics.js
    // DEFAULTS; override per deployment via environment.js `exports.iot.analytics`.
    analytics : {
        enabled           : bool(process.env.IOT_ANALYTICS_ENABLED, true),
        minimumSamples    : Number(process.env.IOT_ANALYTICS_MIN_SAMPLES) || 20,
        historyWindow     : Number(process.env.IOT_ANALYTICS_HISTORY_WINDOW) || 200,
        bandFactor        : 3,
        zLow              : 2,
        zHigh             : 8,
        epsilonVibration  : 0.01,
        epsilonTemperature: 0.5,
        learningThreshold : 0.35,
        observeThreshold  : 0.40,
        warningThreshold  : 0.60,
        criticalThreshold : 0.85,
        escalationSamples : Number(process.env.IOT_ANALYTICS_ESCALATION_SAMPLES) || 3,
        recoverySamples   : Number(process.env.IOT_ANALYTICS_RECOVERY_SAMPLES) || 3,
        trendWindow       : 12,
        trendDelta        : 0.08,
        weights           : { vibration: 1, temperature: 0.6 },
    },

    // AI Insight (read-only explanation). OFF by default; the key never leaves the server.
    ai : {
        enabled  : bool(process.env.IOT_AI_ENABLED, false),
        provider : process.env.IOT_AI_PROVIDER || 'anthropic',
        model    : process.env.IOT_AI_MODEL || 'claude-opus-5-5',
        effort   : process.env.IOT_AI_EFFORT || 'medium',
        apiKey   : process.env.IOT_AI_API_KEY || '',
    },

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
    if (process.env.IOT_TELEMETRY_PERSISTENCE == null && iot.telemetryPersistenceEnabled !== undefined) config.telemetryPersistenceEnabled = !!iot.telemetryPersistenceEnabled;
    if (process.env.IOT_TELEMETRY_STORE_PATH == null && iot.telemetryStorePath) config.telemetryStorePath = String(iot.telemetryStorePath);
    if (process.env.IOT_EVENT_PERSISTENCE    == null && iot.eventPersistenceEnabled !== undefined) config.eventPersistenceEnabled = !!iot.eventPersistenceEnabled;
    if (process.env.IOT_EVENT_STORE_PATH     == null && iot.eventStorePath) config.eventStorePath = String(iot.eventStorePath);
    if (process.env.IOT_EVENT_HISTORY_LIMIT  == null && iot.eventHistoryLimit !== undefined) config.eventHistoryLimit = Number(iot.eventHistoryLimit);
    if (process.env.IOT_WRITE_MIN_INTERVAL_MS== null && iot.writeMinIntervalMs   !== undefined) config.writeMinIntervalMs = Number(iot.writeMinIntervalMs);
    if (process.env.IOT_FLOAT_DECIMALS       == null && iot.floatDecimals        !== undefined) config.floatDecimals      = Number(iot.floatDecimals);
    if (process.env.IOT_FLOAT_DECIMALS_BY_FIELD == null && iot.floatDecimalsByField) {
        config.floatDecimalsByField = Object.assign({}, config.floatDecimalsByField, iot.floatDecimalsByField);
    }
    if (iot.deviceAssetMap) config.deviceAssetMap = Object.assign({}, config.deviceAssetMap, iot.deviceAssetMap);
    // g-scale vibration bands for a Dragino deployment, etc. Shallow per-metric merge so overriding
    // vibration alone keeps the default temperature band.
    if (iot.thresholds) config.thresholds = Object.assign({}, config.thresholds, iot.thresholds);
    if (iot.analytics) config.analytics = Object.assign({}, config.analytics, iot.analytics);
    if (iot.ai) {
        config.ai = Object.assign({}, config.ai, iot.ai);
        if (process.env.IOT_AI_ENABLED != null) config.ai.enabled = bool(process.env.IOT_AI_ENABLED, false);
    }
    if (iot.ttnMqtt) {
        config.ttnMqtt = Object.assign({}, config.ttnMqtt, iot.ttnMqtt);
        if (process.env.IOT_TTN_MQTT_ENABLED != null) config.ttnMqtt.enabled = bool(process.env.IOT_TTN_MQTT_ENABLED, false);
    }
    return config;
};

module.exports = config;
