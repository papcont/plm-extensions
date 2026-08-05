const fs = require('fs');
const path = require('path');
const pug = require('pug');
const settings = require('../settings');
const router = require('../routes/landing');

const root = path.resolve(__dirname, '..');
const routePaths = new Set(router.stack.filter(layer => layer.route).map(layer => layer.route.path));
const archetypes = settings.applications.workspaceHealth?.archetypes || [];
const failures = [];

function endpointName(endpoint) {
    return String(endpoint || '').replace(/^\//, '');
}

function settingsKey(endpoint) {
    return endpointName(endpoint).replace(/-([a-z0-9])/g, function(match, letter) {
        return letter.toUpperCase();
    });
}

function exists(relative) {
    return fs.existsSync(path.join(root, relative));
}

function render(relative, title) {
    pug.renderFile(path.join(root, relative), {
        settings,
        title,
        tenantLink: 'https://contelosuxdemo.autodeskplm360.net',
        user: { displayName: 'Verifier' },
        block: '',
        insertPanel: function() { return ''; },
        insertFlyout: function() { return ''; },
        insertMenu: function() { return ''; }
    });
}

for (const archetype of archetypes) {
    const endpoint = archetype.url;
    const name = endpointName(endpoint);
    const key = settingsKey(endpoint);
    const appView = `views/apps/${name}.pug`;
    const adminView = `views/admin/${name}.pug`;
    const appScript = `public/javascripts/apps/${name}.js`;
    const adminScript = `public/javascripts/admin/${name}.js`;
    const view = exists(appView) ? appView : exists(adminView) ? adminView : '';
    const script = exists(appScript) ? appScript : exists(adminScript) ? adminScript : '';

    if (!routePaths.has(endpoint)) failures.push(`${endpoint}: route missing`);
    if (!settings.server.servicesEnabled[name]) failures.push(`${endpoint}: service flag missing`);
    if (!settings.applications[key]) failures.push(`${endpoint}: settings key ${key} missing`);
    if (!view) failures.push(`${endpoint}: view missing`);
    if (!script) failures.push(`${endpoint}: script missing`);

    if (view) {
        try {
            render(view, archetype.name);
        } catch (error) {
            failures.push(`${endpoint}: Pug render failed: ${error.message}`);
        }
    }
}

if (failures.length > 0) {
    console.error(failures.join('\n'));
    process.exit(1);
}

console.log(`Verified ${archetypes.length} extension shell(s).`);
