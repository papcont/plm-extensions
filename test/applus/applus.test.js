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
    assert.strictEqual(by('ONLY_APPLUS')[0].article, '9000002');
    assert.strictEqual(by('ONLY_APPLUS')[0].candidate, 'FEOD-1 set screw (no number)');
    assert.deepStrictEqual(by('ONLY_FM').map(x => x.article), ['9999999']);
    assert.throws(() => applus.diffLevel1(boms(), '0000000', []), /not imported/);
});
