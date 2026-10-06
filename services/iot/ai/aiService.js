// Read-only AI Insight. Two modes (explain_asset_state, technician_briefing) share one provider
// abstraction: { complete({ system, user, schema }) -> Promise<string JSON> }. No tools, no FM access, no writes.

const crypto = require('crypto');

const DOMAIN = [
    'Domain facts you must respect:',
    '- Vibration from the Dragino LHT65N-VIB is peak ACCELERATION amplitude in g. It is NOT vibration velocity in mm/s; never compare it to ISO 10816/20816 velocity limits.',
    '- There is no FFT/spectrum and no bearing-frequency data, so no bearing, imbalance, misalignment or looseness diagnosis is possible.',
    '- There is no measured RPM or load context.',
    '- Anomaly detection measures deviation from learned normal behavior. An anomaly is not a diagnosis.',
    '',
    'Rules:',
    '- Strictly separate the CURRENT machine state from the HISTORICAL detection recorded in the maintenance case. A current NORMAL state does not invalidate a historical detection or an open case.',
    '- Never invent a failure cause. If maintenanceCase.confirmedCause is set, it is a human finding and outranks any model inference; quote it, do not reinterpret it.',
    '- Do not estimate remaining useful life (RUL) and do not make or imply an autonomous maintenance decision.',
    '- If a value is null (for example anomalyScore), say it is not available; never treat null as zero.',
    '- If the telemetry is old (dataAgeMinutes is large), say the current state may be outdated.',
].join('\n');

const SYSTEM = [
    'You explain the condition of one industrial asset to a maintenance engineer. You only interpret the JSON context you are given.',
    '',
    DOMAIN,
    '- suggestedChecks are suggestions for a human to consider, phrased as such, not conclusions or instructions.',
    '- Be concise and factual. confidence reflects how well the data supports your explanation, not machine health.',
].join('\n');

const BRIEFING_BASE = [
    'You write a short briefing for a maintenance technician about one industrial asset. You only use the JSON context you are given.',
    '',
    DOMAIN,
    '- Keep KNOWN, UNKNOWN and RECOMMENDED CHECK strictly apart: knownFacts only states what the context shows; unknowns states what the context cannot tell (for example cause, load, spectrum, RPM, whether the condition is still present); recommendedChecks are suggestions for a human to consider, phrased as such. A recommended check is not a diagnosis and not an instruction.',
    '- handoverNote is a neutral two-to-three sentence note for the next shift; it must not contain a decision or a diagnosis.',
    '- handoverNote must not contain commands, requests, or instructions. Use neutral advisory wording; prefer phrases such as "Consider...", "Suggested follow-up..." or "Recommended review...". Avoid "Please verify...", "Check...", "Do...", "Replace..." and "Inspect...". recommendedChecks remain suggestions and may start with "Consider...".',
    '- Be concise and factual. confidence reflects how well the data supports the briefing, not machine health.',
].join('\n');

const QUESTION = 'What happened here, and how should the current machine state be interpreted?';
const BRIEFING_QUESTION = 'Write the technician briefing for this asset.';

const TEXT = { type: 'string' };
const CONFIDENCE = ['low', 'medium', 'high'];
const MAX_ITEMS = 6;

// A mode is { text: { field: maxLen }, lists: { field: maxItemLen }, system, question }.
// The schema and the strict validator are both derived from it, so they cannot drift apart.
const MODES = {
    explain_asset_state: {
        system: SYSTEM, question: QUESTION,
        text: { summary: 1200, currentStateExplanation: 1200, historicalContext: 1200, humanAssessmentContext: 1200 },
        lists: { suggestedChecks: 1200, limitations: 1200 },
    },
    technician_briefing: {
        system: null, question: BRIEFING_QUESTION,   // system = BRIEFING_SYSTEM, assigned below from these same limits
        text: { headline: 200, currentSituation: 800, handoverNote: 800 },
        lists: { knownFacts: 800, unknowns: 800, recommendedChecks: 800 },
    },
};

// The prompt states exactly the limits the validator enforces (generated from the same table).
function limitsText(m) {
    const lines = ['', 'Output limits (hard; responses that exceed them are rejected). Return JSON with exactly these fields and no others:'];
    for (const [k, max] of Object.entries(m.text)) lines.push('- ' + k + ': max ' + max + ' characters');
    for (const [k, max] of Object.entries(m.lists)) lines.push('- ' + k + ': max ' + MAX_ITEMS + ' items, each item max ' + max + ' characters');
    lines.push('- confidence: exactly "low", "medium" or "high"');
    lines.push('Keep the response concise. Prefer short factual sentences. Do not repeat the same fact across multiple sections.');
    return lines.join('\n');
}
const BRIEFING_SYSTEM = BRIEFING_BASE + limitsText(MODES.technician_briefing);
MODES.technician_briefing.system = BRIEFING_SYSTEM;

