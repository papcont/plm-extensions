const env = require('../environment.js');
const config = require('../services/sourcing/config'); config.applyDeployment(env);
const { createReadRepository } = require('../services/fusion/readRepository');
const { field, pairs } = require('../services/sourcing/fmDataSource');
(async()=>{
 const r = createReadRepository(config.fm);
 const it = await r.getItem(57,'34051');
 console.log('ITEM', field(it,'TITLE'), JSON.stringify(pairs(field(it,'DESCRIPTION'))), field(it,'MATERIAL'), field(it,'LENGTH'), field(it,'WIDTH'), field(it,'HEIGHT'));
 const map=require('../docs/features/intelligent-sourcing/FM-DEMO-MAPPING.json');
 const cap = await r.getItem(63, map.capabilities.dmsIds['001']);
 console.log('CAP', JSON.stringify(pairs(field(cap,'COMMENTS'))), field(cap,'LEAD_TIME'));
 const i3 = await r.getItem(57,'34053'); console.log('I', field(i3,'NUMBER'), field(i3,'TITLE'));
})().catch(e=>console.log('ERR',e.message));
