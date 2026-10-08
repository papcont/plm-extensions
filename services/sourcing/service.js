// Sourcing composition root: source -> normalized domain objects -> deterministic engine.

const engine = require('./engine');
const { createSimilarityAdapter, createHistoryFamilyProvider } = require('./similarity');
const { createRfqFlow } = require('./rfq');
const { createStaticDataSource } = require('./dataSource');

// Presentation-only provenance. Reads what the engine already computed; never changes status, score or rank.
function decorate(a, item, d, capabilities, mode) {
    const capBy = new Map(capabilities.map(c => [String(c.supplierId), c]));
    const titles = new Map((d.items || []).map(i => [String(i.id), i.title]));
    a.dataMode = mode;
    a.item.thicknessMm = item.thicknessMm == null ? null : item.thicknessMm;
    a.item.source = item.source || mode;
    a.item.tolerance = item.manufacturingTolerance || null;
    for (const c of a.candidates) {
        const cap = capBy.get(String(c.supplierId)) || null, proto = (cap && cap.prototypeEvidence) || {};
        c.displayName = String(c.name || '').replace(/^DEMO-SRC-SUP-\d+\s+/, '');
        c.capabilityFacts = cap ? { maxThicknessMm: cap.maxThicknessMm == null ? null : cap.maxThicknessMm, maxDimensionMm: cap.maxDimensionMm == null ? null : cap.maxDimensionMm, tolerance: cap.tolerance || null,
            processes: cap.processes || [], materials: cap.materials || [], leadTimeDays: cap.leadTimeDays == null ? null : cap.leadTimeDays } : null;
        c.prototypeEvidence = Object.keys(proto).map(k => ({ field: k, value: proto[k].value, source: proto[k].source, note: proto[k].note }));
        c.technicalChecks.forEach(t => { t.source = t.check === 'capacity' && proto.capacityPerMonth ? 'prototype-local' : (cap && cap.source) || mode; });
    }
    a.similarityEvidence.forEach(r => { r.similarItemTitle = titles.get(String(r.similarItemId)) || null; });
    // Fusion Manage record references so the UI can open the source record. Only for records actually read
    // from FM (fm.record); demo/prototype data gets no link, which keeps the provenance visible.
    const refs = (rows, key) => Object.fromEntries((rows || []).filter(x => x && x.fm && x.fm.record).map(x => [String(x[key]), x.fm.record]));
    a.fmLinks = { items: refs(d.items, 'id'), suppliers: refs(d.suppliers, 'id'), capabilities: refs(capabilities, 'supplierId'), purchases: refs(d.history, 'id') };
}

function createSourcingService({ config, data, source = null, similarity = undefined, aiService = null, writer = null, now = () => new Date().toISOString() }) {
    const dataSource = source || createStaticDataSource(data || {});
    let loadedPromise = null;
    async function loaded() { if (!loadedPromise) loadedPromise = dataSource.load(); return loadedPromise; }
    async function listItems() {
        const d = await loaded();
        return (d.items || []).filter(i => !i.standardProfileOf).map(i => ({ id: i.id, title: i.title, family: i.family || null, requirements: i.requirements || {}, source: i.source || dataSource.name }));
    }
    async function analyze({ itemId, quantity = null, requiredDate = null }) {
        const d = await loaded();
        const item = (d.items || []).find(i => String(i.id) === String(itemId)) || null;
        if (!item) { const e = new Error('UNKNOWN_ITEM'); e.status = 404; throw e; }
        const similar = similarity ? await similarity.findSimilar(item) : similarity === null ? { status: 'none', provider: null, rows: [] } : await dataSource.similarity(item, d);
        const capabilities = typeof d.capabilitiesFor === 'function' ? d.capabilitiesFor(item) : (d.capabilities || []);
        const a = engine.analyze({ item, quantity, requiredDate, suppliers: d.suppliers || [], capabilities, history: d.history || [], similar: similar.rows, items: d.items || [], now: now() });
        a.similarity = { status: similar.status, provider: similar.provider, error: similar.error || null };
        decorate(a, item, d, capabilities, dataSource.name);
        a.dataSources = Object.assign({}, d.provenance || {}, { similarity: similar.provider || (d.provenance && d.provenance.similarity) || 'unavailable' });
        return a;
    }

    const rfq = createRfqFlow({ config, analyze, writer });

    // AI is advisory: the analysis is returned unchanged next to the insight; the guard inside aiService
    // rejects any recommendation of a FAIL supplier. No AI => AI_DISABLED, analysis still available.
    async function explain(mode, params) {
        const analysis = await analyze(params);
        if (!aiService) { const e = new Error('AI_DISABLED'); e.status = 503; throw e; }
        const r = await aiService.run(mode, analysis, params.questionId || null, params.chat || null);
        return { analysis, insight: r.insight, cached: r.cached, latencyMs: r.latencyMs };
    }

    return { listItems, analyze, explain, rfq, similarityAvailable: !!(similarity && similarity.available), similarityProvider: similarity && similarity.name || null, dataSource: dataSource.name };
}

// Default local wiring: demo seed + same-family similarity stand-in.
function createDemoSourcingService(opts = {}) {
    const data = require('./demoData');
    const similarity = createSimilarityAdapter(createHistoryFamilyProvider({ items: data.items, history: data.history }));
    return createSourcingService(Object.assign({ data, source: createStaticDataSource(data), similarity }, opts));
}

module.exports = { createSourcingService, createDemoSourcingService };
