import re
def sub(p, pairs):
    s = open(p, encoding='utf8').read()
    for a, b in pairs:
        assert a in s, (p, a[:70])
        s = s.replace(a, b, 1)
    open(p, 'w', encoding='utf8').write(s)

# ---------- services/sourcing/ai.js ----------
sub('services/sourcing/ai.js', [
("""const MAX_CANDIDATES = 8;""",
"""// Stage assistant: fixed question ids (no free text). `unavailable` questions have no evidence source in this
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

const MAX_CANDIDATES = 8;"""),
("""const MODES = S.defineModes({""",
"""const STAGE_RULES = [
    '- Answer ONLY the question in questionFocus, for a conference audience: at most 2 short sentences in "answer".',
    '- Refer to suppliers by their displayName only. Never write internal ids such as DEMO-SRC-SUP-001, SUP-001 or DEMO-SRC-ITEM-003; use item titles.',
    '- "evidence": short facts from the context. "sources": the source categories behind them, using exactly: "Fusion Manage", "Prototype / Local", "Similarity Prototype", "Engine". A technicalCheck with source "prototype-local" is "Prototype / Local".',
    '- "openItems": what is missing or unresolved (REVIEW). If the context cannot answer the question, say so in "answer" and list the gap in openItems; never fill it in.',
    '- There is NO inventory/stock, NO where-used and NO revision data in the context; never claim any.',
    '- recommendedSupplierId is the engine recommendation or "none".',
].join('\\n');

const MODES = S.defineModes({
    answer_sourcing_question: {
        system: RULES + '\\n' + STAGE_RULES,
        appendLimits: true, question: 'Answer the question in questionFocus using only this context.',
        text: { answer: 420, recommendedSupplierId: 64 },
        lists: { evidence: 200, sources: 60, openItems: 200 },
    },"""),
# displayName in context
("""            suppliers: cands.map(c => ({ supplierId: c.supplierId, name: c.name, country""", """            suppliers: cands.map(c => ({ supplierId: c.supplierId, displayName: c.displayName || c.name, country"""),
("""            ranking: cands.map(c => ({ rank: c.rank, supplierId: c.supplierId, technicalStatus""", """            ranking: cands.map(c => ({ rank: c.rank, supplierId: c.supplierId, displayName: c.displayName || c.name, technicalStatus"""),
# guard
("""    if (c.technicalStatus === TECH.FAIL) throw new Error('AI_OVERRIDE_BLOCKED reason=technical_fail supplier=' + id);
    return insight;""", """    if (c.technicalStatus === TECH.FAIL) throw new Error('AI_OVERRIDE_BLOCKED reason=technical_fail supplier=' + id);
    // Only the engine recommendation (or "none") may be named; a REVIEW/UNKNOWN or lower-ranked supplier may not.
    if (id !== String(analysis.recommendedSupplierId || '')) throw new Error('AI_OVERRIDE_BLOCKED reason=not_engine_recommendation supplier=' + id);
    return insight;"""),
("""    async function run(mode, analysis) {
        const r = await svc.run(mode, buildSourcingContext(analysis));""", """    async function run(mode, analysis, questionId = null) {
        const ctx = buildSourcingContext(analysis);
        if (questionId) ctx.questionFocus = { id: questionId, text: QUESTIONS[questionId].text };
        const r = await svc.run(mode, ctx);"""),
("""module.exports = { createSourcingAiService, buildSourcingContext, guardInsight, MODES, RULES };""", """module.exports = { createSourcingAiService, buildSourcingContext, guardInsight, MODES, RULES, QUESTIONS };"""),
])

# ---------- services/sourcing/service.js ----------
sub('services/sourcing/service.js', [
("""    async function explain(mode, params) {
        const analysis = await analyze(params);
        if (!aiService) { const e = new Error('AI_DISABLED'); e.status = 503; throw e; }
        const r = await aiService.run(mode, analysis);""", """    async function explain(mode, params) {
        const analysis = await analyze(params);
        if (!aiService) { const e = new Error('AI_DISABLED'); e.status = 503; throw e; }
        const r = await aiService.run(mode, analysis, params.questionId || null);"""),
])

