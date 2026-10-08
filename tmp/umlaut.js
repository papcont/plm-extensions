const env = require('../environment.js');
const config = require('../services/sourcing/config'); config.applyDeployment(env);
const { createReadRepository } = require('../services/fusion/readRepository');
const { field } = require('../services/sourcing/fmDataSource');
const map = require('../docs/features/intelligent-sourcing/FM-DEMO-MAPPING.json');
(async()=>{
 const r = createReadRepository(config.fm);
 for (const [k,id] of Object.entries(map.suppliers.dmsIds)) {
   const d = await r.getItem(14,id);
   const n = field(d,'NAME'); const raw = JSON.stringify(d).match(/"title":"([^"]*)"/);
   const bad = [...String(n)].filter(c=>c==='?'||c.charCodeAt(0)>127||c.charCodeAt(0)<32).map(c=>c.charCodeAt(0).toString(16));
   console.log(k,id,JSON.stringify(n),'descriptor:',raw&&raw[1],'odd:',bad.join(','));
 }
})().catch(e=>console.log('ERR',e.message));
