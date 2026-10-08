// Sourcing feature configuration. Env-overridable (same convention as services/iot/config.js), safe
// defaults: demo data on, AI off, RFQ writes OFF (there is no live write target yet). Nothing secret here.

function bool(v, def) {
    if (v == null) return def;
    return String(v).toLowerCase() === 'true';
}

const config = {
    enabled   : bool(process.env.SOURCING_ENABLED, true),
    dataSource: process.env.SOURCING_DATA_SOURCE || 'demo',
    fm: { adminClientId: null, adminClientSecret: null, tenantLink: null, impersonateUser: null },
    demoData  : bool(process.env.SOURCING_DEMO_DATA, true),     // local seed (services/sourcing/demoData.js); no FM reads yet
    // Controlled-write gate for RFQ creation. INDEPENDENT from every IoT gate. Default OFF; even ON, a write
    // needs a writer (none exists yet) + explicit operator confirmation + a new idempotency key.
    rfqWrites : bool(process.env.SOURCING_RFQ_WRITES, false),
    // AI explanation (read-only). Own gate and own settings (no fallback to IOT_AI_* so changing one domain never
    // changes the other). The key is ANTHROPIC_API_KEY and never leaves the server.
    ai : {
        enabled  : bool(process.env.SOURCING_AI_ENABLED, false),
        provider : process.env.SOURCING_AI_PROVIDER || 'anthropic',
        model    : process.env.SOURCING_AI_MODEL || 'claude-opus-5-5',
        effort   : process.env.SOURCING_AI_EFFORT || 'medium',
    },
};

// Merge the optional `exports.sourcing` block of environment.js; process.env wins where set.
config.applyDeployment = function(env) {
    const s = (env && env.sourcing) || {};
    if (process.env.SOURCING_ENABLED   == null && s.enabled   !== undefined) config.enabled   = !!s.enabled;
    if (process.env.SOURCING_DATA_SOURCE == null && s.dataSource !== undefined) config.dataSource = String(s.dataSource);
    config.fm = Object.assign({}, config.fm, {
        adminClientId: process.env.ADMIN_CLIENT_ID || (env && env.adminClientId) || null,
        adminClientSecret: process.env.ADMIN_CLIENT_SECRET || (env && env.adminClientSecret) || null,
        tenantLink: (env && (env.tenantLink || (env.tenant && 'https://' + env.tenant + '.autodeskplm360.net'))) || null,
        impersonateUser: (env && env.iot && env.iot.impersonateUser) || null,
    });
    if (process.env.SOURCING_DEMO_DATA == null && s.demoData  !== undefined) config.demoData  = !!s.demoData;
    if (process.env.SOURCING_RFQ_WRITES == null && s.rfqWrites !== undefined) config.rfqWrites = !!s.rfqWrites;
    if (s.ai) {
        config.ai = Object.assign({}, config.ai, s.ai);
        if (process.env.SOURCING_AI_ENABLED != null) config.ai.enabled = bool(process.env.SOURCING_AI_ENABLED, false);
    }
    return config;
};

module.exports = config;
