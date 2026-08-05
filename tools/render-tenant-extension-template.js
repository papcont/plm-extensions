const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const root = path.resolve(__dirname, '..');
const tenant = process.argv[2] || 'contelosuxdemo';
const discoveryFile = process.argv[3] ? path.resolve(root, process.argv[3]) : path.join(root, 'docs', 'tenant-discovery', `${tenant}-initial.json`);
const outFile = path.join(root, 'docs', 'tenant-discovery', `${tenant}-extension-overrides.template.js`);
const archetypes = settings.applications.workspaceHealth?.archetypes || [];
const discovery = loadDiscovery(discoveryFile);

function endpointName(endpoint) {
    return String(endpoint || '').replace(/^\//, '');
}

function settingsKey(endpoint) {
    return endpointName(endpoint).replace(/-([a-z0-9])/g, function(match, letter) {
        return letter.toUpperCase();
    });
}

function workspaceIdsFor(key) {
    return settings.applications[key]?.workspaceIds || {};
}

function pad(value) {
    return String(value).padEnd(24, ' ');
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

const lines = [
    '// Tenant extension override template.',
    `// Tenant: ${tenant}`,
    '// Copy needed blocks into settings/<tenant>.js after confirming workspace IDs in Fusion Manage.',
    '// Do not commit secrets. Do not guess workspace IDs.',
    '',
    'exports.applications = {'
];

for (const archetype of archetypes) {
    const key = settingsKey(archetype.url);
    const ids = workspaceIdsFor(key);
    const keys = Object.keys(ids);
    if (keys.length === 0) continue;

    lines.push('', `    ${key} : {`, '', '        workspaceIds : {');
    for (const workspaceKey of keys) {
        const fallback = settings.common.workspaceIds?.[workspaceKey];
        const value = ids[workspaceKey] || fallback || null;
        const suffix = value ? ` // default/common: ${value}` : ' // TODO confirm tenant workspace ID';
        lines.push(`            ${pad(workspaceKey)} : null,${suffix}`);
    }
    lines.push('        }', '', '    },');
}

lines.push('', '};', '', 'exports.server = {', '    servicesEnabled : {');
for (const archetype of archetypes) {
    lines.push(`        '${endpointName(archetype.url)}' : false, // ${readiness(archetype)}`);
}
lines.push('    }', '};', '');

const serviceLines = lines.filter(line => /^\s*'[^']+'\s*:/.test(line));
if (serviceLines.length !== archetypes.length || serviceLines.some(line => !line.includes(': false,'))) {
    console.error('Tenant override template must keep generated services disabled by default.');
    process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, lines.join('\n'));
console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(`Default-disabled ${serviceLines.length} extension service flag(s).`);
