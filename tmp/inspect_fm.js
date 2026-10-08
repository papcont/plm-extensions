const env = require('../environment.js');
const config = require('../services/sourcing/config'); config.applyDeployment(env);
const { createReadRepository } = require('../services/fusion/readRepository');
const { field, pairs, decode } = require('../services/sourcing/fmDataSource');
(async()=>{
 const r = createReadRepository(config.fm);
 for (const id of ['34016','34013']) {
   const d = await r.getItem(14,id);
   for (const s of d.sections||[]) for (const f of s.fields||[]) if (/NAME$/.test(f.__self__)) console.log(id,'section',s.link,'field',f.__self__,'value',JSON.stringify(f.value), 'type', f.type||f.fieldType);
   console.log(id,'keys',Object.keys(d).join(','), 'lock?', d.lockedBy||d.workflowState||'');
 }
 const all = await r.listAllItems(147,{maxItems:500});
 console.log('PO list count', all.length);
 const rows=[];
 for (const it of all) { const id=String(it.__self__).split('/').pop(); if(!/DEMO-SRC-PO-\d{4}/.test(it.descriptor||'')) continue; const d=await r.getItem(147,id); const p=pairs(field(d,'NOTES')); if ((p.orderDate||'')>'2026-10-07') rows.push({dms:id, desc:it.descriptor, orderDate:p.orderDate, item:p.item, supplier:p.supplier, notes:decode(field(d,'NOTES'))}); }
 console.log(JSON.stringify(rows,null,1));
})().catch(e=>console.log('ERR',e.message, e.response&&e.response.status));
