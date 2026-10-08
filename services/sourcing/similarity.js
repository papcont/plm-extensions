// Similarity Search boundary. The engine never depends on geometry: a provider (later VaultVector or any
// similarity service) returns rows in ONE contract and the adapter normalizes/filters them. No provider
// => sourcing still works with zero similarity evidence.
//
// Provider contract: { name, findSimilar(item, opts) -> Promise<Array<row>> }
// Row contract:      { similarItemId, similarityScore (0..1), historicalSupplier, historicalPrice, historicalQuantity, historicalDate }

const { num } = require('./model');

function normalize(r) {
    if (!r || typeof r !== 'object') return null;
    const score = num(r.similarityScore);
    if (!r.similarItemId || !r.historicalSupplier || score == null || score < 0 || score > 1) return null;
    return { similarItemId: String(r.similarItemId), similarityScore: Math.round(score * 1000) / 1000, historicalSupplier: String(r.historicalSupplier),
        historicalPrice: num(r.historicalPrice), historicalQuantity: num(r.historicalQuantity), historicalDate: r.historicalDate || null };
}

function createSimilarityAdapter(provider = null) {
    async function findSimilar(item, opts = {}) {
        if (!provider) return { status: 'none', provider: null, rows: [] };
        try {
            const raw = await provider.findSimilar(item, opts);
            const rows = (Array.isArray(raw) ? raw : []).map(normalize).filter(Boolean).filter(r => r.similarItemId !== String(item.id));
            return { status: 'ok', provider: provider.name || 'provider', rows: rows.slice(0, opts.limit || 10) };
        } catch (e) {
            return { status: 'unavailable', provider: provider.name || 'provider', rows: [], error: e.message || 'similarity failed' };
        }
    }
    return { findSimilar, available: !!provider, name: provider ? provider.name || 'provider' : null };
}

// Demo stand-in until a geometry provider exists: items of the same family count as similar (0.8), and
// their purchase history becomes the evidence. Deterministic, local only.
function createHistoryFamilyProvider({ items = [], history = [], score = 0.8 } = {}) {
    return {
        name: 'history-family',
        async findSimilar(item) {
            const ids = new Set(items.filter(i => i.family && i.family === item.family && i.id !== item.id).map(i => i.id));
            return history.filter(h => ids.has(h.itemId)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
                .map(h => ({ similarItemId: h.itemId, similarityScore: score, historicalSupplier: h.supplierId, historicalPrice: h.unitPrice, historicalQuantity: h.quantity, historicalDate: h.date }));
        },
    };
}

module.exports = { createSimilarityAdapter, createHistoryFamilyProvider, normalize };
