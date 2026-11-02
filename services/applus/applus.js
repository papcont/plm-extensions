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

// Level 1 of an APplus BOM, one entry per article: APplus lists an article at several positions. A sub-BOM can be
// part of several exports, so only the first one counts.
function bomLevel1(boms, head) {
    for (const bom of Object.values(boms)) {
        const rows = bom.rows.filter(r => r.parent === head);
        if (rows.length === 0) continue;
        const byArticle = {};
        for (const r of rows) {
            const a = byArticle[r.article] || (byArticle[r.article] = { article: r.article, name: r.name, unit: r.unit, qty: 0, pos: [] });
            a.qty += r.qty;
            if (r.pos) a.pos.push(r.pos);
        }
        return Object.values(byArticle);
    }
    return [];
}

const DIFF_TEXT = {
    MATCH           : 'In beiden vorhanden',
    OTHER_EXECUTION : 'Andere Ausführung als in APplus',
    QTY_DIFF        : 'Abweichende Menge',
    UNIT_DIFF       : 'Abweichende Einheit',
    ONLY_FM         : 'Nur in Fusion',
    CANDIDATE       : 'Nur in APplus: möglicher Kandidat im CAD ohne Artikelnummer (gleiche Menge)',
    ARTICLE_DIFF    : 'Nur in APplus: abweichender Artikel',
    NO_MODEL        : 'Nur in APplus: ohne 3D-Modell, zu bestätigen'
};

// Level-1 difference between an APplus BOM and a Fusion BOM level.
// fmLines: [{ article, executions, qty, unit, label }] - article may be '' (CAD item without article number),
// executions = { article: slot } of the position's GEN-TITLE fields, so an APplus article of another Ausführung
// or of a number list still finds its position. Exact articles go first: they must not lose their line to that.
function diffLevel1(boms, head, fmLines) {
    const ap = bomLevel1(boms, head);
    if (ap.length === 0) throw new Error(`APplus BOM ${head} not imported`);

    const used = new Set(), rows = {};
    const slotOf = (l, article) => (l.executions || {})[article] || null;
    const compare = (r, hits, status) => {
        hits.forEach(i => used.add(i));
        const l = fmLines[hits[0]], fmQty = hits.reduce((s, i) => s + toNumber(fmLines[i].qty), 0);
        if (r.unit !== normalizeUnit(l.unit || '')) status = 'UNIT_DIFF';
        else if (fmQty !== r.qty) status = 'QTY_DIFF';
        rows[r.article] = { status, fmQty, fmArticle: l.article || '', fmLabel: l.label || '', slot: slotOf(l, r.article) };
    };

    for (const r of ap) {
        const hits = fmLines.map((l, i) => (l.article === r.article ? i : -1)).filter(i => i >= 0);
        if (hits.length) compare(r, hits, 'MATCH');
    }
    for (const r of ap.filter(a => !rows[a.article])) {
        const i = fmLines.findIndex((l, x) => !used.has(x) && slotOf(l, r.article));
        if (i >= 0) compare(r, [i], fmLines[i].article ? 'OTHER_EXECUTION' : 'MATCH');
    }
    // ponytail: both hints are for data cleansing in CAD and never count as a match. Same quantity for a line without
    // number, same quantity and first word of the name for a line with another article. Names are not normalised.
    const firstWord = s => String(s || '').trim().split(/[\s,]+/)[0].toLowerCase();
    for (const r of ap.filter(a => !rows[a.article])) {
        const free = (l, x) => !used.has(x) && toNumber(l.qty) === r.qty;
        let i = r.unit === 'Stk' ? fmLines.findIndex((l, x) => free(l, x) && !l.article && !Object.keys(l.executions || {}).length) : -1;
        let status = 'CANDIDATE';
        if (i < 0) {
            i = fmLines.findIndex((l, x) => free(l, x) && l.article && firstWord(l.name) === firstWord(r.name));
            status = 'ARTICLE_DIFF';
        }
        if (i < 0) { rows[r.article] = { status: 'NO_MODEL' }; continue; }
        used.add(i);
        rows[r.article] = { status, fmArticle: fmLines[i].article || '', fmLabel: fmLines[i].label || '' };
    }

    const result = ap.map(r => Object.assign({ article: r.article, name: r.name, pos: r.pos.join(', '), applusQty: r.qty, unit: r.unit }, rows[r.article]));
    fmLines.forEach((l, i) => {
        if (!used.has(i)) result.push({ status: 'ONLY_FM', article: '', name: '', fmArticle: l.article || '', fmLabel: l.label || '', fmQty: toNumber(l.qty) });
    });
    return result.map(r => Object.assign(r, { text: DIFF_TEXT[r.status] }));
}

// APplus BOMs worth comparing with this Fusion level, best first: share of their level-1 articles that occur on it.
// own = articles of the assembly itself (its ARTIKELNUMMER and GEN-TITLE fields), those come first.
function rankHeads(boms, index, fmLines, own) {
    const known = new Set(), parents = {};
    for (const l of fmLines) {
        if (l.article) known.add(l.article);
        Object.keys(l.executions || {}).forEach(a => known.add(a));
    }
    for (const bom of Object.values(boms)) for (const r of bom.rows) (parents[r.parent] = parents[r.parent] || new Set()).add(r.article);
    return Object.entries(parents)
        .map(([head, set]) => ({ head, name: (index.articles[head] || {}).name || '', own: own.includes(head), size: set.size,
                                 hits: [...set].filter(a => known.has(a)).length }))
        .filter(h => h.hits > 0)
        .sort((a, b) => (b.own - a.own) || (b.hits / b.size - a.hits / a.size) || (b.hits - a.hits))
        .slice(0, 10);
}

// The level-1 positions of a checked order BOM in the shape diffLevel1 and rankHeads take.
function orderLevel1(lines) {
    const root = lines.find(l => l.parent === null);
    return lines.filter(l => root && l.parent === root.id && l.status !== 'MERGED')
                .map(l => ({ article: l.article, executions: l.executions, qty: l.qty, name: l.title, label: l.number + ' - ' + l.title }));
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

module.exports = { parseExport, level1, fingerprint, buildIndex, lookup, matchBom, diffLevel1, rankHeads, orderLevel1, checkOrderBom, normalizeUnit };