function schemaOf(m) {
    const properties = {};
    for (const k of Object.keys(m.text)) properties[k] = TEXT;
    for (const k of Object.keys(m.lists)) properties[k] = { type: 'array', items: TEXT };
    properties.confidence = { type: 'string', enum: CONFIDENCE };
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
for (const m of Object.values(MODES)) m.schema = schemaOf(m);
const SCHEMA = MODES.explain_asset_state.schema;

// Defense in depth on top of structured outputs: exact shape, bounded sizes. Errors carry a structured
// reason (field, kind, numbers) for the server log, never any model text. Field names from the model are sanitized.
function bad(field, reason, extra) { return new Error('AI_BAD_SHAPE field=' + field + ' reason=' + reason + (extra ? ' ' + extra : '')); }
function validate(raw, mode = 'explain_asset_state') {
    const m = MODES[mode];
    let out;
    try { out = JSON.parse(raw); } catch (e) { throw bad('response', 'invalid_json'); }
    if (!out || typeof out !== 'object' || Array.isArray(out)) throw bad('response', 'not_an_object');
    const keys = Object.keys(m.schema.properties);
    for (const k of Object.keys(out)) if (!keys.includes(k)) throw bad('response', 'unexpected_field', 'name=' + String(k).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40));
    for (const k of keys) if (!(k in out)) throw bad(k, 'missing');
    for (const [k, max] of Object.entries(m.text)) {
        if (typeof out[k] !== 'string') throw bad(k, 'not_a_string');
        if (out[k].length > max) throw bad(k, 'too_long', 'actual=' + out[k].length + ' max=' + max);
    }
    for (const [k, max] of Object.entries(m.lists)) {
        if (!Array.isArray(out[k])) throw bad(k, 'not_an_array');
        if (out[k].length > MAX_ITEMS) throw bad(k, 'too_many_items', 'actual=' + out[k].length + ' max=' + MAX_ITEMS);
        out[k].forEach((x, i) => {
            if (typeof x !== 'string') throw bad(k, 'item_not_a_string', 'index=' + i);
            if (x.length > max) throw bad(k, 'item_too_long', 'index=' + i + ' actual=' + x.length + ' max=' + max);
        });
    }
    if (!CONFIDENCE.includes(out.confidence)) throw bad('confidence', 'invalid_enum');
    return out;
}

// Cache key only: telemetry age in 15-minute buckets (the model still sees the exact age), so a stale
// asset does not miss the cache every minute. Every other context value stays in the key.
const AGE_BUCKET_MIN = 15;
function cacheKey(context) {
    const json = JSON.stringify(context, (k, v) => {
        if (k === 'dataAgeMinutes' && typeof v === 'number') return 'age-bucket-' + Math.floor(v / AGE_BUCKET_MIN);
        if (typeof v === 'string') return v.replace(/Latest telemetry is -?\d+ minutes old\./, 'Latest telemetry age bucketed.');
        return v;
    });
    return crypto.createHash('sha256').update(json).digest('hex');
}

function createAiService({ config, provider }) {
    // ponytail: unbounded per-process cache keyed by mode + context hash; one demo asset, so a handful of entries.
    const cache = new Map();

    async function generate(mode, context) {
        if (!config.enabled) throw new Error('AI_DISABLED');
        const m = MODES[mode];
        if (!m) throw new Error('AI_UNKNOWN_MODE');
        const user = 'Context (JSON):\n' + JSON.stringify(context, null, 2) + '\n\nQuestion: ' + m.question;
        const key = mode + ':' + cacheKey(context);
        if (cache.has(key)) return cache.get(key);
        const out = validate(await provider.complete({ system: m.system, user, schema: m.schema }), mode);
        cache.set(key, out);
        return out;
    }

    return {
        generate,
        explainAssetState: ctx => generate('explain_asset_state', ctx),
        technicianBriefing: ctx => generate('technician_briefing', ctx),
    };
}

module.exports = { createAiService, cacheKey, validate, MODES, SYSTEM, BRIEFING_SYSTEM, SCHEMA };
