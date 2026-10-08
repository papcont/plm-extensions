// Domain-neutral structured-AI core shared by every domain (IoT condition monitoring, sourcing, ...).
// A domain supplies a MODE TABLE; this module derives the JSON schema AND the strict validator from the
// same table (so they cannot drift), bounds every field, caches by context hash and reports provenance.
// Provider contract: { complete({ system, user, schema }) -> Promise<string JSON> }. No tools, no writes.

const crypto = require('crypto');

const TEXT = { type: 'string' };
const CONFIDENCE = ['low', 'medium', 'high'];
const MAX_ITEMS = 6;

// A mode is { system, question, text: { field: maxLen }, lists: { field: maxItemLen }, appendLimits? }.
// appendLimits=true appends the generated limits text to `system` (prompt states what the validator enforces).
function limitsText(m) {
    const lines = ['', 'Output limits (hard; responses that exceed them are rejected). Return JSON with exactly these fields and no others:'];
    for (const [k, max] of Object.entries(m.text)) lines.push('- ' + k + ': max ' + max + ' characters');
    for (const [k, max] of Object.entries(m.lists)) lines.push('- ' + k + ': max ' + MAX_ITEMS + ' items, each item max ' + max + ' characters');
    lines.push('- confidence: exactly "low", "medium" or "high"');
    lines.push('Keep the response concise. Prefer short factual sentences. Do not repeat the same fact across multiple sections.');
    return lines.join('\n');
}

function schemaOf(m) {
    const properties = {};
    for (const k of Object.keys(m.text)) properties[k] = TEXT;
    for (const k of Object.keys(m.lists)) properties[k] = { type: 'array', items: TEXT };
    properties.confidence = { type: 'string', enum: CONFIDENCE };
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function defineModes(table) {
    const modes = {};
    for (const [name, spec] of Object.entries(table)) {
        const m = Object.assign({}, spec);
        if (m.appendLimits) m.system = m.system + limitsText(m);
        m.schema = schemaOf(m);
        modes[name] = m;
    }
    return modes;
}

// Defense in depth on top of structured outputs: exact shape, bounded sizes. Errors carry a structured
// reason (field, kind, numbers) for the server log, never any model text. Field names from the model are sanitized.
function bad(field, reason, extra) { return new Error('AI_BAD_SHAPE field=' + field + ' reason=' + reason + (extra ? ' ' + extra : '')); }
function validate(modes, mode, raw) {
    const m = modes[mode];
    if (!m) throw new Error('AI_UNKNOWN_MODE');
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

// sha256 of the context; `replacer` lets a domain bucket volatile values (e.g. an age in minutes) for the key only.
function cacheKey(context, replacer) {
    return crypto.createHash('sha256').update(JSON.stringify(context, replacer)).digest('hex');
}

// { config: { enabled }, provider, modes, cacheKey?, subjectOf? }. subjectOf(context) names the subject the
// last result belongs to (the domain decides: asset id, item id, ...) so lastInsight(mode, subject) can hand it to a
// preview as supporting context. Without it, lastInsight(mode) returns the last result regardless of subject.
function createStructuredAiService({ config, provider, modes, cacheKey: keyOf = cacheKey, subjectOf = () => null }) {
    // ponytail: unbounded per-process cache keyed by mode + context hash; demo-scale subjects, a handful of entries.
    const cache = new Map();
    const last = {};   // last result per mode; previews quote it as supporting context only.

    // One call with its provenance: { insight, cached, latencyMs }. The UI shows live vs cached.
    async function run(mode, context) {
        const r = await runUncached(mode, context);
        const subject = subjectOf(context);
        last[mode] = { insight: r.insight, subjectId: subject, at: new Date().toISOString() };
        return r;
    }
    function lastInsight(mode, subjectId) {
        const l = last[mode];
        return l && (subjectId == null || l.subjectId === String(subjectId)) ? l : null;
    }
    async function runUncached(mode, context) {
        if (!config.enabled) throw new Error('AI_DISABLED');
        const m = modes[mode];
        if (!m) throw new Error('AI_UNKNOWN_MODE');
        const user = 'Context (JSON):\n' + JSON.stringify(context, null, 2) + '\n\nQuestion: ' + m.question;
        const key = mode + ':' + keyOf(context);
        if (cache.has(key)) return { insight: cache.get(key), cached: true, latencyMs: 0 };
        const t0 = Date.now();
        const out = validate(modes, mode, await provider.complete({ system: m.system, user, schema: m.schema }));
        cache.set(key, out);
        return { insight: out, cached: false, latencyMs: Date.now() - t0 };
    }
    const generate = (mode, context) => run(mode, context).then(r => r.insight);
    return { generate, run, lastInsight, modes };
}

module.exports = { createStructuredAiService, defineModes, validate, cacheKey, limitsText, schemaOf, MAX_ITEMS, CONFIDENCE };
