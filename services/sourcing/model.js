// Sourcing domain model: enums + the shapes the deterministic engine consumes. Pure, no I/O.
//
// Hard semantic rule: TECHNICAL PASS/FAIL (capability vs requirement) is strictly separate from the
// COMMERCIAL / HISTORY / DELIVERY / QUALITY scoring. A technically failed supplier never gets an overall
// score and is never recommended, whatever its price or history says.
//
// Shapes (plain objects, ids are strings):
//   item            { id, title, family, requirements: { process, material, toleranceClass, maxDimensionMm, certifications[] }, standardProfileOf? }
//   supplier        { id, name, country, status: APPROVED|CONDITIONAL|BLOCKED }
//   capability      { supplierId, source, updatedAt, processes[], materials[], toleranceClass, maxDimensionMm, certifications[],
//                     leadTimeDays, capacityPerMonth, priceBreaks: [{ minQty, unitPrice }] }     (one record per supplier)
//   purchase        { id, supplierId, itemId, date, quantity, unitPrice, currency, promisedDate, deliveredDate, rejectedQty }
//   similarity row  { similarItemId, similarityScore 0..1, historicalSupplier, historicalPrice, historicalQuantity, historicalDate }
//   candidate       engine output per supplier (see engine.js analyze())
//   rfq draft       see rfq.js buildRfqDraft()

const TECH = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' });
const SUPPLIER_STATUS = Object.freeze({ APPROVED: 'APPROVED', CONDITIONAL: 'CONDITIONAL', BLOCKED: 'BLOCKED' });
const TOLERANCE_ORDER = Object.freeze(['coarse', 'medium', 'fine', 'precision']);   // coarse < ... < precision
const CONFLICT = Object.freeze({ CAPABILITY_HISTORY: 'CAPABILITY_HISTORY_CONFLICT', PRICE: 'PRICE_CONFLICT' });
// Score weights for the overall score; renormalized over the scores that actually exist (missing stays null).
const WEIGHTS = Object.freeze({ commercial: 0.35, delivery: 0.30, quality: 0.20, history: 0.15 });
const DAY_MS = 86400000;

function num(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function daysBetween(fromIso, toIso) {
    const a = Date.parse(fromIso), b = Date.parse(toIso);
    return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / DAY_MS : null;
}
function clamp100(n) { return Math.max(0, Math.min(100, Math.round(n))); }

module.exports = { TECH, SUPPLIER_STATUS, TOLERANCE_ORDER, CONFLICT, WEIGHTS, DAY_MS, num, daysBetween, clamp100 };
