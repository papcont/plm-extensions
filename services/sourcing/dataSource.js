const { createSimilarityAdapter, createHistoryFamilyProvider } = require('./similarity');

function createStaticDataSource(data) {
    const source = {
        name: 'demo',
        async load() {
            return { items: data.items || [], suppliers: data.suppliers || [], capabilities: data.capabilities || [], capabilitiesFor: data.capabilitiesFor || null, history: data.history || [], quotes: [], provenance: { item: 'demo', suppliers: 'demo', capabilities: 'demo', purchaseHistory: 'demo', quotes: 'demo' } };
        },
        async similarity(item, loaded) {
            const provider = createHistoryFamilyProvider({ items: loaded.items, history: loaded.history });
            return createSimilarityAdapter(provider).findSimilar(item);
        },
    };
    for (const key of ['items', 'suppliers', 'capabilities', 'history', 'quotes']) source['load' + key[0].toUpperCase() + key.slice(1)] = async () => (await source.load())[key];
    return source;
}

// Explicit, local "Prototype / Local" technical evidence for HYBRID mode only. Keyed by the stable supplier business
// key (never the display name). It fills exactly one missing capability field and is tagged so the UI can show that
// the resulting PASS partly rests on prototype evidence. It never touches FM data and FM mode never sees it.
const PROTOTYPE_CAPACITY = {
    'DEMO-SRC-SUP-001': { capacityPerMonth: 400, note: 'Prototype capacity assumption for the conference demo; not recorded in Fusion Manage' },
};

function withPrototypeEvidence(loaded) {
    const capabilities = (loaded.capabilities || []).map(c => {
        const p = PROTOTYPE_CAPACITY[c.supplierId];
        if (!p || c.capacityPerMonth != null) return c;
        return Object.assign({}, c, { capacityPerMonth: p.capacityPerMonth, prototypeEvidence: { capacityPerMonth: { value: p.capacityPerMonth, source: 'prototype-local', note: p.note } } });
    });
    return Object.assign({}, loaded, { capabilities, provenance: Object.assign({}, loaded.provenance, { prototypeEvidence: 'prototype-local' }) });
}

function createHybridDataSource(fmSource) {
    const source = {
        name: 'hybrid',
        async load() { return withPrototypeEvidence(await fmSource.load()); },
        async similarity(item, loaded) {
            const provider = createHistoryFamilyProvider({ items: loaded.items, history: loaded.history });
            return createSimilarityAdapter(provider).findSimilar(item);
        },
    };
    for (const key of ['items', 'suppliers', 'capabilities', 'history', 'quotes']) source['load' + key[0].toUpperCase() + key.slice(1)] = async () => (await source.load())[key];
    return source;
}

module.exports = { createStaticDataSource, createHybridDataSource };
