// P0 AI Insight: one read-only mode (explain_asset_state). Provider-agnostic: a provider is just
// { complete({ system, user, schema }) -> Promise<string JSON> }. No tools, no FM access, no writes.

const crypto = require('crypto');

const SYSTEM = [
    'You explain the condition of one industrial asset to a maintenance engineer. You only interpret the JSON context you are given.',
    '',
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
    '- suggestedChecks are suggestions for a human to consider, phrased as such, not conclusions or instructions.',
    '- If a value is null (for example anomalyScore), say it is not available; never treat null as zero.',
    '- If the telemetry is old (dataAgeMinutes is large), say the current state may be outdated.',
    '- Be concise and factual. confidence reflects how well the data supports your explanation, not machine health.',
].join('\n');

const QUESTION = 'What happened here, and how should the current machine state be interpreted?';

const TEXT = { type: 'string' };
const SCHEMA = {
    type: 'object',
    properties: {
        summary: TEXT,
        currentStateExplanation: TEXT,
        historicalContext: TEXT,
        humanAssessmentContext: TEXT,
        suggestedChecks: { type: 'array', items: TEXT },
        limitations: { type: 'array', items: TEXT },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['summary', 'currentStateExplanation', 'historicalContext', 'humanAssessmentContext',
        'suggestedChecks', 'limitations', 'confidence'],
    additionalProperties: false,
};

const MAX_TEXT = 1200;
const MAX_ITEMS = 6;

// Defense in depth on top of structured outputs: exact shape, bounded sizes.
function validate(raw) {
    let out;
    try { out = JSON.parse(raw); } catch (e) { throw new Error('AI_BAD_SHAPE'); }
    const keys = Object.keys(SCHEMA.properties);
    if (!out || typeof out !== 'object' || Object.keys(out).sort().join() !== keys.slice().sort().join()) throw new Error('AI_BAD_SHAPE');
    for (const k of ['summary', 'currentStateExplanation', 'historicalContext', 'humanAssessmentContext']) {
        if (typeof out[k] !== 'string' || out[k].length > MAX_TEXT) throw new Error('AI_BAD_SHAPE');
    }
    for (const k of ['suggestedChecks', 'limitations']) {
        if (!Array.isArray(out[k]) || out[k].length > MAX_ITEMS || out[k].some(x => typeof x !== 'string' || x.length > MAX_TEXT)) throw new Error('AI_BAD_SHAPE');
    }
    if (!SCHEMA.properties.confidence.enum.includes(out.confidence)) throw new Error('AI_BAD_SHAPE');
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
    // ponytail: unbounded per-process cache keyed by context hash; one demo asset, so a handful of entries.
    const cache = new Map();

    async function explainAssetState(context) {
        if (!config.enabled) throw new Error('AI_DISABLED');
        const user = 'Context (JSON):\n' + JSON.stringify(context, null, 2) + '\n\nQuestion: ' + QUESTION;
        const key = cacheKey(context);
        if (cache.has(key)) return cache.get(key);
        const insight = validate(await provider.complete({ system: SYSTEM, user, schema: SCHEMA }));
        cache.set(key, insight);
        return insight;
    }

    return { explainAssetState };
}

module.exports = { createAiService, cacheKey, validate, SYSTEM, SCHEMA };
