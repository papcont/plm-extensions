const fs = require('node:fs');
const path = require('node:path');

function decode(v) {
    return String(v == null ? '' : v).replace(/&#61;|&#x3d;/gi, '=').replace(/&#43;|&#x2b;/gi, '+').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
function field(details, id) {
    for (const section of details.sections || []) for (const f of section.fields || []) {
        const fieldId = String(f.__self__ || '').split('/').pop();
        if (fieldId === id) return f.value;
    }
    return null;
}
function refId(v) {
    const m = v && String(v.link || '').match(/\/items\/(\d+)$/);
    return m ? m[1] : null;
}
function pairs(text) {
    const out = {};
    decode(text).split(';').forEach(part => { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim(); });
    return out;
}
function list(v) { return String(v || '').split(/[+,]/).map(x => x.trim()).filter(Boolean); }
function maxDimension(v) { const n = String(v || '').split('x').map(Number).filter(Number.isFinite); return n.length ? Math.max(...n) : null; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function stableFromDescriptor(v) { const m = String(v || '').match(/(DEMO-SRC-(?:ITEM|SUP|CAP|PO|RFQ)-[A-Z0-9-]+)/i); return m ? m[1] : null; }
// The record a value was actually read from (workspace + dmsId of the GET), so the UI can open it in Fusion Manage.
function recordOf(rows, index) { const r = rows[index]; return r ? { workspaceId: String(r.workspaceId), dmsId: String(r.dmsId) } : null; }

function createFmDataSource({ config, mapping, readRepository }) {
    let loadedPromise = null;
    const mappingPath = path.resolve(__dirname, '../../docs/features/intelligent-sourcing/FM-DEMO-MAPPING.json');
    const map = mapping || JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

    async function detailsFor(rows) {
        return Promise.all(rows.map(row => readRepository.getItem(row.workspaceId, row.dmsId)));
    }
    async function load() {
        if (loadedPromise) return loadedPromise;
        loadedPromise = (async () => {
            const w = map.workspaces;
            const itemDmsIds = [map.primaryObject.fm.dmsId].concat(map.relatedItems.range.dmsIds);
            const itemRows = itemDmsIds.map(dmsId => ({ workspaceId: w.items.id, dmsId: String(dmsId), descriptor: '' }));
            const supplierRows = Object.values(map.suppliers.dmsIds).map(dmsId => ({ workspaceId: w.suppliers.id, dmsId }));
            const capRows = Object.values(map.capabilities.dmsIds).map(dmsId => ({ workspaceId: w.capabilities.id, dmsId }));
            const poRows = (await readRepository.listAllItems(w.purchaseHistory.id, { maxItems: 500 })).map(r => ({ workspaceId: w.purchaseHistory.id, dmsId: String(r.__self__).split('/').pop(), descriptor: r.descriptor })).filter(r => /DEMO-SRC-PO-\d{4}/.test(r.descriptor || ''));
            const rfqRows = map.rfqAndQuotes.records.map(r => ({ workspaceId: w.rfq.id, dmsId: r.dmsId }));
            const [itemDetails, supplierDetails, capDetails, poDetails, rfqDetails] = await Promise.all([detailsFor(itemRows), detailsFor(supplierRows), detailsFor(capRows), detailsFor(poRows), detailsFor(rfqRows)]);
            const items = itemDetails.map((d, index) => {
                const p = pairs(field(d, 'DESCRIPTION'));
                const stableId = p.stableId || field(d, 'NUMBER');
                const id = stableId === 'DEMO-SRC-ITEM-001' ? map.primaryObject.businessId : stableId;
                const dims = String(p.dimensions || '').split('x').map(Number).filter(Number.isFinite);
                return { id, title: field(d, 'TITLE') || d.title, family: p.family || null, requirements: { process: p.process || null, material: p.material || null, maxDimensionMm: dims.length ? Math.max(...dims) : null, certifications: p.certifications ? list(p.certifications) : [] }, manufacturingTolerance: p.tolerance || null, thicknessMm: num(p.thickness), source: 'fusion-manage', fm: { workspaceId: w.items.id, dmsId: String(field(d, 'DMS_ID') || '').trim() || null, stableId, record: recordOf(itemRows, index) } };
            }).filter(i => i.id);
            const suppliers = supplierDetails.map((d, index) => ({ id: stableFromDescriptor(field(d, 'NAME')) || field(d, 'NAME'), name: field(d, 'NAME') || d.title, country: null, status: null, source: 'fusion-manage', fm: { workspaceId: w.suppliers.id, dmsId: String(field(d, 'DMS_ID') || '').trim() || null, record: recordOf(supplierRows, index) } }));
            const supplierByDms = new Map(suppliers.map(s => [s.fm.dmsId, s.id]));
            const capabilities = capDetails.map((d, index) => { const p = pairs(field(d, 'COMMENTS')); const supplierId = p.supplier || supplierByDms.get(refId(field(d, 'MANUFACTURER'))); const process = p.process || p.processes; return supplierId && { supplierId, source: 'fusion-manage', updatedAt: null, processes: process ? [process] : [], materials: list(p.materials), toleranceClass: null, maxDimensionMm: maxDimension(p.maxDimensionsMm), maxThicknessMm: num(p.maxThicknessMm), tolerance: p.tolerance || null, certifications: list(p.certifications), leadTimeDays: num(field(d, 'LEAD_TIME')), capacityPerMonth: null, priceBreaks: [{ minQty: num(field(d, 'MIN_ORDER_QTY')) || 1, unitPrice: num(field(d, 'UNIT_COST')) }].filter(x => x.unitPrice != null), fm: { workspaceId: w.capabilities.id, dmsId: String(field(d, 'MANUFACTURER_PN') || ''), record: recordOf(capRows, index) } }; }).filter(Boolean);
            const itemAliases = new Map(items.flatMap(i => [[i.id, i.id], [i.fm.stableId, i.id]]));
            const history = poDetails.map((d, index) => { const p = pairs(field(d, 'NOTES')); const stableId = p.stableId; const itemId = itemAliases.get(p.item) || p.item; const supplierId = p.supplier; if (!stableId || !supplierId || !itemId) return null; return { id: stableId, supplierId, itemId, date: p.orderDate || null, quantity: num(p.quantity), unitPrice: num(p.unitPriceEUR), currency: 'EUR', promisedDate: null, deliveredDate: null, rejectedQty: num(p.rejectedQty), source: 'fusion-manage', fm: { workspaceId: w.purchaseHistory.id, dmsId: String(field(d, 'NUMBER') || ''), record: recordOf(poRows, index) } }; }).filter(Boolean);
            const quotes = rfqDetails.map(d => ({ id: field(d, 'TITLE'), itemId: refId(field(d, 'IMPACTED_ITEM')), supplierId: refId(field(d, 'SUPPLIER')), comments: pairs(field(d, 'COMMENTS')), source: 'fusion-manage' }));
            return { items, suppliers, capabilities, history, quotes, provenance: { item: 'fusion-manage', suppliers: 'fusion-manage', capabilities: 'fusion-manage', purchaseHistory: 'fusion-manage', quotes: 'fusion-manage', similarity: 'unavailable' } };
        })();
        return loadedPromise;
    }
    const source = { name: 'fm', load, async similarity() { return { status: 'none', provider: null, rows: [] }; } };
    for (const key of ['items', 'suppliers', 'capabilities', 'history', 'quotes']) source['load' + key[0].toUpperCase() + key.slice(1)] = async () => (await load())[key];
    return source;
}

module.exports = { createFmDataSource, pairs, field, decode, recordOf };
