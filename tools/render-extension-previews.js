const fs = require('fs');
const path = require('path');
const pug = require('pug');
const settings = require('../settings');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'storage', 'extension-previews');
const archetypes = settings.applications.workspaceHealth?.archetypes || [];
const discoveryFile = process.argv[2] ? path.resolve(root, process.argv[2]) : path.join(root, 'docs', 'tenant-discovery', 'contelosuxdemo-initial.json');
const discovery = loadDiscovery(discoveryFile);
const tenant = discovery.tenant || path.basename(discoveryFile).replace(/\.(json|txt)$/i, '').replace(/-(initial|workspace-manager.*)$/i, '') || 'contelosuxdemo';

function endpointName(endpoint) {
    return String(endpoint || '').replace(/^\//, '');
}

function settingsKey(endpoint) {
    return endpointName(endpoint).replace(/-([a-z0-9])/g, function(match, letter) {
        return letter.toUpperCase();
    });
}

function findView(name) {
    for (const relative of [`views/apps/${name}.pug`, `views/admin/${name}.pug`]) {
        if (fs.existsSync(path.join(root, relative))) return relative;
    }
    return '';
}

function loadDiscovery(file) {
    if (!fs.existsSync(file)) return { workspaces: [] };
    const text = fs.readFileSync(file, 'utf8');
    rejectAuthPageDiscovery(text, file);
    try {
        const parsed = JSON.parse(text);
        rejectAuthPageDiscovery(JSON.stringify(parsed), file);
        return parsed;
    } catch {
        if (/\.json$/i.test(file)) {
            console.error(`Discovery JSON could not be parsed: ${path.relative(root, file)}`);
            process.exit(1);
        }
        return parseWorkspaceText(text);
    }
}

function rejectAuthPageDiscovery(text, file) {
    if (!/Bei Autodesk anmelden|Autodesk-Konto erstellen|E-Mail-Adresse zur Anmeldung|OAuth authorization|Anwendung autorisieren|Erlauben/.test(text)) return;
    console.error(`Discovery file is an Autodesk login/authorization page, not Workspace Manager evidence: ${path.relative(root, file)}`);
    process.exit(1);
}

function parseWorkspaceText(text) {
    const typeLabels = ['Revision controlled', 'Mit Revisionskontrolle', 'Revisioning', 'Revisionierung', 'Basic with workflow', 'Basis mit Arbeitsablauf'];
    const skip = new Set(['settings', 'code', 'group', 'schema', 'Only in this workspace', 'Nur in diesem Arbeitsbereich', 'Home', 'Start', 'Workspace Manager', 'Arbeitsbereich-Manager', 'Create workspace', 'Arbeitsbereich erstellen', 'Create category', 'Kategorie erstellen', 'Template library', 'Vorlagenbibliothek', 'Name', 'Description', 'Beschreibung', 'Type', 'Typ']);
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const workspaces = [];
    let category = '';

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/\(\d+\)$/.test(line)) {
            category = line.replace(/\s+\(\d+\)$/, '');
            continue;
        }
        if (skip.has(line)) continue;

        const next = lines[index + 1] || '';
        const afterNext = lines[index + 2] || '';
        const nextIsType = typeLabels.includes(next);
        const afterNextIsType = typeLabels.includes(afterNext);
        if (!nextIsType && !afterNextIsType) continue;

        workspaces.push({
            category: category || 'Visible section',
            name: line,
            description: afterNextIsType ? next : '',
            type: nextIsType ? next : afterNext
        });
        index += nextIsType ? 1 : 2;
    }

    return { workspaces };
}

function hasKeyword(value, keywords) {
    const text = String(value || '').toLowerCase();
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

function readiness(archetype) {
    return (discovery.workspaces || []).some(workspace => hasKeyword(workspace.name, archetype.keys || []))
        ? 'demo candidate; browser check needed'
        : 'preview only; tenant evidence needed';
}

function previewLocals(archetype) {
    return {
        title: archetype.name,
        tenant,
        tenantLink: `https://${tenant}.autodeskplm360.net`,
        theme: 'light',
        host: '',
        wsId: '',
        dmsId: '',
        descriptor: '',
        number: '',
        fileId: '',
        vaultId: '',
        language: '',
        revisionBias: 'release',
        options: '',
        type: '',
        common: settings.common,
        config: settings.applications[settingsKey(archetype.url)] || {},
        menu: settings.menu,
        colors: settings.colors || {},
        debugMode: false
    };
}

fs.mkdirSync(outDir, { recursive: true });

const rows = [];
const htmlRows = [];
for (const archetype of archetypes) {
    const name = endpointName(archetype.url);
    const view = findView(name);
    if (!view) continue;

    const html = pug.renderFile(path.join(root, view), previewLocals(archetype))
        .replaceAll('href="/', 'href="../../public/')
        .replaceAll("href='/", "href='../../public/")
        .replaceAll('src="/', 'src="../../public/')
        .replaceAll("src='/", "src='../../public/");
    const file = `${name}.html`;
    const status = readiness(archetype);
    fs.writeFileSync(path.join(outDir, file), html);
    rows.push(`- [${archetype.name}](${file}) - ${status}`);
    htmlRows.push(`<li><a href="${file}">${archetype.name}</a><span>${status}</span></li>`);
}

fs.writeFileSync(path.join(outDir, 'index.md'), [
    '# Extension Previews',
    '',
    `Generated by \`node tools/render-extension-previews.js ${path.relative(root, discoveryFile).replace(/\\/g, '/')}\`.`,
    `Discovery: \`${path.relative(root, discoveryFile).replace(/\\/g, '/')}\`.`,
    'Use these local previews when OAuth blocks live tenant UI review. Enable tenant services only after browser verification.',
    '',
    ...rows,
    ''
].join('\n'));

fs.writeFileSync(path.join(outDir, 'index.html'), [
    '<!doctype html>',
    '<html>',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '  <title>Extension Previews</title>',
    '  <style>body{font:14px Arial,sans-serif;margin:32px;line-height:1.5} li{margin:8px 0} span{color:#666;margin-left:8px}</style>',
    '</head>',
    '<body>',
    '  <h1>Extension Previews</h1>',
    `  <p>Generated by <code>node tools/render-extension-previews.js ${path.relative(root, discoveryFile).replace(/\\/g, '/')}</code>. Use these local previews when OAuth blocks live tenant UI review.</p>`,
    `  <p>Discovery: <code>${path.relative(root, discoveryFile).replace(/\\/g, '/')}</code>.</p>`,
    '  <ul>',
    ...htmlRows.map(row => `    ${row}`),
    '  </ul>',
    '</body>',
    '</html>',
    ''
].join('\n'));

console.log(`Rendered ${rows.length} preview(s) to ${path.relative(root, outDir)}.`);
