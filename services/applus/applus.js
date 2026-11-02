// APplus BOM export (Excel 2003 XML "APplus Data" sheet) -> neutral BOM model, plus the three lookups the
// Feige Variant BOM Editor needs against it: article existence, assembly match by level-1 fingerprint, and a
// level-1 difference list. Pure functions, no I/O - persistence lives in routes/applus.js.
//
// Export layout (one file per head article, structure copy incl. sub-levels):
//   TIEFE "(1) *" | STUELI (parent) | POSITION | MENGE | VBME (unit) | ARTIKEL | NAME | VARIANTE | ABMESSUNG | E | A | S
// Level 1 rows are the BOM as it stands in APplus; deeper levels are the sub-BOMs of level-1 assemblies.

const crypto = require('crypto');

const COLUMNS = { TIEFE: 'level', STUELI: 'parent', POSITION: 'pos', MENGE: 'qty', VBME: 'unit', ARTIKEL: 'article',
                  NAME: 'name', VARIANTE: 'variant', ABMESSUNG: 'dimension', E: 'spare', A: 'routing', S: 'hasBom' };

function unescapeXml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) =>
        e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
                     : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
}

// SpreadsheetML -> array of string arrays. Honours ss:Index (sparse cells).
function parseRows(xml) {
    const rows = [];
    for (const rowMatch of xml.matchAll(/<Row\b[^>]*>([\s\S]*?)<\/Row>/g)) {
        const row = [];
        for (const cell of rowMatch[1].matchAll(/<Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Cell>)/g)) {
            const index = /ss:Index="(\d+)"/.exec(cell[1]);
            if (index) while (row.length < Number(index[1]) - 1) row.push('');
            const data = cell[2] ? /<Data\b[^>]*>([\s\S]*?)<\/Data>/.exec(cell[2]) : null;
            row.push(data ? unescapeXml(data[1]).trim() : '');
        }
        rows.push(row);
    }
    return rows;
}

function normalizeUnit(unit) {
    const u = (unit || '').trim().toLowerCase();
    return (u === '' || u === 'stück' || u === 'stk' || u === 'st') ? 'Stk' : unit.trim();
}

function toNumber(q) {
    const n = parseFloat(String(q).replace(',', '.'));
    return isNaN(n) ? 0 : n;
}

// One export file -> { head, rows[] }. Throws if the header row is not an APplus BOM export.
function parseExport(xml, fileName) {
    const rows = parseRows(xml);
    const header = rows.shift() || [];
    const ix = {};
    header.forEach((h, i) => { if (COLUMNS[h]) ix[COLUMNS[h]] = i; });
    for (const key of ['level', 'parent', 'qty', 'article']) {
        if (ix[key] === undefined) throw new Error(`${fileName || 'export'}: column for "${key}" missing - not an APplus BOM export`);
    }
    const out = rows.filter(r => r.length).map(r => {
        const get = k => (ix[k] === undefined ? '' : (r[ix[k]] || ''));
        const level = /\((\d+)\)/.exec(get('level'));
        return {
            level     : level ? Number(level[1]) : 0,
            parent    : get('parent'),
            pos       : get('pos'),
            qty       : toNumber(get('qty')),
            unit      : normalizeUnit(get('unit')),
            article   : get('article'),
            name      : get('name'),
            variant   : get('variant'),
            dimension : get('dimension'),
            spare     : get('spare') !== '',
            routing   : get('routing') !== '',
            hasBom    : get('hasBom') !== ''
        };
    }).filter(r => r.level > 0 && r.article);
    const first = out.find(r => r.level === 1);
    const head = first ? first.parent : String(fileName || '').split(/[._]/)[0];
    return { head, rows: out };
}

function level1(bom) {
    return bom.rows.filter(r => r.level === 1);
}

