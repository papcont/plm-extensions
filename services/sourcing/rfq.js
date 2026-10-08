// RFQ draft + operator-gated flow, mirroring the maintenance-case pattern: deterministic analysis ->
// non-mutating preview -> explicit confirmation -> separate write gate -> idempotency key -> ONE write.
// No writer exists yet (no Fusion Manage RFQ target is defined), so the flow is preview/dry-run only:
// with the gate OFF (default) create() performs ZERO mutations and reports WRITE_DISABLED.

const crypto = require('node:crypto');
const { TECH } = require('./model');

const CONFIRM = 'CREATE_RFQ_DRAFT';

const QUESTION = {
    capability: 'Please confirm your capability profile for this part (process, material, tolerance class, max part size, certifications).',
    price: 'Please quote a unit price for the requested quantity (and price breaks if applicable).',
    leadTime: 'Please state your standard lead time for this part at the requested quantity.',
    qualityHistory: 'Please provide your quality record (PPM / rejection rate) for comparable parts.',
    history: null, requiredDate: null,
};

// Pure. Refuses technically failed suppliers: an RFQ to a FAIL supplier would reopen a closed technical question.
function buildRfqDraft(analysis, supplierIds, { now = new Date().toISOString() } = {}) {
    const ids = Array.from(new Set((supplierIds || []).map(String).filter(Boolean)));
    if (!ids.length) return { error: 'NO_SUPPLIERS', status: 400 };
    const suppliers = [];
    for (const id of ids) {
        const c = (analysis.candidates || []).find(x => String(x.supplierId) === id);
        if (!c) return { error: 'UNKNOWN_SUPPLIER', status: 400, supplierId: id };
        if (c.technicalStatus === TECH.FAIL) return { error: 'SUPPLIER_TECHNICALLY_FAILED', status: 409, supplierId: id, reasons: c.technicalReasons };
        suppliers.push({ supplierId: c.supplierId, name: c.name, rank: c.rank, technicalStatus: c.technicalStatus, overallScore: c.overallScore,
            openQuestions: c.missingData.map(f => QUESTION[f]).filter(Boolean) });
    }
    const r = analysis.request;
    const rfqKey = crypto.createHash('sha256').update([r.itemId, r.quantity, r.requiredDate || '', ids.slice().sort().join(',')].join('|')).digest('hex').slice(0, 32);
    return {
        draft: {
            rfqKey, status: 'DRAFT', createdAt: now,
            item: { id: analysis.item.id, title: analysis.item.title, requirements: analysis.item.requirements },
            quantity: r.quantity, requiredDate: r.requiredDate,
            suppliers,
            engine: { engineVersion: analysis.engineVersion, analyzedAt: r.analyzedAt, recommendedSupplierId: analysis.recommendedSupplierId },
            note: 'Draft generated from the deterministic sourcing analysis. Technical PASS/FAIL is not negotiable in the RFQ; prices, lead times and open questions are.',
        },
    };
}

// writer (optional, future FM/ERP target): { project(draft) -> projected mutation, create(draft) -> { ok, ref, error } }
function createRfqFlow({ config, analyze, writer = null, store = new Map(), logger = console }) {
    function gateOn() { return config.rfqWrites === true; }

    async function preview(params) {
        const analysis = await analyze(params);
        const b = buildRfqDraft(analysis, params.supplierIds);
        if (b.error) return b;
        const existing = store.get(b.draft.rfqKey) || null;
        const blockers = [];
        if (!gateOn()) blockers.push('WRITE_DISABLED');
        if (!writer) blockers.push('NO_WRITE_TARGET');
        if (existing) blockers.push('ALREADY_CREATED');
        let projected = null;
        if (writer && typeof writer.project === 'function') { try { projected = writer.project(b.draft); } catch (e) { blockers.push(e.message); } }
        return { draft: b.draft, projected, writeEnabled: gateOn(), blockers, existing, dryRun: true };
    }

    // Mutating ONLY with the exact confirmation, the gate ON, a writer, and no existing RFQ for this key.
    async function create(params) {
        if (params.confirm !== CONFIRM) return { error: 'CONFIRMATION_REQUIRED', status: 400 };
        const analysis = await analyze(params);
        const b = buildRfqDraft(analysis, params.supplierIds);
        if (b.error) return b;
        const existing = store.get(b.draft.rfqKey);
        if (existing) return { outcome: 'existing', rfqKey: b.draft.rfqKey, ref: existing.ref || null };
        if (!gateOn()) return { error: 'WRITE_DISABLED', status: 503, writeEnabled: false };
        if (!writer) return { error: 'NO_WRITE_TARGET', status: 503 };
        const res = await writer.create(b.draft);                        // single attempt, no retry
        if (!res || !res.ok) { logger.log(' Sourcing/RFQ: create failed ' + (res && res.error)); return { error: 'CREATE_FAILED', status: 502, detail: res && res.error }; }
        // ponytail: in-memory idempotency store; make it a durable JSON file (like caseLinkStore) before a writer goes live.
        store.set(b.draft.rfqKey, { ref: res.ref || null, createdAt: new Date().toISOString() });
        return { outcome: 'created', rfqKey: b.draft.rfqKey, ref: res.ref || null };
    }

    return { preview, create, CONFIRM };
}

module.exports = { buildRfqDraft, createRfqFlow, CONFIRM };
