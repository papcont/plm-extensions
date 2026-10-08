// Read-only AI Insight for condition monitoring. Two modes (explain_asset_state, technician_briefing) on
// top of the shared structured-AI core (services/ai/structured.js): schema + validator derived from one
// mode table, bounded output, context-hash cache. No tools, no FM access, no writes.

const S = require('../../ai/structured');
const { CHAT_RULES } = require('../../ai/chat');

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
    '- Never predict a failure date or time, and never convert g into mm/s.',
    '- Do not claim a causal link between this asset\'s condition and any specific part (for example the U-Halter); the context contains no such evidence.',
].join('\n');

// Output language for the conference UI. Rules above stay authoritative; only the wording changes.
const LANGUAGE = [
    '',
    'Language:',
    '- Write every text field and every list item in German (Deutsch) for a German-speaking maintenance engineer.',
    '- Keep fixed labels and identifiers unchanged: condition values (OFF, NORMAL, OBSERVE, WARNING, CRITICAL), event types (ESCALATION, RECOVERY), baseline states (READY, LEARNING, FROZEN), Fusion Manage, Maintenance Case, Condition Event, field names, IDs, units (g, °C, %) and numbers. Common technical terms (Baseline, Anomaly Score, MAD) may stay as they are.',
    '- State facts and event evidence exactly as the context shows them. Phrase interpretation recognisably as interpretation (for example "deutet darauf hin", "möglicherweise") and keep uncertainty and limitations explicit.',
    '- confidence stays exactly "low", "medium" or "high" (never translated).',
].join('\n');

const SYSTEM = [
    'You explain the condition of one industrial asset to a maintenance engineer. You only interpret the JSON context you are given.',
    '',
    DOMAIN,
    '- suggestedChecks are suggestions for a human to consider, phrased as such, not conclusions or instructions.',
    '- Be concise and factual. confidence reflects how well the data supports your explanation, not machine health.',
    LANGUAGE,
].join('\n');

const BRIEFING_BASE = [
    'You write a short briefing for a maintenance technician about one industrial asset. You only use the JSON context you are given.',
    '',
    DOMAIN,
    '- Keep KNOWN, UNKNOWN and RECOMMENDED CHECK strictly apart: knownFacts only states what the context shows; unknowns states what the context cannot tell (for example cause, load, spectrum, RPM, whether the condition is still present); recommendedChecks are suggestions for a human to consider, phrased as such. A recommended check is not a diagnosis and not an instruction.',
    '- handoverNote is a neutral two-to-three sentence note for the next shift; it must not contain a decision or a diagnosis.',
    '- handoverNote must not contain commands, requests, or instructions. Use neutral advisory wording; prefer phrases such as "Consider...", "Suggested follow-up..." or "Recommended review...". Avoid "Please verify...", "Check...", "Do...", "Replace..." and "Inspect...". recommendedChecks remain suggestions and may start with "Consider...".',
    '- Be concise and factual. confidence reflects how well the data supports the briefing, not machine health.',
    LANGUAGE,
    '- In German, handoverNote and recommendedChecks use the same neutral advisory wording, for example "Zu erwägen: ...", "Empfohlene Prüfung: ..." or "Vorgeschlagene Nachverfolgung: ...". No imperatives or requests such as "Prüfen Sie ...", "Tauschen Sie ... aus" or "Bitte ...".',
].join('\n');

const CHAT_SYSTEM = [
    'You answer questions of a maintenance engineer about one industrial asset. You only interpret the JSON context you are given.',
    '',
    DOMAIN,
    '- "evidence": at most 3 short facts from the context, quoted as the context shows them. "openItems": what the context cannot tell (for example cause, load, spectrum, RPM).',
    '- Suggestions for checks are suggestions to consider, phrased neutrally ("Zu erwägen: ..."), never instructions, diagnoses or decisions.',
    '- confidence reflects how well the data supports your answer, not machine health.',
    LANGUAGE,
    CHAT_RULES,
].join('\n');

const MODES = S.defineModes({
    chat_asset: {
        system: CHAT_SYSTEM, appendLimits: true, question: 'Answer userQuestion using only this context.',
        text: { answer: 600 },
        lists: { evidence: 160, openItems: 160 },
    },
    explain_asset_state: {
        system: SYSTEM, question: 'What happened here, and how should the current machine state be interpreted?',
        text: { summary: 1200, currentStateExplanation: 1200, historicalContext: 1200, humanAssessmentContext: 1200 },
        lists: { suggestedChecks: 1200, limitations: 1200 },
    },
    technician_briefing: {
        system: BRIEFING_BASE, appendLimits: true, question: 'Write the technician briefing for this asset.',
        text: { headline: 200, currentSituation: 800, handoverNote: 800 },
        lists: { knownFacts: 800, unknowns: 800, recommendedChecks: 800 },
    },
});
const BRIEFING_SYSTEM = MODES.technician_briefing.system;
const SCHEMA = MODES.explain_asset_state.schema;

function validate(raw, mode = 'explain_asset_state') { return S.validate(MODES, mode, raw); }

// Cache key only: telemetry age in 15-minute buckets (the model still sees the exact age), so a stale
// asset does not miss the cache every minute. Every other context value stays in the key.
const AGE_BUCKET_MIN = 15;
function cacheKey(context) {
    return S.cacheKey(context, (k, v) => {
        if (k === 'dataAgeMinutes' && typeof v === 'number') return 'age-bucket-' + Math.floor(v / AGE_BUCKET_MIN);
        if (typeof v === 'string') return v.replace(/Latest telemetry is -?\d+ minutes old\./, 'Latest telemetry age bucketed.');
        return v;
    });
}

function createAiService({ config, provider }) {
    const svc = S.createStructuredAiService({ config, provider, modes: MODES, cacheKey, subjectOf: ctx => (ctx && ctx.asset && ctx.asset.id) || null });
    return Object.assign(svc, {
        explainAssetState: ctx => svc.generate('explain_asset_state', ctx),
        technicianBriefing: ctx => svc.generate('technician_briefing', ctx),
    });
}

module.exports = { createAiService, cacheKey, validate, MODES, SYSTEM, BRIEFING_SYSTEM, SCHEMA };
