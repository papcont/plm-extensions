// APplus export data for the Variant BOM Editor (Feige). Feige provides APplus BOM exports as files; there is
// no APplus interface. Imported exports are kept as JSON in storage/applus/ (same pattern as storage/erp/).
//
//   POST /applus/import  { files: [{ name, content }] }   content = the export's XML text
//   GET  /applus/summary
//   POST /applus/lookup  { articles: ['2034147', ...] }    -> existence per article
//   POST /applus/match   { lines: [{ article, qty, unit }] } -> APplus BOMs with exactly this level-1 composition
//   POST /applus/diff    { head, lines: [{ article, qty, unit, label }] } -> level-1 difference list

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
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

module.exports = router;
