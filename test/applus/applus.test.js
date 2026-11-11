// APplus export parsing + the three editor lookups. Synthetic fixture shaped like the real export
// (SpreadsheetML, "(n) *" depth, sub-levels, mm units, an article listed twice) - no customer data in the repo.
const { test } = require('node:test');
const assert = require('node:assert');
const applus = require('../../services/applus/applus');

const HEADER = ['TIEFE', 'STUELI', 'POSITION', 'MENGE', 'VBME', 'ARTIKEL', 'NAME', 'VARIANTE', 'ABMESSUNG', 'E', 'A', 'S'];
const xml = rows => '<?xml version="1.0"?><Workbook><Worksheet ss:Name="APplus Data"><Table>' +
    [HEADER].concat(rows).map(r => '<Row>' + r.map(c => c === '' ? '<Cell></Cell>' : `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join('') + '</Row>').join('') +
    '</Table></Worksheet></Workbook>';

// Two variants of one assembly: they differ only in the holder (9000011 vs 9000021).
const A = xml([
    ['(1) *',  '9000100', '10', '1.000', 'Stück', '9000001', 'Wiper &amp; seal', '', '', '*', '', ''],
    ['(1) *',  '9000100', '20', '1.000', 'Stück', '9000011', 'Holder ø40',       '', '', '*', '', '*'],
    ['(2) **', '9000011', '10', '30.000', 'mm',   '9000050', 'Round bar 80',     '', '', '', '', ''],
    ['(1) *',  '9000100', '30', '2.000', 'Stück', '9000002', 'Set screw M5',     '', '', '', '', ''],
    ['(1) *',  '9000100', '40', '1.000', 'Stück', '9000002', 'Set screw M5',     '', '', '', '', '']   // same article twice
]);
const B = xml([
    ['(1) *', '9000200', '1', '1.000', 'Stück', '9000021', 'Holder ø40', '', '', '', '', '*'],
    ['(1) *', '9000200', '2', '1.000', 'Stück', '9000001', 'Wiper',      '', '', '', '', ''],
    ['(1) *', '9000200', '3', '3.000', 'Stück', '9000002', 'Set screw',  '', '', '', '', '']
]);

function boms() {
    const out = {};
    for (const [name, x] of [['9000100.xls', A], ['9000200.xls', B]]) {
        const b = applus.parseExport(x, name);
        out[b.head] = { file: name, rows: b.rows };
    }
    return out;
}

test('parseExport: head, levels, units, entities', () => {
    const b = applus.parseExport(A, '9000100.xls');
    assert.strictEqual(b.head, '9000100');
    assert.strictEqual(b.rows.length, 5);
    assert.strictEqual(applus.level1(b).length, 4);
    assert.deepStrictEqual(b.rows.map(r => r.level), [1, 1, 2, 1, 1]);
    assert.strictEqual(b.rows[0].name, 'Wiper & seal');
    assert.strictEqual(b.rows[0].unit, 'Stk');
    assert.strictEqual(b.rows[2].unit, 'mm');
    assert.strictEqual(b.rows[2].qty, 30);
    assert.strictEqual(b.rows[1].hasBom, true);
});

test('diffLevel1: an APplus article at two positions is one line with the summed quantity', () => {
    const d = applus.diffLevel1(boms(), '9000100', [
        { article: '9000001', qty: 1 }, { article: '9000011', qty: 1 }, { article: '9000002', qty: 2 }, { article: '9000002', qty: 1 }
    ]);
    assert.ok(d.every(x => x.status === 'MATCH'), JSON.stringify(d));
    assert.strictEqual(d.find(x => x.article === '9000002').pos, '30, 40');
});

test('diffLevel1: a sub-BOM contained in two exports counts once', () => {
    const b = boms();
    b.copy = { file: 'copy.xls', rows: b['9000200'].rows };
    const d = applus.diffLevel1(b, '9000200', [{ article: '9000002', qty: 3 }]);
    assert.strictEqual(d.find(x => x.article === '9000002').applusQty, 3);
});

test('diffLevel1: executions find the position, exact articles keep theirs', () => {
    const d = applus.diffLevel1(boms(), '9000200', [
        { article: '',        executions: { 9000011: 1, 9000021: 2 }, qty: 1, label: 'number list' },   // no article: reads off the Ausführung
        { article: '9000099', executions: { 9000099: 1, 9000001: 2 }, qty: 1, label: 'other choice' },
        { article: '9000002', executions: { 9000002: 1, 9000021: 2 }, qty: 3, label: 'exact' }          // must not take 9000021 away
    ]);
    const by = a => d.find(x => x.article === a);
    assert.deepStrictEqual([by('9000021').status, by('9000021').slot, by('9000021').fmLabel], ['MATCH', 2, 'number list']);
    assert.deepStrictEqual([by('9000001').status, by('9000001').slot, by('9000001').fmArticle], ['OTHER_EXECUTION', 2, '9000099']);
    assert.strictEqual(by('9000002').status, 'MATCH');
    assert.strictEqual(d.length, 3);
});

test('diffLevel1: only-APplus classes', () => {
    const d = applus.diffLevel1(boms(), '9000200', [
        { id: 'r1', article: '9000021', qty: 1 },
        { id: 'r2', article: '8000001', qty: 3, name: 'Set screw M6', label: 'other screw' },
        { id: 'r3', article: '8000002', qty: 7, name: 'Plate', label: 'plate' }
    ]);
    const by = a => d.find(x => x.article === a);
    assert.deepStrictEqual([by('9000021').fmIds, by('9000002').fmIds, d.find(x => x.status === 'ONLY_FM').fmIds], [['r1'], ['r2'], ['r3']]);
    assert.deepStrictEqual([by('9000002').status, by('9000002').fmArticle], ['ARTICLE_DIFF', '8000001']);
    assert.strictEqual(by('9000001').status, 'NO_MODEL');
    assert.deepStrictEqual(d.filter(x => x.status === 'ONLY_FM').map(x => x.fmArticle), ['8000002']);
    assert.ok(d.every(x => x.text && x.tone), 'every row has a text and a colour');
    assert.deepStrictEqual([by('9000021').tone, by('9000002').tone, by('9000001').tone], ['green', 'yellow', 'red']);
    assert.strictEqual(d.find(x => x.status === 'ONLY_FM').tone, 'blue');
});

test('rankHeads: own article first, then the share of known articles', () => {
    const b = boms(), index = applus.buildIndex(b);
    const fm = [{ article: '9000021' }, { article: '9000001' }, { article: '9000002' }];
    assert.deepStrictEqual(applus.rankHeads(b, index, fm, []).map(h => h.head), ['9000200', '9000100']);
    assert.deepStrictEqual(applus.rankHeads(b, index, fm, ['9000100']).map(h => h.head), ['9000100', '9000200']);
    assert.strictEqual(applus.rankHeads(b, index, [{ article: '1' }], []).length, 0);
});

test('diffTree: descends where both sides have a BOM, APplus rows below a Fusion part are UNDER_PART', () => {
    const line = (id, parent, article, qty = 1) => ({ id, parent, article, qty, number: id, title: 't' + id });
    const base = [line('r', null, ''), line('a', 'r', '9000001'), line('c', 'r', '9000002', 3)];
    // holder modelled as a part: its round bar exists only in APplus
    const asPart = applus.diffTree(boms(), '9000100', base.concat(line('h', 'r', '9000011')));
    assert.deepStrictEqual(asPart.map(l => [l.id, l.head, l.depth, l.underPart]), [['r', '9000100', 0, false], ['h', '9000011', 1, true]]);
    assert.deepStrictEqual(asPart[1].diff.map(d => [d.article, d.status, d.tone]), [['9000050', 'UNDER_PART', 'gray']]);
    assert.strictEqual(asPart[1].name, 'Holder ø40');
    // holder modelled as an assembly with the bar: compared on level 2
    const asAssembly = applus.diffTree(boms(), '9000100', base.concat(line('h', 'r', '9000011'), Object.assign(line('b', 'h', '9000050', 30), { unit: 'mm' })));
    assert.deepStrictEqual(asAssembly[1].diff.map(d => [d.article, d.status, d.fmIds]), [['9000050', 'MATCH', ['b']]]);
    assert.strictEqual(asAssembly[1].parent, 'r');
    // a position without article is only a candidate for the holder: no descent into the holder's BOM
    const candidate = applus.diffTree(boms(), '9000100', base.concat(line('h', 'r', '')));
    assert.strictEqual(candidate[0].diff.find(d => d.article === '9000011').status, 'CANDIDATE');
    assert.strictEqual(candidate.length, 1);
});

test('rankHeads: a variant ranks the BOM of its chosen Ausführung first, not the base BOM', () => {
    const b = boms(), index = applus.buildIndex(b);
    // holder 9000021 chosen, 9000011 only reachable as Ausführung 1; both heads are "own" (inherited GEN-TITLE)
    const fm = [{ article: '9000021', executions: { 9000011: 1, 9000021: 2 } }, { article: '9000001' }, { article: '9000002' }];
    assert.deepStrictEqual(applus.rankHeads(b, index, fm, ['9000100', '9000200']).map(h => h.head), ['9000200', '9000100']);
});

test('checkOrderBom: statuses, BOM match, dedup of the create list', () => {
    const index = applus.buildIndex(boms());
    const line = (id, parent, article, extra) => Object.assign({ id, parent, article, qty: 1, assembly: false, variant: false, number: 'N' + id }, extra);
    const { lines, toCreate, summary } = applus.checkOrderBom(index, [
        line('root', null, '', { assembly: true, variant: true }),
        line('a', 'root', '', { assembly: true, variant: true }),         // same level 1 as APplus 9000200
        line('a1', 'a', '9000021'), line('a2', 'a', '9000001'), line('a3', 'a', '9000002', { qty: 3 }),
        line('b', 'root', '8000001', { assembly: true }),                 // CAD article, not in the exports
        line('b1', 'b', '8000001'),                                       // weldment profile: same article as its parent
        line('c', 'root', '8000002', { variant: true }),                  // chosen article
        line('d', 'root', '8000002', { variant: true }),                  // the same item at a second position
        line('e', 'root', ''),                                            // CAD item without article
        line('f', 'root', '', { assembly: true, variant: true }),         // generated, an open position rules out a match
        line('f1', 'f', '')
    ]);
    const status = Object.fromEntries(lines.map(l => [l.id, l.status]));
    assert.strictEqual(status.a, 'BOM_MATCH');
    assert.deepStrictEqual(lines.find(l => l.id === 'a').heads, ['9000200']);
    assert.strictEqual(status.a1, 'IN_APPLUS');
    assert.strictEqual(status.b, 'NOT_IN_EXPORTS');
    assert.strictEqual(status.b1, 'MERGED');
    assert.strictEqual(status.c, 'CHECK_MASTER');
    assert.strictEqual(status.e, 'NO_ARTICLE');
    assert.strictEqual(status.f, 'TO_CREATE');
    assert.strictEqual(status.root, 'TO_CREATE');
    assert.deepStrictEqual(toCreate.map(l => l.id), ['root', 'c', 'f']);
    assert.strictEqual(summary.CHECK_MASTER, 2);
});

test('checkOrderBom: a sub-assembly found by its BOM counts with that article in the parent', () => {
    const index = applus.buildIndex({ X: { file: 'x', rows: [
        { level: 1, parent: '9000300', pos: '1', qty: 1, unit: 'Stk', article: '9000200', name: '' },
        { level: 1, parent: '9000300', pos: '2', qty: 2, unit: 'Stk', article: '9000001', name: '' }
    ]}, Y: boms()['9000200'] });
    const line = (id, parent, article, extra) => Object.assign({ id, parent, article, qty: 1, assembly: false, variant: false }, extra);
    const { lines } = applus.checkOrderBom(index, [
        line('root', null, '', { assembly: true, variant: true }),
        line('sub', 'root', '', { assembly: true, variant: true }),
        line('s1', 'sub', '9000021'), line('s2', 'sub', '9000001'), line('s3', 'sub', '9000002', { qty: 3 }),
        line('p', 'root', '9000001', { qty: 2 })
    ]);
    assert.deepStrictEqual(lines[0].heads, ['9000300']);
});

test('parseExport rejects a non-BOM sheet', () => {
    assert.throws(() => applus.parseExport('<Row><Cell><Data>foo</Data></Cell></Row>', 'x.xls'), /not an APplus BOM export/);
});

test('fingerprint: order-independent, sums duplicates, unit-sensitive', () => {
    const fp = applus.fingerprint;
    assert.strictEqual(fp([{ article: '1', qty: 1 }, { article: '2', qty: 2 }]), fp([{ article: '2', qty: '2.000' }, { article: '1', qty: 1, unit: 'Stück' }]));
    assert.strictEqual(fp([{ article: '2', qty: 1 }, { article: '2', qty: 1 }]), fp([{ article: '2', qty: 2 }]));
    assert.notStrictEqual(fp([{ article: '1', qty: 1 }]), fp([{ article: '1', qty: 1, unit: 'mm' }]));
});

test('matchBom finds the APplus assembly with the same level-1 composition', () => {
    const index = applus.buildIndex(boms());
    // the variant the editor would produce: holder 9000021 instead of 9000011
    assert.deepStrictEqual(applus.matchBom(index, [{ article: '9000021', qty: 1 }, { article: '9000001', qty: 1 }, { article: '9000002', qty: 3 }]), ['9000200']);
    assert.deepStrictEqual(applus.matchBom(index, [{ article: '9000001', qty: 1 }, { article: '9000011', qty: 1 }, { article: '9000002', qty: 3 }]), ['9000100']);
    assert.deepStrictEqual(applus.matchBom(index, [{ article: '9000001', qty: 1 }]), []);
    // sub-BOMs inside an export are matchable assemblies as well
    assert.deepStrictEqual(applus.matchBom(index, [{ article: '9000050', qty: 30, unit: 'mm' }]), ['9000011']);
});

test('lookup: existence, where-used, assemblies incl. file heads', () => {
    const r = applus.lookup(applus.buildIndex(boms()), ['9000002', '9000100', '1234567']);
    assert.deepStrictEqual(r[0].usedIn.sort(), ['9000100', '9000200']);
    assert.strictEqual(r[1].found, true);
    assert.strictEqual(r[1].hasBom, true);
    assert.strictEqual(r[2].found, false);
});

test('diffLevel1: match, qty diff, only-APplus with CAD candidate, only-FM', () => {
    const d = applus.diffLevel1(boms(), '9000200', [
        { article: '9000021', qty: 1, label: 'holder' },
        { article: '9000001', qty: 2, label: 'wiper' },
        { article: '',        qty: 3, label: 'FEOD-1 set screw (no number)' },
        { article: '9999999', qty: 1, label: 'extra' }
    ]);
    const by = s => d.filter(x => x.status === s);
    assert.strictEqual(by('MATCH').length, 1);
    assert.strictEqual(by('QTY_DIFF')[0].article, '9000001');
    assert.strictEqual(by('CANDIDATE')[0].article, '9000002');
    assert.strictEqual(by('CANDIDATE')[0].fmLabel, 'FEOD-1 set screw (no number)');
    assert.deepStrictEqual(by('ONLY_FM').map(x => x.fmArticle), ['9999999']);
    assert.throws(() => applus.diffLevel1(boms(), '0000000', []), /not imported/);
});
