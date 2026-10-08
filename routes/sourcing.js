// Intelligent Sourcing HTTP surface. The selected data source is demo, FM read-only, or hybrid;
// no PLM/APS session is needed and no secrets are returned.

const express = require('express');
const router = express.Router();
const config = require('../services/sourcing/config');
const { createSourcingService, createDemoSourcingService } = require('../services/sourcing/service');
const { createReadRepository } = require('../services/fusion/readRepository');
const { createFmDataSource } = require('../services/sourcing/fmDataSource');
const { createHybridDataSource } = require('../services/sourcing/dataSource');
const { createSourcingAiService } = require('../services/sourcing/ai');
const anthropic = require('../services/ai/providers/anthropic');
const { CONFIRM } = require('../services/sourcing/rfq');
const { QUESTIONS } = require('../services/sourcing/ai');
const { cleanMessage, cleanHistory, createRateLimiter } = require('../services/ai/chat');
const chatAllowed = createRateLimiter({ max: 20, windowMs: 10 * 60 * 1000 });   // unauthenticated + paid: bound it per client
let service;   // resolved once on first request (like routes/iot.js): any SOURCING_* / environment change needs a server restart

function aiReady() { return config.ai.enabled && config.ai.provider === 'anthropic' && anthropic.hasAnthropicCredential(); }
function getService() {
    if (!service) {
        const aiService = aiReady() ? createSourcingAiService({ config: config.ai, provider: anthropic.createAnthropicProvider(config.ai) }) : null;
        if (config.dataSource === 'demo') service = createDemoSourcingService({ config, aiService });
        else {
            const fm = createFmDataSource({ config: config.fm, readRepository: createReadRepository(config.fm) });
            const source = config.dataSource === 'hybrid' ? createHybridDataSource(fm) : fm;
            service = createSourcingService({ config, source, aiService });
        }
    }
    return service;
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Untrusted input -> exact request shape or a 400 message. Nothing else from the browser reaches the engine.
function parseRequest(src) {
    const itemId = String(src.itemId || '');
    if (!ID_RE.test(itemId)) return { error: 'itemId required' };
    let quantity = null;
    if (src.quantity != null && src.quantity !== '') {
        quantity = Number(src.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000000) return { error: 'quantity must be a positive integer' };
    }
    let requiredDate = null;
    if (src.requiredDate != null && src.requiredDate !== '') {
        if (!DATE_RE.test(String(src.requiredDate)) || Number.isNaN(Date.parse(src.requiredDate))) return { error: 'requiredDate must be YYYY-MM-DD' };
        requiredDate = String(src.requiredDate);
    }
    return { itemId, quantity, requiredDate };
}
function parseSuppliers(v) {
    const ids = (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim()).filter(Boolean);
    return ids.length && ids.length <= 10 && ids.every(id => ID_RE.test(id)) ? ids : null;
}
function onlyKeys(body, allowed) {
    return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => allowed.includes(k));
}
function fail(res, e, fallback) {
    if (e && e.message === 'UNKNOWN_ITEM') return res.status(404).json({ success: false, message: 'Unknown item' });
    console.log(' /sourcing failed: ' + (e && e.message));
    res.status((e && e.status) || 502).json({ success: false, message: fallback });
}

router.use(function(req, res, next) {
    if (!config.enabled) return res.status(404).json({ success: false, message: 'Not found' });
    next();
});

// Non-secret config the UI needs. Never the key, never credentials.
router.get('/config', function(req, res) {
    const s = getService();
    res.json({ success: true, data: { enabled: config.enabled, demoData: config.demoData, rfqWrites: config.rfqWrites,
        aiEnabled: config.ai.enabled, aiCredentialConfigured: anthropic.hasAnthropicCredential(), aiModel: config.ai.model,
        dataSource: config.dataSource,
        similarityProvider: s.similarityProvider, rfqConfirmToken: CONFIRM } });
});

router.get('/items', async function(req, res) {
    try { res.json({ success: true, data: await getService().listItems() }); }
    catch (e) { fail(res, e, 'Items could not be loaded'); }
});

// Deterministic analysis. Same inputs => same output (apart from analyzedAt).
router.get('/analysis', async function(req, res) {
    const r = parseRequest(req.query);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    try { res.json({ success: true, data: await getService().analyze(r) }); }
    catch (e) { fail(res, e, 'Analysis could not be generated'); }
});

