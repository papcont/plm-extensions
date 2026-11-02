// APplus export data for the Variant BOM Editor (Feige). Feige provides APplus BOM exports as files; there is
// no APplus interface. Imported exports are kept as JSON in storage/applus/ (same pattern as storage/erp/).
//
//   POST /applus/import  { files: [{ name, content }] }   content = the export's XML text
//   GET  /applus/summary
//   POST /applus/lookup  { articles: ['2034147', ...] }    -> existence per article
//   POST /applus/match   { lines: [{ article, qty, unit }] } -> APplus BOMs with exactly this level-1 composition
//   POST /applus/diff    { head, lines: [{ article, qty, unit, label }] } -> level-1 difference list
//   POST /applus/order-bom       { lines, head? }        -> order BOM with one check status per line (see checkOrderBom),
//                                                           the APplus BOMs worth comparing, the difference to head
//   POST /applus/order-bom/excel { title, lines, head? } -> the same as .xlsx

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const ExcelJS = require('exceljs');
const applus  = require('../services/applus/applus');

const folder = 'storage/applus';
const file   = folder + '/boms.json';
let cache    = null;   // { boms, index }

function load() {
    if (cache) return cache;
    let boms = {};
    try { if (fs.existsSync(file)) boms = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { boms = {}; }
    cache = { boms, index: applus.buildIndex(boms) };
    return cache;
}

function save(boms) {
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(boms));
    cache = { boms, index: applus.buildIndex(boms) };
}

router.post('/import', function(req, res) {
    const files = (req.body && req.body.files) || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'files[] required' });
    const boms = Object.assign({}, load().boms), imported = [], errors = [];
    for (const f of files) {
        try {
            const bom = applus.parseExport(f.content || '', f.name);
            boms[bom.head] = { file: f.name, importedAt: new Date().toISOString(), rows: bom.rows };
            imported.push({ head: bom.head, file: f.name, rows: bom.rows.length, level1: applus.level1(bom).length });
        } catch (e) {
            errors.push({ file: f.name, message: e.message });
        }
    }
    if (imported.length) save(boms);
    res.json({ success: errors.length === 0, data: { imported, errors } });
});

router.get('/summary', function(req, res) {
    const { boms, index } = load();
    res.json({ success: true, data: {
        boms     : Object.entries(boms).map(([head, b]) => ({ head, file: b.file, importedAt: b.importedAt, rows: b.rows.length })),
        articles : Object.keys(index.articles).length
    }});
});

router.post('/lookup', function(req, res) {
    res.json({ success: true, data: applus.lookup(load().index, (req.body && req.body.articles) || []) });
});

router.post('/match', function(req, res) {
    res.json({ success: true, data: applus.matchBom(load().index, (req.body && req.body.lines) || []) });
});

router.post('/diff', function(req, res) {
    try {
        res.json({ success: true, data: applus.diffLevel1(load().boms, req.body.head, req.body.lines || []) });
    } catch (e) {
        res.status(404).json({ success: false, message: e.message });
    }
});

function orderBom(body) {
    const { boms, index } = load();
    const result = applus.checkOrderBom(index, (body && body.lines) || []);
    const fm     = applus.orderLevel1(result.lines);
    const root   = result.lines.find(l => l.parent === null) || {};
    result.exports = Object.keys(boms).length;
    result.heads   = applus.rankHeads(boms, index, fm, [root.article].concat(Object.keys(root.executions || {})));
    if (body && body.head) result.diff = applus.diffLevel1(boms, body.head, fm);
    return result;
}

router.post('/order-bom', function(req, res) {
    try {
        res.json({ success: true, data: orderBom(req.body) });
    } catch (e) {
        res.status(404).json({ success: false, message: e.message });
    }
});

const STATUS = {
    IN_APPLUS      : 'In APplus-Export vorhanden',
    BOM_MATCH      : 'Stückliste in APplus vorhanden',
    TO_CREATE      : 'In APplus anlegen',
    CHECK_MASTER   : 'Gegen Artikelstamm prüfen',
    NOT_IN_EXPORTS : 'Nicht in den Exporten',
    NO_ARTICLE     : 'Ohne Artikel'
};

const TONE = { green: 'FFD2E9B0', yellow: 'FFF7CC93', blue: 'FFCDEAF7', red: 'FFFBD4D4' };

router.post('/order-bom/excel', async function(req, res) {
    let result;
    try { result = orderBom(req.body); } catch (e) { return res.status(404).json({ success: false, message: e.message }); }
    const { lines, toCreate, summary, diff } = result;
    const workbook = new ExcelJS.Workbook();
    const sheet = (name, columns, rows) => {
        const ws = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
        ws.columns = columns.map(([header, width]) => ({ header, width }));
        ws.addRows(rows);
        ws.getRow(1).font = { bold: true };
        return ws;
    };
    sheet('Auftragsstückliste', [['Pos.', 12], ['Artikel', 12], ['Kennung', 24], ['Benennung', 50], ['Menge', 8], ['Gesamtmenge', 13],
                                 ['Werkstoff', 20], ['Prüfung', 30], ['APplus-Stückliste', 18]],
        lines.filter(l => l.status !== 'MERGED').map(l => [l.pos, l.article, l.number, l.title, l.qty, l.totalQty, l.material,
                                                           STATUS[l.status], (l.heads || []).join(', ')]));
    sheet('Anzulegen', [['Artikel', 12], ['Kennung', 24], ['Benennung', 50], ['Werkstoff', 20], ['Basis-Item', 24], ['Grund', 44]],
        toCreate.map(l => [l.article, l.number, l.title, l.material, l.base,
                           l.status === 'TO_CREATE' ? 'Neue Baugruppe, keine passende APplus-Stückliste' : 'Gewählter Artikel, gegen Artikelstamm prüfen']));
    if (diff) {
        const ws = sheet('Differenz', [['Ergebnis', 46], ['Artikel APplus', 14], ['Benennung APplus', 40], ['Pos. APplus', 12], ['Menge APplus', 13], ['Einheit', 8],
                                       ['Ausführung', 11], ['Artikel Fusion', 14], ['Position Fusion', 50], ['Menge Fusion', 13]],
            diff.map(d => [d.text, d.article, d.name, d.pos, d.applusQty, d.unit, d.slot, d.fmArticle, d.fmLabel, d.fmQty]));
        diff.forEach((d, i) => {
            for (let c = 1; c <= ws.columnCount; c++) ws.getRow(i + 2).getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TONE[d.tone] } };
        });
    }
    sheet('Hinweise', [['Hinweis', 110]], [
        [req.body.title || ''],
        [diff ? 'Differenz auf Ebene 1 gegen APplus-Stückliste ' + req.body.head + '.' : 'Keine Differenz gewählt.'],
        ['Geprüft gegen ' + result.exports + ' APplus-Stücklisten-Exporte, nicht gegen den Artikelstamm.'],
        ['"Nicht in den Exporten" heißt nicht, dass der Artikel in APplus fehlt.'],
        [(summary.MERGED || 0) + ' Positionen mit demselben Artikel wie ihre Baugruppe sind nicht als eigene Zeile aufgeführt (Annahme, Klärung in #23488).']
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="auftragsstueckliste.xlsx"');
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
});

module.exports = router;
