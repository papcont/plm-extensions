// Sourcing AI explanation on the shared structured-AI core. Two modes: explain_sourcing_analysis and
// procurement_briefing. Claude receives ONLY the bounded context built here (verified facts, calculated
// engine results, missing information) and is advisory: the guard rejects any answer that recommends a
// supplier the engine marked technical FAIL (or an unknown supplier). It cannot change the ranking.

const S = require('../ai/structured');
const { TECH } = require('./model');

const RULES = [
    'You explain a deterministic sourcing analysis to a procurement professional. You only interpret the JSON context you are given.',
    '',
    'The context has three parts you must keep apart in your answer:',
    '- verifiedFacts: master data as recorded (item requirements, supplier capability records, purchase history, quotes). Quote them; do not alter them.',
    '- calculatedResults: outputs of the deterministic engine (technical PASS/FAIL/UNKNOWN, scores, ranking, conflicts). They are authoritative.',
    '- missingInformation: data that does not exist. Say it is missing; never fill it in.',
    '',
    'Rules:',
    '- Technical FAIL is final. Never recommend, soften or argue around a technically failed supplier, whatever its price or history.',
    '- Never invent a supplier capability, a purchase, a price, a lead time or technical feasibility. If a value is null it is not available; never treat null as zero.',
    '- A conflict (for example capability record vs purchase history) is surfaced for a human to review; do not resolve it yourself.',
    '- UNKNOWN means missing capability data, not a failure and not a pass.',
    '- A technicalCheck with source "prototype-local" rests on local prototype evidence, not on a Fusion Manage record. When you mention such a check or a PASS that depends on it, say that it is Prototype / Local evidence.',
    '- Scores are relative engine outputs, not predictions. Do not promise savings, delivery dates or quality outcomes.',
    '- recommendedSupplierId must be the engine recommendation (calculatedResults.recommendedSupplierId) or the string "none"; you may explain disagreement in modelInterpretation but not change the recommendation.',
    '- Mark your own reasoning as interpretation (modelInterpretation); keep it separate from facts and calculations.',
    '- Be concise and factual. confidence reflects how well the data supports the explanation, not how good the supplier is.',
].join('\n');

const STAGE_RULES = [
    '- Write every field in German (Deutsch), including answer, evidence and openItems. Keep technical terms and the exact source names as given.',
    '- Answer ONLY the question in questionFocus, for a conference audience: at most 2 short sentences in "answer".',
    '- Refer to suppliers by their displayName only. Never write internal ids such as DEMO-SRC-SUP-001, SUP-001 or DEMO-SRC-ITEM-003; use item titles.',
    '- "evidence": short facts from the context. "sources": the source categories behind them, using exactly: "Fusion Manage", "Prototype / Local", "Similarity Prototype", "Engine". A technicalCheck with source "prototype-local" is "Prototype / Local".',
    '- Keep it stage-ready: at most 3 "evidence" items and at most 2 "openItems", each under 140 characters; do not list every supplier, only what answers the question.',
    '- "openItems": what is missing or unresolved (REVIEW). If the context cannot answer the question, say so in "answer" and list the gap in openItems; never fill it in.',
    '- There is NO inventory/stock, NO where-used and NO revision data in the context; never claim any.',
    '- recommendedSupplierId is the engine recommendation or "none".',
].join('\n');

const MODES = S.defineModes({
    answer_sourcing_question: {
        system: RULES + '\n' + STAGE_RULES,
        appendLimits: true, question: 'Answer the question in questionFocus using only this context.',
        text: { answer: 420, recommendedSupplierId: 64 },
        lists: { evidence: 160, sources: 60, openItems: 160 },
    },
    explain_sourcing_analysis: {
        system: RULES + '\n- whyPassed explains why the top candidates passed and rank where they do; whyFailed explains each FAIL/UNKNOWN supplier by its technicalReasons.',
        appendLimits: true, question: 'Explain this sourcing analysis: why the ranking is what it is, which evidence exists, and what is missing.',
        text: { summary: 1200, rankingRationale: 1200, recommendedSupplierId: 64 },
        lists: { whyPassed: 600, whyFailed: 600, evidenceUsed: 600, missingInformation: 600, modelInterpretation: 600 },
    },
    procurement_briefing: {
        system: RULES + '\n- The briefing is a neutral handover for a buyer: verifiedFacts and calculatedResults restate the context; openQuestions are what an RFQ must clarify; suggestedNextSteps are suggestions phrased as such ("Consider..."), never instructions or decisions.',
        appendLimits: true, question: 'Write the procurement briefing for this sourcing request.',
        text: { headline: 200, situation: 800, rfqNote: 800, recommendedSupplierId: 64 },
        lists: { verifiedFacts: 600, calculatedResults: 600, openQuestions: 600, suggestedNextSteps: 600 },
    },
});

