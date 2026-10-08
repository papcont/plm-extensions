// Local review harness (NOT the app server): serves only /intelligent-sourcing + /sourcing with live FM read-only access.
// usage: SOURCING_DATA_SOURCE=hybrid node tmp/harness.js 3901
const path = require('path'), express = require('express');
const root = path.resolve(__dirname, '..');
const env = require(root + '/environment.js');
require(root + '/services/sourcing/config').applyDeployment(env);
const settings = require(root + '/settings.js');
const app = express();
app.set('views', root + '/views'); app.set('view engine', 'pug');
app.use(express.json());
app.use(express.static(root + '/public'));
app.use('/sourcing', require(root + '/routes/sourcing'));
app.get('/intelligent-sourcing', (req, res) => res.render('apps/intelligent-sourcing', { title: 'Intelligent Sourcing', tenant: env.tenant, tenantLink: '', theme: req.query.theme || env.defaultTheme || 'dark',
  wsId: '', dmsId: '', descriptor: '', number: '', fileId: '', language: '', type: '', revisionBias: 'release', options: [''], debugMode: false, common: settings.common,
  config: settings.applications.intelligentSourcing, menu: settings.menu, colors: settings.colors, host: '', vaultId: '' }));
app.listen(Number(process.argv[2]), '127.0.0.1', () => console.log('harness', require(root + '/services/sourcing/config').dataSource, process.argv[2]));
