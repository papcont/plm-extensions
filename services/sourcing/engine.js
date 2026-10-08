// Deterministic first-pass sourcing engine. Pure (no I/O, no AI), reproducible for a given `now`.
//
// analyze({ item, quantity, requiredDate, suppliers, capabilities, history, similar, items, now }) ->
//   { engineVersion, request, item, candidates[ranked], recommendedSupplierId, summary, conflicts, missingData,
//     similarityEvidence, standardAlternatives }
//
// Per candidate: technicalStatus (PASS|FAIL|UNKNOWN) + technicalReasons + technicalChecks, then commercial /
// history / delivery / quality scores (0-100 or null when the data does not exist), overallScore (null for
// FAIL), missingData, conflicts, evidence. Every number is traceable to an input row; nothing is estimated.

const M = require('./model');
const { TECH, CONFLICT, WEIGHTS, num, daysBetween, clamp100 } = M;

const pass = (actual, detail) => ({ status: TECH.PASS, actual, detail: detail || 'ok' });
const fail = (actual, detail) => ({ status: TECH.FAIL, actual, detail });
const unknown = (detail) => ({ status: TECH.UNKNOWN, actual: null, detail: detail || 'no capability data' });

function setCheck(reqKey, capKey) {
    return (req, cap) => {
        const need = req[reqKey];
        if (!need) return null;
        if (!cap || !Array.isArray(cap[capKey])) return unknown();
        return cap[capKey].includes(need) ? pass(cap[capKey].join(', ')) : fail(cap[capKey].join(', '), need + ' not offered');
    };
}

// One row per requirement the item actually has. Order = display order in "Why this supplier?".
const CHECKS = [
    ['supplierStatus', (req, cap, sup) => sup.status === M.SUPPLIER_STATUS.BLOCKED ? fail(sup.status, 'supplier is BLOCKED') : pass(sup.status)],
    ['process', setCheck('process', 'processes')],
    ['material', setCheck('material', 'materials')],
    ['toleranceClass', (req, cap) => {
        if (!req.toleranceClass) return null;
        if (!cap || cap.toleranceClass == null) return unknown();
        const have = M.TOLERANCE_ORDER.indexOf(cap.toleranceClass), need = M.TOLERANCE_ORDER.indexOf(req.toleranceClass);
        if (have < 0 || need < 0) return unknown('unrecognized tolerance class');
        return have >= need ? pass(cap.toleranceClass) : fail(cap.toleranceClass, 'requires ' + req.toleranceClass + ', supplier offers ' + cap.toleranceClass);
    }],
    ['maxDimensionMm', (req, cap) => {
        const need = num(req.maxDimensionMm);
        if (need == null) return null;
        const have = cap ? num(cap.maxDimensionMm) : null;
        if (have == null) return unknown();
        return have >= need ? pass(have) : fail(have, 'part needs ' + need + ' mm, supplier max ' + have + ' mm');
    }],
    ['certifications', (req, cap) => {
        const need = Array.isArray(req.certifications) ? req.certifications : [];
        if (!need.length) return null;
        if (!cap || !Array.isArray(cap.certifications)) return unknown();
        const missing = need.filter(c => !cap.certifications.includes(c));
        return missing.length ? fail(cap.certifications.join(', '), 'missing ' + missing.join(', ')) : pass(cap.certifications.join(', '));
    }],
    ['capacity', (req, cap, sup, ctx) => {
        if (ctx.quantity == null) return null;
        const have = cap ? num(cap.capacityPerMonth) : null;
        if (have == null) return unknown();
        return have >= ctx.quantity ? pass(have) : fail(have, 'quantity ' + ctx.quantity + ' exceeds monthly capacity ' + have);
    }],
];
const CAPABILITY_CHECKS = ['process', 'material', 'toleranceClass', 'maxDimensionMm', 'certifications'];