// Order-independent identity of a BOM level: sum quantity per (article, unit), sort, hash.
// The same article at two positions counts once with the summed quantity (APplus does list duplicates).
function fingerprint(lines) {
    const sum = {};
    for (const l of lines) {
        if (!l.article) continue;
        const key = l.article + '|' + normalizeUnit(l.unit || '');
        sum[key] = (sum[key] || 0) + toNumber(l.qty);
    }
    const canonical = Object.keys(sum).sort().map(k => k + '|' + Number(sum[k].toFixed(6))).join(';');
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

// boms: { head: { file, importedAt, rows } } -> lookup structures.
function buildIndex(boms) {
    const articles = {}, fingerprints = {};
    for (const bom of Object.values(boms)) {
        for (const r of bom.rows) {
            const a = articles[r.article] || (articles[r.article] = { name: r.name, usedIn: [], hasBom: false });
            if (!a.usedIn.includes(r.parent)) a.usedIn.push(r.parent);
            if (r.hasBom) a.hasBom = true;
        }
        // every sub-BOM contained in the export is a matchable assembly too, not only the file's head
        const parents = {};
        for (const r of bom.rows) (parents[r.parent] = parents[r.parent] || []).push(r);
        for (const [parent, lines] of Object.entries(parents)) {
            const fp = fingerprint(lines);
            const list = fingerprints[fp] || (fingerprints[fp] = []);
            if (!list.includes(parent)) list.push(parent);
            if (!articles[parent]) articles[parent] = { name: '', usedIn: [], hasBom: true };   // file head: no row of its own
            articles[parent].hasBom = true;
        }
    }
    return { articles, fingerprints, heads: Object.keys(boms) };
}

// Existence check. Source is the set of imported BOM exports - an article that occurs in none of them reads
// as "not found", which is only "missing in APplus" if the exports cover the article master (they do not).
function lookup(index, articleNumbers) {
    return articleNumbers.map(article => {
        const a = index.articles[article];
        return a ? { article, found: true, name: a.name, hasBom: a.hasBom, usedIn: a.usedIn }
                 : { article, found: false };
    });
}

// Assembly existence: which APplus BOMs have exactly this level-1 composition?
function matchBom(index, lines) {
    return index.fingerprints[fingerprint(lines)] || [];
}

// Level-1 difference between an APplus BOM and a Fusion BOM level.
// fmLines: [{ article, qty, unit, label }] - article may be '' (CAD item without article number).
function diffLevel1(boms, head, fmLines) {
    const ap = [];
    for (const bom of Object.values(boms)) for (const r of bom.rows) if (r.parent === head) ap.push(r);
    if (ap.length === 0) throw new Error(`APplus BOM ${head} not imported`);

    const fmByArticle = {};
    fmLines.forEach((l, i) => { if (l.article) (fmByArticle[l.article] = fmByArticle[l.article] || []).push(i); });
    const usedFm = new Set(), result = [];

    for (const r of ap) {
        const i = (fmByArticle[r.article] || []).find(x => !usedFm.has(x));
        if (i === undefined) {
            // ponytail: candidate = FM line without article number and the same quantity - a hint for data
            // cleansing in CAD, never counted as a match.
            const cand = fmLines.findIndex((l, x) => !l.article && !usedFm.has(x) && r.unit === 'Stk' && toNumber(l.qty) === r.qty);
            if (cand >= 0) usedFm.add(cand);
            result.push({ status: 'ONLY_APPLUS', article: r.article, name: r.name, pos: r.pos, applusQty: r.qty, unit: r.unit,
                          candidate: cand >= 0 ? fmLines[cand].label || '' : null });
            continue;
        }
        usedFm.add(i);
        const l = fmLines[i];
        const status = r.unit !== normalizeUnit(l.unit || '') ? 'UNIT_DIFF' : (toNumber(l.qty) === r.qty ? 'MATCH' : 'QTY_DIFF');
        result.push({ status, article: r.article, name: r.name, pos: r.pos,
                      applusQty: r.qty, fmQty: toNumber(l.qty), unit: r.unit });
    }
    fmLines.forEach((l, i) => {
        if (!usedFm.has(i)) result.push({ status: 'ONLY_FM', article: l.article || '', name: l.label || '', fmQty: toNumber(l.qty),
                                          reason: l.article ? 'not in this APplus BOM' : 'no article number' });
    });
    return result;
}

// Order BOM (one line per BOM position, root first) against the imported exports.
// lines: [{ id, parent, article, qty, assembly, variant, ... }]  parent = id of the parent line, null for the root.
//   MERGED         same article as its parent: no line of its own (weldment profiles inherit it, assumption #23488)
//   IN_APPLUS      article occurs in an export
//   BOM_MATCH      assembly without article, an APplus BOM has exactly this level-1 composition (heads)
//   TO_CREATE      generated assembly without article and without a matching APplus BOM
//   CHECK_MASTER   chosen article of a generated item, not in the exports: only the article master can tell
//   NOT_IN_EXPORTS CAD article not in the exports. Exports do not cover the article master, so this is no "missing"
//   NO_ARTICLE     nothing to compare: CAD item without article
// toCreate is deduplicated, a generated item used at several positions is listed once.
function checkOrderBom(index, lines) {
    const byId = {}, children = {}, checked = {};
    for (const l of lines) {
        byId[l.id] = l;
        if (l.parent !== null) (children[l.parent] = children[l.parent] || []).push(l);
    }
    const check = l => {
        if (checked[l.id]) return checked[l.id];
        const parent = byId[l.parent];
        const out = (status, extra) => (checked[l.id] = Object.assign({}, l, { status }, extra));
        if (l.article && parent && parent.article === l.article) return out('MERGED');
        if (l.article) {
            const hit = index.articles[l.article];
            if (hit) return out('IN_APPLUS', { applusName: hit.name });
            return out(l.variant ? 'CHECK_MASTER' : 'NOT_IN_EXPORTS');
        }
        if (!l.assembly) return out('NO_ARTICLE');
        // a sub-assembly found by its BOM counts with that article; an open position rules out an exact match
        const kids = (children[l.id] || []).map(k => {
            const c = check(k);
            return { article: c.article || (c.heads && c.heads.length === 1 ? c.heads[0] : ''), qty: k.qty, unit: k.unit };
        });
        const heads = kids.length && kids.every(k => k.article) ? matchBom(index, kids) : [];
        if (heads.length) return out('BOM_MATCH', { heads });
        return out(l.variant ? 'TO_CREATE' : 'NO_ARTICLE');
    };
    const result = lines.map(check), seen = new Set(), summary = {};
    for (const l of result) summary[l.status] = (summary[l.status] || 0) + 1;
    const toCreate = result.filter(l => {
        const key = l.article || l.number;
        if ((l.status !== 'TO_CREATE' && l.status !== 'CHECK_MASTER') || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return { lines: result, toCreate, summary };
}

module.exports = { parseExport, level1, fingerprint, buildIndex, lookup, matchBom, diffLevel1, checkOrderBom, normalizeUnit };
