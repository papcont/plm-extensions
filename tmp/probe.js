const env = require('../environment.js');
const config = require('../services/sourcing/config'); config.applyDeployment(env);
const { createSourcingService } = require('../services/sourcing/service');
const { createReadRepository } = require('../services/fusion/readRepository');
const { createFmDataSource } = require('../services/sourcing/fmDataSource');
const { createHybridDataSource } = require('../services/sourcing/dataSource');
(async () => {
  const fm = createFmDataSource({ config: config.fm, readRepository: createReadRepository(config.fm) });
  const mode = process.argv[2];
  const s = createSourcingService({ config, source: mode === 'hybrid' ? createHybridDataSource(fm) : fm });
  const a = await s.analyze({ itemId: 'U-HALTER-800', quantity: 20, requiredDate: '2026-11-15' });
  require('fs').writeFileSync('tmp/probe-' + mode + '.json', JSON.stringify(a, null, 1));
  console.log(mode, a.summary, a.recommendedSupplierId, a.candidates.length, a.similarityEvidence.length, a.standardAlternatives.length);
  a.candidates.forEach(c => console.log(c.supplierId, c.name, c.technicalStatus, c.overallScore, c.leadTimeDays, c.unitPrice, c.purchaseCount, c.missingData.join('|')));
})().catch(e => console.log('ERR', e.message));