function technical(item, quantity, supplier, cap) {
    const req = item.requirements || {};
    const checks = [];
    for (const [check, fn] of CHECKS) {
        const r = fn(req, cap, supplier, { quantity });
        if (r) checks.push(Object.assign({ check, required: requiredOf(req, check, quantity) }, r));
    }
    const status = checks.some(c => c.status === TECH.FAIL) ? TECH.FAIL : checks.some(c => c.status === TECH.UNKNOWN) ? TECH.UNKNOWN : TECH.PASS;
    const reasons = checks.filter(c => c.status !== TECH.PASS).map(c => c.check + ': ' + c.detail);
    return { status, reasons, checks };
}
function requiredOf(req, check, quantity) {
    if (check === 'supplierStatus') return 'not BLOCKED';
    if (check === 'capacity') return quantity;
    if (check === 'certifications') return (req.certifications || []).join(', ');
    return req[check];
}

// Price for this quantity: quote price break -> latest own purchase of the item -> similar-item purchase.
function quotePrice(cap, quantity) {
    if (!cap || !Array.isArray(cap.priceBreaks) || !cap.priceBreaks.length) return null;
    const eligible = cap.priceBreaks.filter(b => quantity == null || (num(b.minQty) || 0) <= quantity)
        .sort((a, b) => (num(b.minQty) || 0) - (num(a.minQty) || 0));
    return eligible.length ? { unitPrice: num(eligible[0].unitPrice), minQty: num(eligible[0].minQty) || 0, source: 'quote' } : null;
}
function resolvePrice(cap, quantity, own, similarRows) {
    const q = quotePrice(cap, quantity);
    if (q && q.unitPrice != null) return q;
    if (own.length && num(own[0].unitPrice) != null) return { unitPrice: num(own[0].unitPrice), source: 'history', date: own[0].date };
    const s = similarRows.filter(r => num(r.historicalPrice) != null).sort((a, b) => b.similarityScore - a.similarityScore)[0];
    if (s) return { unitPrice: num(s.historicalPrice), source: 'similar', similarItemId: s.similarItemId, similarityScore: s.similarityScore };
    return null;
}

function historyScore(own, similarRows) {
    if (!own.length && !similarRows.length) return null;
    const sim = similarRows.reduce((a, r) => a + (num(r.similarityScore) || 0), 0);
    return clamp100(40 + 20 * own.length + 15 * sim);
}

function leadTime(cap, own) {
    if (cap && num(cap.leadTimeDays) != null) return { days: num(cap.leadTimeDays), source: 'capability' };
    const d = own.map(h => daysBetween(h.date, h.deliveredDate)).filter(x => x != null && x >= 0);
    if (d.length) return { days: Math.round(d.reduce((a, b) => a + b, 0) / d.length), source: 'history' };
    return null;
}
function onTimeRate(own) {
    const rows = own.filter(h => h.promisedDate && h.deliveredDate);
    if (!rows.length) return null;
    return rows.filter(h => Date.parse(h.deliveredDate) <= Date.parse(h.promisedDate)).length / rows.length;
}
function deliveryScore(lead, availableDays, onTime) {
    if (!lead || availableDays == null) return { score: null, risk: null };
    if (lead.days <= 0) return { score: 100, risk: null };               // stock / immediate delivery
    if (lead.days > availableDays) return { score: 0, risk: 'LATE' };
    const ratio = availableDays <= 0 ? 1 : lead.days / availableDays;
    const base = ratio <= 0.5 ? 100 : 100 * (1 - ratio) / 0.5;
    const score = onTime == null ? base : 0.7 * base + 30 * onTime;
    return { score: clamp100(score), risk: ratio > 0.8 ? 'TIGHT' : null };
}

// Defect rate over all own purchases with a recorded rejectedQty; worsening trend = newest two vs earlier.
function qualityScore(own) {
    const rows = own.filter(h => num(h.rejectedQty) != null && num(h.quantity)).slice().sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    if (!rows.length) return { score: null, trend: null, defectRate: null };
    const rate = rs => rs.reduce((a, h) => a + num(h.rejectedQty), 0) / rs.reduce((a, h) => a + num(h.quantity), 0);
    const defectRate = rate(rows);
    let score = clamp100(100 * (1 - Math.min(1, defectRate * 10)));   // 10 % rejects => 0
    let trend = null;
    if (rows.length >= 3) {
        const recent = rate(rows.slice(-2)), earlier = rate(rows.slice(0, -2));
        trend = recent > 0.02 && recent > earlier * 1.5 ? 'WORSENING' : 'STABLE';
        if (trend === 'WORSENING') score = Math.max(0, score - 20);
    }
    return { score, trend, defectRate: Math.round(defectRate * 1000) / 1000 };
}