# ---------- routes/sourcing.js ----------
sub('routes/sourcing.js', [
("""const { CONFIRM } = require('../services/sourcing/rfq');""", """const { CONFIRM } = require('../services/sourcing/rfq');
const { QUESTIONS } = require('../services/sourcing/ai');"""),
("""router.post('/ai/explain', aiRoute('explain_sourcing_analysis'));""", """// Visible prose must not carry internal ids: map any known supplier / item id to its display name (presentation only).
function nameIds(text, analysis) {
    let out = String(text);
    for (const c of analysis.candidates || []) {
        const n = c.displayName || c.name, short = String(c.supplierId).replace(/^DEMO-SRC-/, '');
        out = out.split(c.supplierId).join(n).split(short).join(n);
    }
    for (const r of analysis.similarityEvidence || []) if (r.similarItemTitle) out = out.split(r.similarItemId).join(r.similarItemTitle);
    return out;
}

// Stage assistant: body exactly { itemId, quantity?, requiredDate?, questionId } with a FIXED question id (no free text).
router.post('/ai/ask', async function(req, res) {
    if (!onlyKeys(req.body, ['itemId', 'quantity', 'requiredDate', 'questionId'])) return res.status(400).json({ success: false, message: 'Body must be { itemId, quantity?, requiredDate?, questionId }' });
    const q = Object.prototype.hasOwnProperty.call(QUESTIONS, req.body.questionId) ? QUESTIONS[req.body.questionId] : null;
    if (!q) return res.status(400).json({ success: false, message: 'Unknown questionId' });
    const r = parseRequest(req.body);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    // No evidence source exists for these (no Vault / ERP / where-used): fixed honest answer, the model is not called.
    if (q.unavailable) return res.json({ success: true, data: { questionId: req.body.questionId, question: q.text, deterministic: true, cached: false, latencyMs: 0,
        insight: { answer: q.unavailable.answer, evidence: [], sources: q.unavailable.sources, openItems: q.unavailable.openItems, recommendedSupplierId: 'none', confidence: 'high' } } });
    if (!config.ai.enabled) return res.status(503).json({ success: false, message: 'AI explanation is disabled' });
    if (!aiReady()) return res.status(503).json({ success: false, message: 'AI credential is not configured' });
    try {
        const out = await getService().explain('answer_sourcing_question', Object.assign({ questionId: req.body.questionId }, r));
        const i = out.insight, f = t => nameIds(t, out.analysis);
        res.json({ success: true, data: { questionId: req.body.questionId, question: q.text, deterministic: false, cached: out.cached, latencyMs: out.latencyMs, provider: config.ai.provider, model: config.ai.model,
            recommendedSupplierId: out.analysis.recommendedSupplierId,
            recommendedName: (out.analysis.candidates.find(c => c.supplierId === out.analysis.recommendedSupplierId) || {}).displayName || null,
            insight: { answer: f(i.answer), evidence: i.evidence.map(f), sources: i.sources.map(f), openItems: i.openItems.map(f), recommendedSupplierId: i.recommendedSupplierId, confidence: i.confidence } } });
    } catch (e) {
        console.log(' /sourcing/ai/ask failed: ' + (e && e.message));
        if (/^AI_OVERRIDE_BLOCKED/.test(e && e.message)) return res.status(409).json({ success: false, message: 'AI response rejected: it contradicted the deterministic technical result' });
        res.status(502).json({ success: false, message: 'AI explanation could not be generated' });
    }
});
router.get('/ai/questions', function(req, res) { res.json({ success: true, data: Object.keys(QUESTIONS).map(id => ({ id, text: QUESTIONS[id].text, deterministic: !!QUESTIONS[id].unavailable })) }); });

router.post('/ai/explain', aiRoute('explain_sourcing_analysis'));"""),
])