// Read-only AI explanation. Body: exactly a request ({ itemId, quantity?, requiredDate? }). The server rebuilds
// the analysis and the bounded context itself; the model never sees browser input.
function aiRoute(mode) {
    return async function(req, res) {
        if (!onlyKeys(req.body, ['itemId', 'quantity', 'requiredDate'])) return res.status(400).json({ success: false, message: 'Body must be { itemId, quantity?, requiredDate? }' });
        const r = parseRequest(req.body);
        if (r.error) return res.status(400).json({ success: false, message: r.error });
        if (!config.ai.enabled) return res.status(503).json({ success: false, message: 'AI explanation is disabled' });
        if (!aiReady()) return res.status(503).json({ success: false, message: 'AI credential is not configured' });
        try {
            const out = await getService().explain(mode, r);
            res.json({ success: true, data: { mode, insight: out.insight, cached: out.cached, latencyMs: out.latencyMs, provider: config.ai.provider, model: config.ai.model,
                recommendedSupplierId: out.analysis.recommendedSupplierId } });
        } catch (e) {
            console.log(' /sourcing/ai (' + mode + ') failed: ' + (e && e.message));   // reason only, never model text
            if (/^AI_OVERRIDE_BLOCKED/.test(e && e.message)) return res.status(409).json({ success: false, message: 'AI response rejected: it contradicted the deterministic technical result' });
            if (e && e.message === 'AI_DISABLED') return res.status(503).json({ success: false, message: 'AI explanation is disabled' });
            res.status(502).json({ success: false, message: 'AI explanation could not be generated' });
        }
    };
}
// Visible prose must not carry internal ids: map any known supplier / item id to its display name (presentation only).
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
// Free-text chat about the selected analysis. Body: { itemId, quantity?, requiredDate?, message, history? }. The server
// rebuilds the analysis and the bounded context itself; message/history are sanitized and reach the model only as
// untrusted DATA. The same guard as every other mode blocks a recommendation of a technically failed supplier.
router.post('/ai/chat', async function(req, res) {
    if (!onlyKeys(req.body, ['itemId', 'quantity', 'requiredDate', 'message', 'history'])) return res.status(400).json({ success: false, message: 'Body must be { itemId, quantity?, requiredDate?, message, history? }' });
    const r = parseRequest(req.body);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    const message = cleanMessage(req.body.message), history = cleanHistory(req.body.history);
    if (message === null) return res.status(400).json({ success: false, message: 'message must be 1-500 characters' });
    if (history === null) return res.status(400).json({ success: false, message: 'history must be [{ role: "user"|"assistant", text }]' });
    if (!config.ai.enabled) return res.status(503).json({ success: false, message: 'AI explanation is disabled' });
    if (!aiReady()) return res.status(503).json({ success: false, message: 'AI credential is not configured' });
    if (!chatAllowed(req.ip)) return res.status(429).json({ success: false, message: 'Too many chat requests, try again later' });
    try {
        const out = await getService().explain('chat_sourcing', Object.assign({ chat: { userQuestion: message, conversation: history } }, r));
        const i = out.insight, f = t => nameIds(t, out.analysis);
        res.json({ success: true, data: { cached: out.cached, latencyMs: out.latencyMs, provider: config.ai.provider, model: config.ai.model,
            recommendedSupplierId: out.analysis.recommendedSupplierId,
            insight: { answer: f(i.answer), evidence: i.evidence.map(f), sources: i.sources.map(f), openItems: i.openItems.map(f), recommendedSupplierId: i.recommendedSupplierId, confidence: i.confidence } } });
    } catch (e) {
        console.log(' /sourcing/ai/chat failed: ' + (e && e.message));
        if (/^AI_OVERRIDE_BLOCKED/.test(e && e.message)) return res.status(409).json({ success: false, message: 'AI response rejected: it contradicted the deterministic technical result' });
        res.status(502).json({ success: false, message: 'AI explanation could not be generated' });
    }
});
router.get('/ai/questions', function(req, res) { res.json({ success: true, data: Object.keys(QUESTIONS).map(id => ({ id, text: QUESTIONS[id].text, deterministic: !!QUESTIONS[id].unavailable })) }); });

router.post('/ai/explain', aiRoute('explain_sourcing_analysis'));
router.post('/ai/briefing', aiRoute('procurement_briefing'));

// Non-mutating RFQ preview (always dry-run in this phase).
router.get('/rfq/preview', async function(req, res) {
    const r = parseRequest(req.query);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    const supplierIds = parseSuppliers(req.query.supplierIds);
    if (!supplierIds) return res.status(400).json({ success: false, message: 'supplierIds required (1-10 ids)' });
    try {
        const p = await getService().rfq.preview(Object.assign({ supplierIds }, r));
        if (p.error) return res.status(p.status || 400).json({ success: false, message: p.error, supplierId: p.supplierId || undefined });
        res.json({ success: true, data: p });
    } catch (e) { fail(res, e, 'Preview could not be generated'); }
});

// The ONLY potentially mutating path: exact body, explicit confirm token, server-side gate (default OFF) and
// a writer (none exists yet) => today this always ends in 503 WRITE_DISABLED with zero side effects.
router.post('/rfq/create', async function(req, res) {
    if (!onlyKeys(req.body, ['itemId', 'quantity', 'requiredDate', 'supplierIds', 'confirm'])) return res.status(400).json({ success: false, message: 'Body must be { itemId, quantity?, requiredDate?, supplierIds, confirm }' });
    const r = parseRequest(req.body);
    if (r.error) return res.status(400).json({ success: false, message: r.error });
    const supplierIds = parseSuppliers(req.body.supplierIds);
    if (!supplierIds) return res.status(400).json({ success: false, message: 'supplierIds required (1-10 ids)' });
    if (req.body.confirm !== CONFIRM) return res.status(400).json({ success: false, message: 'Explicit confirmation required' });
    try {
        const out = await getService().rfq.create(Object.assign({ supplierIds, confirm: req.body.confirm }, r));
        if (out.error) return res.status(out.status || 400).json(Object.assign({ success: false, message: out.error }, out.writeEnabled === false ? { writeEnabled: false } : {}));
        res.json({ success: true, data: out });
    } catch (e) { fail(res, e, 'RFQ could not be created'); }
});

module.exports = router;