function overall(scores) {
    let sum = 0, w = 0;
    for (const [k, weight] of Object.entries(WEIGHTS)) if (scores[k] != null) { sum += scores[k] * weight; w += weight; }
    return w ? { score: clamp100(sum / w), completeness: Math.round(w * 100) / 100 } : { score: null, completeness: 0 };
}
const confidenceOf = c => c >= 0.85 ? 'high' : c >= 0.5 ? 'medium' : 'low';
const GROUP = { [TECH.PASS]: 0, [TECH.UNKNOWN]: 1, [TECH.FAIL]: 2 };

function analyze({ item, quantity = null, requiredDate = null, suppliers = [], capabilities = [], history = [], similar = [], items = [], now = new Date().toISOString() }) {
    if (!item || !item.id) throw new Error('analyze: item required');
    const qty = num(quantity);
    const availableDays = requiredDate ? daysBetween(now, requiredDate) : null;
    const capBy = new Map(capabilities.map(c => [String(c.supplierId), c]));
    const byDateDesc = (a, b) => Date.parse(b.date) - Date.parse(a.date);

    const candidates = suppliers.map(sup => {
        const cap = capBy.get(String(sup.id)) || null;
        const own = history.filter(h => String(h.supplierId) === String(sup.id) && String(h.itemId) === String(item.id)).sort(byDateDesc);
        const sim = similar.filter(r => String(r.historicalSupplier) === String(sup.id));
        const t = technical(item, qty, sup, cap);
        const price = resolvePrice(cap, qty, own, sim);
        const lead = leadTime(cap, own);
        const onTime = onTimeRate(own);
        const del = deliveryScore(lead, availableDays, onTime);
        const q = qualityScore(own);
        const missingData = [];
        if (!cap) missingData.push('capability');
        if (!price) missingData.push('price');
        if (!own.length && !sim.length) missingData.push('history');
        if (!lead) missingData.push('leadTime');
        if (requiredDate == null || requiredDate === '') missingData.push('requiredDate');
        if (q.score == null) missingData.push('qualityHistory');
        const conflicts = [];
        const capFails = t.checks.filter(c => c.status === TECH.FAIL && CAPABILITY_CHECKS.includes(c.check)).map(c => c.check);
        if (capFails.length && own.length) conflicts.push({ type: CONFLICT.CAPABILITY_HISTORY, supplierId: sup.id,
            detail: 'capability record fails ' + capFails.join('/') + ' but ' + own.length + ' past purchase(s) of ' + item.id + ' exist from this supplier; capability data stays authoritative until reviewed' });
        const quoted = quotePrice(cap, qty);
        if (quoted && own.length && num(own[0].unitPrice) && Math.abs(quoted.unitPrice - num(own[0].unitPrice)) / num(own[0].unitPrice) > 0.4) {
            conflicts.push({ type: CONFLICT.PRICE, supplierId: sup.id, detail: 'quoted ' + quoted.unitPrice + ' vs last purchased ' + num(own[0].unitPrice) + ' (' + own[0].date + ')' });
        }
        return {
            supplierId: sup.id, name: sup.name, country: sup.country || null, status: sup.status,
            technicalStatus: t.status, technicalReasons: t.reasons, technicalChecks: t.checks,
            unitPrice: price ? price.unitPrice : null, priceSource: price ? price.source : null, priceEvidence: price,
            leadTimeDays: lead ? lead.days : null, leadTimeSource: lead ? lead.source : null,
            onTimeRate: onTime == null ? null : Math.round(onTime * 100) / 100, deliveryRisk: del.risk,
            purchaseCount: own.length, similarPurchaseCount: sim.length, defectRate: q.defectRate, qualityTrend: q.trend,
            capabilitySource: cap ? cap.source || 'profile' : null, capabilityUpdatedAt: cap ? cap.updatedAt || null : null,
            commercialScore: null,                                   // needs the cheapest reference; filled below
            historyScore: historyScore(own, sim), deliveryScore: del.score, qualityScore: q.score,
            overallScore: null, dataCompleteness: 0, confidence: 'low',
            missingData, conflicts,
            evidence: { purchases: own.slice(0, 5).map(h => ({ id: h.id, date: h.date, quantity: num(h.quantity), unitPrice: num(h.unitPrice), currency: h.currency || null, promisedDate: h.promisedDate || null, deliveredDate: h.deliveredDate || null, rejectedQty: num(h.rejectedQty) })),
                similar: sim.slice(0, 5) },
        };
    });

    // Commercial: relative to the cheapest technically not-failed candidate (FAIL prices never set the bar).
    const priced = candidates.filter(c => c.unitPrice != null);
    const refPool = priced.filter(c => c.technicalStatus !== TECH.FAIL);
    const ref = (refPool.length ? refPool : priced).reduce((m, c) => m == null || c.unitPrice < m ? c.unitPrice : m, null);
    for (const c of candidates) {
        if (c.unitPrice != null && ref != null && c.unitPrice > 0) c.commercialScore = clamp100(100 * ref / c.unitPrice);
        if (c.technicalStatus !== TECH.FAIL) {
            const o = overall({ commercial: c.commercialScore, history: c.historyScore, delivery: c.deliveryScore, quality: c.qualityScore });
            c.overallScore = o.score; c.dataCompleteness = o.completeness; c.confidence = confidenceOf(o.completeness);
        }
    }
    candidates.sort((a, b) => GROUP[a.technicalStatus] - GROUP[b.technicalStatus]
        || (b.overallScore == null ? -1 : b.overallScore) - (a.overallScore == null ? -1 : a.overallScore)
        || b.dataCompleteness - a.dataCompleteness                      // equal score: more evidence wins
        || (a.unitPrice == null ? Infinity : a.unitPrice) - (b.unitPrice == null ? Infinity : b.unitPrice)
        || String(a.supplierId).localeCompare(String(b.supplierId)));
    candidates.forEach((c, i) => { c.rank = i + 1; });

    const recommended = candidates.find(c => c.technicalStatus === TECH.PASS && c.overallScore != null) || null;
    const counts = { passCount: 0, unknownCount: 0, failCount: 0 };
    for (const c of candidates) counts[c.technicalStatus === TECH.PASS ? 'passCount' : c.technicalStatus === TECH.FAIL ? 'failCount' : 'unknownCount']++;
    const standardAlternatives = items.filter(i => i.standardProfileOf === item.id).map(alt => {
        const h = history.filter(x => String(x.itemId) === String(alt.id)).sort(byDateDesc)[0] || null;
        return { itemId: alt.id, title: alt.title, lastSupplierId: h ? h.supplierId : null, lastUnitPrice: h ? num(h.unitPrice) : null, lastDate: h ? h.date : null };
    });

    return {
        engineVersion: 1,
        request: { itemId: item.id, quantity: qty, requiredDate: requiredDate || null, availableDays: availableDays == null ? null : Math.round(availableDays), analyzedAt: now },
        item: { id: item.id, title: item.title, family: item.family || null, requirements: item.requirements || {} },
        candidates,
        recommendedSupplierId: recommended ? recommended.supplierId : null,
        summary: Object.assign(counts, {
            recommendedSupplierId: recommended ? recommended.supplierId : null,
            reason: recommended ? 'highest overall score among technically PASS suppliers (' + recommended.overallScore + ', data completeness ' + recommended.dataCompleteness + ')'
                : counts.passCount ? 'PASS suppliers exist but none has enough data for an overall score' : 'no technically PASS supplier',
        }),
        conflicts: candidates.flatMap(c => c.conflicts),
        missingData: candidates.flatMap(c => c.missingData.map(field => ({ supplierId: c.supplierId, field }))),
        similarityEvidence: similar.slice(0, 10),
        standardAlternatives,
    };
}

module.exports = { analyze, technical, quotePrice, deliveryScore, qualityScore, historyScore };