// Stage assistant: fixed question ids (no free text). `unavailable` questions have no evidence source in this
// app (no Vault/ERP/where-used connection), so they get a fixed deterministic answer and never reach the model.
const QUESTIONS = {
    similar:         { text: 'Gibt es ähnliche Teile?' },
    similarSuppliers:{ text: 'Welche Lieferanten haben vergleichbare Teile gefertigt?' },
    revision:        { text: 'Welche Revision?', unavailable: {
        answer: 'Eine belastbare Revision ist hier nicht verfügbar. Die angezeigte Revision stammt aus der Konferenz-Konfiguration, nicht aus Fusion Manage oder Vault.',
        sources: ['Konferenz-Konfiguration'], openItems: ['Revision aus Vault / Fusion Manage ist nicht angebunden', 'Eignung eines ähnlichen Teils für diese Revision ist nicht bewertbar'] } },
    eligible:        { text: 'Ist die Alternative technisch zulässig?' },
    faster:          { text: 'Warum ist sie schneller?' },
    whereUsed:       { text: 'Wo wurde dieses Teil bereits verwendet?', unavailable: {
        answer: 'Eine Verwendungsnachweis (Where-used) ist in dieser Analyse nicht verfügbar. Weder Vault noch Fusion Manage Where-used sind angebunden.',
        sources: [], openItems: ['Where-used aus Vault / Fusion Manage nicht angebunden', 'Bestand (ERP) nicht angebunden'] } },
    why:             { text: 'Warum empfiehlst du diese Option?' },
};

const MAX_CANDIDATES = 8;

// The ONLY data the model sees. Explicit allowlist of engine output; no raw master data beyond what the
// engine already used, no credentials, no free text from users.
function buildSourcingContext(a) {
    const cands = (a.candidates || []).slice(0, MAX_CANDIDATES);
    return {
        verifiedFacts: {
            dataSources: a.dataSources || {},
            item: a.item,
            request: a.request,
            suppliers: cands.map(c => ({ supplierId: c.supplierId, displayName: c.displayName || c.name, country: c.country, status: c.status,
                capabilitySource: c.capabilitySource, capabilityUpdatedAt: c.capabilityUpdatedAt,
                technicalChecks: c.technicalChecks.map(t => ({ check: t.check, required: t.required, actual: t.actual, status: t.status, source: t.source })),
                unitPrice: c.unitPrice, priceSource: c.priceSource, leadTimeDays: c.leadTimeDays, leadTimeSource: c.leadTimeSource,
                purchaseCount: c.purchaseCount, onTimeRate: c.onTimeRate, defectRate: c.defectRate, purchases: c.evidence.purchases })),
            similarityEvidence: (a.similarityEvidence || []).slice(0, 6),
            standardAlternatives: (a.standardAlternatives || []).slice(0, 3),
        },
        calculatedResults: {
            recommendedSupplierId: a.recommendedSupplierId,
            summary: a.summary,
            ranking: cands.map(c => ({ rank: c.rank, supplierId: c.supplierId, displayName: c.displayName || c.name, technicalStatus: c.technicalStatus, technicalReasons: c.technicalReasons.slice(0, 6),
                scores: { commercial: c.commercialScore, history: c.historyScore, delivery: c.deliveryScore, quality: c.qualityScore, overall: c.overallScore },
                dataCompleteness: c.dataCompleteness, confidence: c.confidence, deliveryRisk: c.deliveryRisk, qualityTrend: c.qualityTrend })),
            conflicts: (a.conflicts || []).slice(0, 6),
        },
        missingInformation: (a.missingData || []).slice(0, 24),
        limitations: [
            'Scores are deterministic engine outputs from local master data, quotes and purchase history; they are not forecasts.',
            'No live ERP prices, no supplier risk feeds, no geometry similarity beyond similarityEvidence.',
            'Technical PASS/FAIL comes from recorded capability data; a conflict means the record may be outdated and needs human review.',
        ],
    };
}

// Hard boundary: the model may not name a FAIL (or unknown) supplier as recommendation.
function guardInsight(insight, analysis) {
    const id = String(insight.recommendedSupplierId || '').trim();
    if (!id || id.toLowerCase() === 'none') return insight;
    const c = (analysis.candidates || []).find(x => String(x.supplierId) === id);
    if (!c) throw new Error('AI_OVERRIDE_BLOCKED reason=unknown_supplier');
    if (c.technicalStatus === TECH.FAIL) throw new Error('AI_OVERRIDE_BLOCKED reason=technical_fail supplier=' + id);
    // Only the engine recommendation (or "none") may be named; a REVIEW/UNKNOWN or lower-ranked supplier may not.
    if (id !== String(analysis.recommendedSupplierId || '')) throw new Error('AI_OVERRIDE_BLOCKED reason=not_engine_recommendation supplier=' + id);
    return insight;
}

function createSourcingAiService({ config, provider }) {
    const svc = S.createStructuredAiService({ config, provider, modes: MODES, subjectOf: ctx => (ctx && ctx.verifiedFacts && ctx.verifiedFacts.item && ctx.verifiedFacts.item.id) || null });
    async function run(mode, analysis, questionId = null) {
        const ctx = buildSourcingContext(analysis);
        if (questionId) ctx.questionFocus = { id: questionId, text: QUESTIONS[questionId].text };
        const r = await svc.run(mode, ctx);
        guardInsight(r.insight, analysis);
        return r;
    }
    return { run, explain: a => run('explain_sourcing_analysis', a), briefing: a => run('procurement_briefing', a), lastInsight: svc.lastInsight, MODES };
}

module.exports = { createSourcingAiService, buildSourcingContext, guardInsight, MODES, RULES, QUESTIONS };
