// One-off, explicitly authorised DEMO-tenant data corrections (not part of the app). Usage: node tmp/fm_fix.js [--apply]
// Touches ONLY: supplier items 34016 + 34013 (NAME) and the six PO items whose NOTES carry orderDate=2026-12-15.
const fs = require('fs');
const env = require('../environment.js');
const config = require('../services/sourcing/config'); config.applyDeployment(env);
const { createReadRepository } = require('../services/fusion/readRepository');
const { createFmTransport } = require('../services/iot/fmTransport');
const { field, decode } = require('../services/sourcing/fmDataSource');

const APPLY = process.argv.includes('--apply');
const base = config.fm.tenantLink;
const read = createReadRepository(config.fm);
const transport = createFmTransport(config.fm);

const PLAN = [
  { ws: 14, dms: '34016', fieldId: 'NAME', from: 'DEMO-SRC-SUP-005 Stahlhandel M?ller GmbH', to: 'DEMO-SRC-SUP-005 Stahlhandel Müller GmbH' },
  { ws: 14, dms: '34013', fieldId: 'NAME', from: 'DEMO-SRC-SUP-002 Las ertechnik Nord GmbH', to: 'DEMO-SRC-SUP-002 Lasertechnik Nord GmbH' },
];
const PO_DMS = ['34205', '34181', '34158', '34138', '34126', '34114'];

function sectionOf(d, fieldId) {
  for (const s of d.sections || []) for (const f of s.fields || []) if (String(f.__self__).split('/').pop() === fieldId) return { section: s.link, self: f.__self__, value: f.value };
  throw new Error('field ' + fieldId + ' not found');
}

(async () => {
  const log = [];
  for (const dms of PO_DMS) {
    const d = await read.getItem(147, dms);
    const raw = field(d, 'NOTES');
    if (!/demo&?#?61;?=?true|demo=true/.test(decode(raw)) || !/orderDate=2026-12-15/.test(decode(raw))) throw new Error('PO ' + dms + ' not a confirmed demo/future record');
    // keep the stored encoding style: replace only the date token inside the raw stored value
    const to = String(raw).replace(/orderDate(&#61;|=)2026-12-15/, 'orderDate$12025-12-15');   // what a read must return afterwards
    if (to === raw) throw new Error('PO ' + dms + ' no replacement made');
    PLAN.push({ ws: 147, dms, fieldId: 'NOTES', from: raw, to, write: decode(to) });   // write the plain text (FM escapes it itself)
  }
  for (const p of PLAN) {
    const d = await read.getItem(p.ws, p.dms);
    const cur = sectionOf(d, p.fieldId);
    if (cur.value !== p.from) throw new Error('precondition failed for ' + p.dms + ': current value differs from expected');
    p.section = cur.section; p.self = cur.self;
    log.push({ ws: p.ws, dms: p.dms, field: p.fieldId, before: p.from, after: p.to });
  }
  fs.writeFileSync('tmp/fm-corrections-plan.json', JSON.stringify(log, null, 1));
  console.log((APPLY ? 'APPLY' : 'DRY-RUN') + ' ' + PLAN.length + ' field updates');
  for (const l of log) console.log(l.ws, l.dms, l.field, '|', l.before.slice(-70), '->', l.after.slice(-70));
  if (!APPLY) return;
  const headers = { 'X-user-id': config.fm.impersonateUser, Accept: 'application/json', 'Content-Type': 'application/json' };
  for (const p of PLAN) {
    const body = { sections: [{ link: p.section, fields: [{ __self__: p.self, value: p.write || p.to }] }] };
    const r = await transport.patch(base + '/api/v3/workspaces/' + p.ws + '/items/' + p.dms, body, headers);
    const after = sectionOf(await read.getItem(p.ws, p.dms), p.fieldId).value;
    console.log('PATCH', p.ws, p.dms, 'HTTP', r.status, 'readback ok:', after === p.to);
    if (after !== p.to) { console.log('READBACK MISMATCH', JSON.stringify(after)); process.exit(2); }
  }
})().catch(e => { console.log('ERR', e.message, e.response && e.response.status, e.response && JSON.stringify(e.response.data).slice(0, 300)); process.exit(1); });
