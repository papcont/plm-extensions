const fs = require('fs');
const path = require('path');
const settings = require('../settings');

const root = path.resolve(__dirname, '..');
const outFile = path.resolve(root, process.argv[2] || 'docs/USECASE-MINER-REPORT.md');
const discoveryFile = process.argv[3] ? path.resolve(root, process.argv[3]) : null;
const backlogFile = path.resolve(root, 'docs/EXTENSION-CANDIDATE-BACKLOG.md');
const briefFile = path.resolve(root, 'docs/EXTENSION-PORTFOLIO-BRIEF.md');
const pitchFile = path.resolve(root, 'docs/EXTENSION-PITCH-CARDS.md');
const reuseFile = path.resolve(root, 'docs/EXTENSION-REUSE-MAP.md');
const adoptionFile = path.resolve(root, 'docs/TENANT-EXTENSION-ADOPTION-MATRIX.md');
const scanQueueFile = path.resolve(root, 'docs/BROWSER-TENANT-SCAN-QUEUE.md');
const whitespaceFile = path.resolve(root, 'docs/EXTENSION-WHITESPACE-RADAR.md');
const promotionFile = path.resolve(root, 'docs/EXTENSION-PROMOTION-QUEUE.md');
const coverageFile = path.resolve(root, 'docs/TENANT-DISCOVERY-COVERAGE.md');
const workspaceUsecaseFile = path.resolve(root, 'docs/TENANT-WORKSPACE-USECASE-MAP.md');
const decisionGatesFile = path.resolve(root, 'docs/USECASE-DECISION-GATES.md');
const manifestFile = path.resolve(root, 'docs/USECASE-AUTOMATION-MANIFEST.json');

const workspaceIds = settings.common?.workspaceIds || {};
const applications = settings.applications || {};
const menu = settings.menu || [];
const discovery = loadDiscovery(discoveryFile);
const graphifyAst = loadGraphifyAst();

const clusters = (applications.workspaceHealth?.archetypes || []).map(archetype => ({
    name: archetype.name,
    keywords: archetype.keys || [],
    mvp: archetype.url
}));
const candidateAppKeys = new Set(['workspaceHealth', ...clusters.map(cluster => endpointToSettingsKey(cluster.mvp))]);
const panelCatalog = [
    { name: 'insertSearch', purpose: 'find workspace records before a cockpit selection', keywords: ['project', 'supplier', 'service', 'quality', 'requirement', 'test', 'item', 'document'] },
    { name: 'insertResults', purpose: 'show workspace queues and blocker lists', keywords: ['project', 'supplier', 'service', 'quality', 'change', 'review', 'request'] },
    { name: 'insertDetails', purpose: 'render selected record details and missing data', keywords: ['item', 'document', 'project', 'supplier', 'asset', 'service', 'quality', 'requirement', 'review', 'release', 'variant', 'passport', 'traceability', 'compliance'] },
    { name: 'insertAttachments', purpose: 'surface evidence files, drawings, and review documents', keywords: ['document', 'attachment', 'evidence', 'review', 'test', 'quality', 'passport', 'release'] },
    { name: 'insertGrid', purpose: 'reuse editable/read-only tabular child data', keywords: ['task', 'package', 'line', 'part', 'validation', 'supplier', 'service'] },
    { name: 'insertBOM', purpose: 'show item structure and affected product context', keywords: ['bom', 'item', 'part', 'variant', 'service', 'release', 'traceability'] },
    { name: 'insertBOMPartsList', purpose: 'show BOM rows as a work queue', keywords: ['bom', 'part', 'spare', 'service', 'supplier', 'passport'] },
    { name: 'insertViewer', purpose: 'add visual design/product context', keywords: ['design', 'review', 'item', 'asset', 'service', 'variant'] },
    { name: 'insertSourcing', purpose: 'reuse supplier, manufacturer, lead-time, and cost evidence', keywords: ['supplier', 'sourcing', 'spare', 'service', 'passport'] },
    { name: 'insertWorkflowHistory', purpose: 'show state, approvals, and audit trail', keywords: ['release', 'change', 'quality', 'review', 'project', 'validation', 'variant'] },
    { name: 'insertWorkflowActions', purpose: 'show available transitions after read-only proof', keywords: ['release', 'quality', 'review', 'change', 'project', 'variant'] },
    { name: 'insertReport', purpose: 'reuse tenant reports for dashboard tiles', keywords: ['dashboard', 'report', 'quality', 'project', 'supplier'] }
].map(panel => ({ ...panel, source: functionSource(panel.name) })).filter(panel => panel.source);

function flattenMenu(items) {
    const result = [];
    for (const item of items) {
        if (Array.isArray(item)) result.push(...flattenMenu(item));
        else if (item?.commands) result.push(...flattenMenu(item.commands));
        else if (item?.title || item?.url) result.push(item);
    }
    return result;
}

function hasKeyword(value, keywords) {
    const text = String(value || '').toLowerCase();
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

function objectHasKeyword(obj, keywords) {
    return hasKeyword(JSON.stringify(obj || {}), keywords);
}

function workspaceHasKeyword(workspace, keywords) {
    return hasKeyword(workspaceSignalText(workspace), keywords);
}

function workspaceSignalText(workspace) {
    return [
        workspace.name,
        workspace.fields,
        workspace.tabs,
        workspace.sections,
        workspace.workflowStates,
        workspace.workflowTransitions,
        workspace.relationships,
        workspace.reports,
        workspace.views,
        workspace.scripts,
        workspace.permissions,
        workspace.editor,
        workspace.details
    ].map(value => typeof value === 'string' ? value : JSON.stringify(value || '')).join(' ');
}

function workspaceEditorSignals(workspace) {
    return ['fields', 'tabs', 'sections', 'workflowStates', 'workflowTransitions', 'relationships', 'reports', 'views', 'scripts', 'permissions']
        .filter(key => {
            const value = workspace[key];
            if (Array.isArray(value)) return value.length > 0;
            return String(value || '').trim() !== '';
        });
}

function loadDiscovery(file) {
    if (!file || !fs.existsSync(file)) return { tenant: '', source: '', workspaces: [] };

    const text = fs.readFileSync(file, 'utf8');
    rejectAuthPageDiscovery(text, file);
    rejectSecretDiscovery(text, file);
    try {
        const parsed = JSON.parse(text);
        const parsedText = JSON.stringify(parsed);
        rejectAuthPageDiscovery(parsedText, file);
        rejectSecretDiscovery(parsedText, file);
        return parsed;
    } catch {
        if (/\.json$/i.test(file)) {
            console.error(`Discovery JSON could not be parsed: ${relativePath(file)}`);
            process.exit(1);
        }
        return parseWorkspaceText(text, file);
    }
}

function loadGraphifyAst() {
    const file = path.join(root, 'graphify-out', '.graphify_ast.json');
    if (!fs.existsSync(file)) return { nodes: [], edges: [] };
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rejectAuthPageDiscovery(text, file) {
    if (!/Bei Autodesk anmelden|Autodesk-Konto erstellen|E-Mail-Adresse zur Anmeldung|OAuth authorization|Anwendung autorisieren|Erlauben/.test(text)) return;
    console.error(`Discovery file is an Autodesk login/authorization page, not Workspace Manager evidence: ${relativePath(file)}`);
    process.exit(1);
}

function rejectSecretDiscovery(text, file) {
    const patterns = [
        /\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
        /["']?\b(access_token|refresh_token|id_token|client_secret|password|passwd|pwd)\b["']?\s*[:=]\s*["']?[^"',\s}]+/i,
        /\b(sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
        /\bCookie\s*[:=]\s*[^;\n]+=[^;\n]+/i
    ];
    if (!patterns.some(pattern => pattern.test(text))) return;
    console.error(`Discovery file appears to contain secrets or credentials, not safe tenant evidence: ${relativePath(file)}`);
    process.exit(1);
}

function parseWorkspaceText(text, file) {
    const typeLabels = [
        'Revision controlled',
        'Mit Revisionskontrolle',
        'Revisioning',
        'Revisionierung',
        'Basic with workflow',
        'Basis mit Arbeitsablauf'
    ];
    const skip = new Set([
        'settings',
        'code',
        'group',
        'schema',
        'Only in this workspace',
        'Nur in diesem Arbeitsbereich',
        'Home',
        'Start',
        'Workspace Manager',
        'Arbeitsbereich-Manager',
        'Create workspace',
        'Arbeitsbereich erstellen',
        'Create category',
        'Kategorie erstellen',
        'Template library',
        'Vorlagenbibliothek',
        'Name',
        'Description',
        'Beschreibung',
        'Type',
        'Typ'
    ]);
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

    return {
        tenant: '',
        source: `Workspace Manager text import: ${path.relative(root, file)}`,
        workspaces
    };
}

function loadBrainstormCandidates() {
    const file = path.join(root, 'docs', 'EXTENSION-USECASE-BRAINSTORM.md');
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line, index) => ({ line, index: index + 1 }))
        .map(item => ({ ...item, match: item.line.match(/^###\s+\d+\.\s+(.+)$/) }))
        .filter(item => item.match)
        .map(item => ({ name: item.match[1].trim(), source: `docs/EXTENSION-USECASE-BRAINSTORM.md:${item.index}` }));
}

const candidateEndpoints = new Set(clusters.map(cluster => cluster.mvp));
const menuCommands = flattenMenu(menu).filter(command => !candidateEndpoints.has(command.url));
const appEntries = Object.entries(applications).filter(([key]) => !candidateAppKeys.has(key));
const workspaceEntries = Object.entries(workspaceIds);
const discoveredWorkspaces = discovery.workspaces || [];
const knownKeywords = [...new Set(clusters.flatMap(cluster => cluster.keywords))];
const unmappedTenantWorkspaces = discoveredWorkspaces
    .filter(workspace => !workspaceHasKeyword(workspace, knownKeywords))
    .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.name || '').localeCompare(String(b.name || '')));
const unmappedRepoWorkspaces = workspaceEntries
    .filter(([key]) => !hasKeyword(key, knownKeywords))
    .sort((a, b) => a[0].localeCompare(b[0]));

const rows = clusters.map(cluster => {
    const workspaces = workspaceEntries.filter(([key]) => hasKeyword(key, cluster.keywords));
    const tenantWorkspaces = discoveredWorkspaces.filter(workspace => workspaceHasKeyword(workspace, cluster.keywords));
    const apps = appEntries.filter(([key, value]) => hasKeyword(key, cluster.keywords) || objectHasKeyword(value, cluster.keywords));
    const commands = menuCommands.filter(command => objectHasKeyword(command, cluster.keywords));
    const scoreParts = {
        repoWorkspaces: workspaces.length * 3,
        tenantWorkspaces: tenantWorkspaces.length * 4,
        applications: apps.length * 2,
        menuEntries: commands.length
    };
    const score = Object.values(scoreParts).reduce((total, value) => total + value, 0);

    return {
        ...cluster,
        score,
        scoreParts,
        blueprint: getBlueprint(cluster.name),
        implementation: getImplementation(cluster.mvp),
        workspaces,
        tenantWorkspaces,
        apps: apps.map(([key]) => key),
        commands: commands.map(command => command.title || command.url)
    };
}).sort((a, b) => b.score - a.score);
const nextBuild = rows.find(row => row.implementation !== 'implemented' && row.blueprint);
const nextBlueprint = rows.find(row => !row.blueprint);
const nextVerify = rows.find(row => row.implementation === 'implemented' && row.tenantWorkspaces.length > 0);
const brainstormCandidates = loadBrainstormCandidates();
const whitespaceCandidates = brainstormCandidates
    .filter(candidate => !clusters.some(cluster => sameWorkspaceName(cluster.name, candidate.name)))
    .map(enrichWhitespaceCandidate)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

function list(values) {
    if (values.length === 0) return '- none';
    return values.map(value => `- ${value}`).join('\n');
}

function workspaceList(values) {
    if (values.length === 0) return '- none';
    return values.map(([key, id]) => `- ${key}: ${id}`).join('\n');
}

function tenantWorkspaceList(values) {
    if (values.length === 0) return '- none';
    return values.map(workspace => {
        const category = workspace.category ? `${workspace.category} / ` : '';
        const type = workspace.type ? ` (${workspace.type})` : '';
        return `- ${category}${workspace.name}${type}`;
    }).join('\n');
}

function unmappedTenantList(values) {
    if (values.length === 0) return '- none';
    return values.map(workspace => {
        const category = workspace.category ? `${workspace.category} / ` : '';
        const type = workspace.type ? ` (${workspace.type})` : '';
        return `- ${category}${workspace.name}${type}`;
    }).join('\n');
}

function getBlueprint(name) {
    const file = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '') + '-MVP.md';
    const relative = `docs/${file}`;
    return fs.existsSync(path.join(root, relative)) ? relative : '';
}

function getImplementation(endpoint) {
    const name = String(endpoint || '').replace(/^\//, '');
    const routeText = fs.readFileSync(path.join(root, 'routes/landing.js'), 'utf8');
    const route = routeText.includes(`router.get('${endpoint}'`);
    const view = fs.existsSync(path.join(root, 'views/apps', `${name}.pug`)) || fs.existsSync(path.join(root, 'views/admin', `${name}.pug`));
    const script = fs.existsSync(path.join(root, 'public/javascripts/apps', `${name}.js`)) || fs.existsSync(path.join(root, 'public/javascripts/admin', `${name}.js`));
    if(route && view && script) return 'implemented';
    if(route || view || script) return 'partial';
    return 'planned';
}

function endpointToSettingsKey(endpoint) {
    return String(endpoint || '').replace(/^\//, '').replace(/-([a-z0-9])/g, function(match, letter) {
        return letter.toUpperCase();
    });
}

function scoreBreakdown(row) {
    return [
        `- repo workspaces: ${row.scoreParts.repoWorkspaces}`,
        `- tenant-discovered workspaces: ${row.scoreParts.tenantWorkspaces}`,
        `- matching applications: ${row.scoreParts.applications}`,
        `- matching menu entries: ${row.scoreParts.menuEntries}`
    ].join('\n');
}

function readiness(row) {
    if (row.implementation === 'implemented' && row.tenantWorkspaces.length > 0) return 'demo candidate; browser check needed';
    if (row.implementation === 'implemented') return 'preview only; tenant evidence needed';
    if (row.blueprint) return 'build candidate';
    return 'idea only';
}

function backlogRow(row, index) {
    return [
        index + 1,
        row.name,
        row.score,
        row.tenantWorkspaces.length,
        row.blueprint ? 'ready' : 'needs blueprint',
        row.implementation,
        readiness(row),
        row.mvp,
        row.blueprint || '-'
    ].join(' | ');
}

function nextAction() {
    if (nextBuild) return `Build read-only shell for \`${nextBuild.mvp}\` from \`${nextBuild.blueprint}\`.`;
    if (nextBlueprint) return `Draft MVP blueprint for \`${nextBlueprint.name}\` at \`${nextBlueprint.mvp}\`.`;
    if (nextVerify) return `Browser-verify implemented \`${nextVerify.mvp}\` against live tenant evidence.`;
    return 'No candidates found.';
}

function lane(row) {
    const text = `${row.name} ${(row.keywords || []).join(' ')}`.toLowerCase();
    if (hasKeyword(text, ['external', 'contributor', 'collaboration'])) return 'External collaboration';
    if (hasKeyword(text, ['supplier', 'spare', 'service', 'asset', 'serial', 'equipment'])) return 'Service and supply chain';
    if (hasKeyword(text, ['quality', 'requirement', 'test', 'validation', 'review'])) return 'Quality, requirements and validation';
    if (hasKeyword(text, ['release', 'change', 'project', 'launch', 'variant'])) return 'Product development governance';
    if (hasKeyword(text, ['passport', 'carbon', 'compliance', 'traceability', 'documents', 'products', 'bom', 'export', 'pdf', 'excel', 'csv', 'attachment'])) return 'Digital thread and compliance';
    return 'Extension foundation';
}

function evidenceLine(row) {
    const tenant = row.tenantWorkspaces.slice(0, 3).map(workspace => workspace.name).join(', ');
    const repo = row.workspaces.slice(0, 3).map(([key]) => key).join(', ');
    return tenant || repo || 'repo application/menu evidence';
}

function painTheme(laneName) {
    const themes = {
        'Service and supply chain': 'Supplier, service, and spare-part work often lives across packages, requests, installed base records, and operational follow-up. The proof is whether one cockpit can expose delays, missing sourcing evidence, and recurring service demand without writing back to the tenant.',
        'Product development governance': 'Launch, release, variants, and changes are governance problems spread across projects, item state, workflows, and reviews. The proof is whether stakeholders can see blockers before adding automation.',
        'Digital thread and compliance': 'Digital-thread and DPP pressure make item, document, supplier, material, compliance, and lifecycle evidence harder to manage as separate screens. The proof is a readable gap view before any registry, QR, or certification workflow.',
        'Quality, requirements and validation': 'Quality, requirement, review, and validation evidence is audit-sensitive and easy to fragment. The proof is coverage and closure visibility before creating links, CAPA/SCAR records, or workflow transitions.',
        'External collaboration': 'External contributor work needs narrow, safe visibility into packages, reviews, files, and response state before permissions, uploads, comments, or workflow actions are exposed.'
    };
    return themes[laneName] || 'Use the read-only shell to prove value before adding tenant write automation.';
}

function functionSource(name) {
    const node = (graphifyAst.nodes || []).find(item => {
        const file = item.source_file || '';
        return item.label === `${name}()` && (file.startsWith('public\\javascripts\\contents\\') || file.startsWith('public\\javascripts\\framework\\'));
    });
    if (!node) return '';
    return `${node.source_file.replace(/\\/g, '/')} ${node.source_location}`;
}

function reusePanels(row) {
    const text = `${row.name} ${(row.keywords || []).join(' ')} ${lane(row)}`.toLowerCase();
    return panelCatalog.filter(panel => hasKeyword(text, panel.keywords));
}

function pitchNextStep(row) {
    if (row.implementation === 'implemented' && row.tenantWorkspaces.length > 0) return `Browser-verify \`${row.mvp}\` against the listed tenant workspaces.`;
    if (row.implementation === 'implemented') return `Use the preview and confirm tenant workspace evidence before a customer demo.`;
    if (row.blueprint) return `Build the read-only shell from \`${row.blueprint}\`.`;
    return 'Draft the MVP blueprint before writing code.';
}

function endpointForCandidate(name) {
    if (name === 'Workspace Health Scanner') return '/workspace-health';
    return `/${normalizedName(name).replace(/\b(and|to|the)\b/g, '').replace(/\s+/g, '-').replace(/^-|-$/g, '')}`;
}

function candidateKeywords(name) {
    const stop = new Set(['and', 'the', 'cockpit', 'board', 'matrix', 'hub', 'desk', 'center', 'portal', 'scanner', 'readiness', 'command']);
    return normalizedName(name).split(' ').filter(word => (word === 'bom' || word.length > 3) && !stop.has(word));
}

function enrichWhitespaceCandidate(candidate) {
    const keywords = candidateKeywords(candidate.name);
    const tenantWorkspaces = discoveredWorkspaces.filter(workspace => workspaceHasKeyword(workspace, keywords));
    const workspaces = workspaceEntries.filter(([key]) => hasKeyword(key, keywords));
    const apps = appEntries.filter(([key, value]) => hasKeyword(key, keywords) || objectHasKeyword(value, keywords)).map(([key]) => key);
    const endpoint = endpointForCandidate(candidate.name);
    const blueprint = getBlueprint(candidate.name);
    const score = tenantWorkspaces.length * 4 + workspaces.length * 3 + apps.length * 2 + (blueprint ? 1 : 0);
    return { ...candidate, endpoint, blueprint, score, keywords, tenantWorkspaces, workspaces, apps, implementation: getImplementation(endpoint) };
}

function whitespaceNextStep(candidate) {
    if (candidate.implementation === 'implemented') return `Keep as foundation/reuse candidate; browser-check \`${candidate.endpoint}\` when relevant.`;
    if (candidate.blueprint) return `Decide whether to promote to \`settings.applications.workspaceHealth.archetypes\`, then build from \`${candidate.blueprint}\`.`;
    return 'Draft a one-page MVP blueprint only if a tenant scan produces evidence.';
}

function whitespaceEvidence(candidate) {
    const tenant = candidate.tenantWorkspaces.slice(0, 3).map(workspace => workspace.name).join(', ');
    const repo = candidate.workspaces.slice(0, 3).map(([key]) => key).join(', ');
    return tenant || repo || candidate.apps.slice(0, 3).join(', ') || 'brainstorm only';
}

function promotionGate(candidate) {
    if (candidate.name === 'BOM Export And Attachment Studio' && promotionEvidenceWorkspaces(candidate).length) return 'Tenant workspace evidence exists; browser-verify BOM and attachment details before adding the archetype.';
    if (candidate.tenantWorkspaces.length) return 'Tenant evidence exists; browser-verify Workspace Editor details before adding the archetype.';
    if (candidate.workspaces.length || candidate.apps.length) return 'Repo evidence exists; wait for tenant scan evidence before adding the archetype.';
    return 'Brainstorm only; keep parked until a tenant scan or customer request supports it.';
}

function promotionEvidenceWorkspaces(candidate) {
    if (candidate.tenantWorkspaces.length && candidate.name !== 'External Contributor Portal') return candidate.tenantWorkspaces;
    const targets = promotionScanTargets(candidate).map(singularName);
    return discoveredWorkspaces.filter(workspace => targets.includes(singularName(workspace.name)) || targets.includes(singularName(workspaceDisplayName(workspace))));
}

function promotionMatchHints(candidate) {
    const exact = promotionScanTargets(candidate);
    const alternatives = [];
    if (candidate.name === 'Supplier Risk And Readiness Radar') {
        alternatives.push(...discoveredWorkspaces
            .filter(workspace => workspaceHasKeyword(workspace, ['spare', 'request', 'part']))
            .map(workspaceDisplayName));
    }
    if (candidate.name === 'Change Impact War Room') {
        alternatives.push(...discoveredWorkspaces
            .filter(workspace => workspaceHasKeyword(workspace, ['freigabe', 'order project', 'project task', 'delivery']))
            .map(workspaceDisplayName));
    }
    return [...new Set([...exact, ...alternatives])];
}

function promotionDecision(candidate) {
    const workspaces = promotionEvidenceWorkspaces(candidate);
    const captured = workspaces.filter(workspace => workspaceEditorSignals(workspace).length > 0);
    const hints = promotionMatchHints(candidate);
    if (captured.length) {
        return {
            status: 'ready for archetype review',
            next: 'Review the blueprint against captured Workspace Editor signals, then add the archetype only if it beats an implemented candidate.',
            captured: captured.map(workspaceDisplayName),
            hints
        };
    }
    if (workspaces.length) {
        return {
            status: 'needs Workspace Editor scan',
            next: `Capture ${workspaceEditorChecks(candidate).slice(0, 3).join(', ')} for ${workspaces.slice(0, 3).map(workspaceDisplayName).join(', ')}.`,
            captured: [],
            hints
        };
    }
    return {
        status: 'needs tenant workspace match',
        next: `Find or confirm a matching Workspace Manager row before promotion. Start with ${hints.slice(0, 4).join(', ')}.`,
        captured: [],
        hints
    };
}

function discoveryCoverageRow(workspace, index) {
    const signals = workspaceEditorSignals(workspace);
    const name = `${workspace.category ? `${workspace.category} / ` : ''}${workspace.name}`;
    return [
        index + 1,
        name,
        workspace.type || '-',
        signals.length ? signals.join(', ') : '-',
        signals.length ? 'workspace editor captured' : 'workspace manager only'
    ].join(' | ');
}

function workspaceDisplayName(workspace) {
    return `${workspace.category ? `${workspace.category} / ` : ''}${workspace.name}`;
}

function workspaceCandidateLines(workspace) {
    const implemented = rows
        .filter(row => row.tenantWorkspaces.includes(workspace))
        .map(row => `- ${row.name} (${row.implementation}, score ${row.score}) -> \`${row.mvp}\``);
    const planned = whitespaceCandidates
        .filter(candidate => candidate.tenantWorkspaces.includes(workspace))
        .map(candidate => `- ${candidate.name} (${candidate.implementation}, score ${candidate.score}) -> \`${candidate.endpoint}\``);
    const lines = [...implemented, ...planned];
    return lines.length ? lines : ['- none'];
}

function discoveryQuestions(row) {
    const names = row.tenantWorkspaces.slice(0, 3).map(workspace => workspace.name).join(', ');
    const scope = names || (lane(row) === 'External collaboration' ? promotionScanTargets(row).slice(0, 3).join(', ') : evidenceLine(row));
    const questions = {
        'Service and supply chain': [
            `Which handoff between ${scope} still happens in email, Excel, or meetings?`,
            'Which supplier, service, or spare-part signal would trigger action if it were visible earlier?'
        ],
        'Product development governance': [
            `Which blocker across ${scope} is usually found too late?`,
            'Which approval, task, or release status needs a cockpit before any automation is safe?'
        ],
        'Digital thread and compliance': [
            `Which evidence around ${scope} is missing when someone asks for traceability or compliance proof?`,
            'Which item, document, supplier, or material gap should be visible before creating new workflows?'
        ],
        'Quality, requirements and validation': [
            `Which open action across ${scope} is hardest to prove closed during an audit?`,
            'Which requirement, test, review, or quality link is currently checked manually?'
        ],
        'External collaboration': [
            `Which external handoff around ${scope} still happens by email or file links?`,
            'Which fields, files, tasks, or workflow states can be safely shown without exposing internal PLM data?'
        ]
    };
    return questions[lane(row)] || [`What question should ${row.name} answer in one screen?`];
}

function browserScanTargets(row) {
    const tenantTargets = row.tenantWorkspaces.map(workspace => {
        const category = workspace.category ? `${workspace.category} / ` : '';
        return `${category}${workspace.name}`;
    });
    if (tenantTargets.length) return tenantTargets;
    return configuredWorkspaces(row.mvp).map(item => item.label);
}

function promotionScanTargets(candidate) {
    if (candidate.name === 'External Contributor Portal') return ['Supplier Packages', 'Design Reviews', 'Design Review Tasks'];
    if (candidate.name === 'BOM Export And Attachment Studio') return ['Product Development / Items', 'Product Development / Documents'];
    const tenantTargets = candidate.tenantWorkspaces.map(workspace => workspaceDisplayName(workspace));
    if (tenantTargets.length) return tenantTargets;
    const repoTargets = candidate.workspaces.map(([key]) => key);
    return repoTargets.length ? repoTargets : [whitespaceEvidence(candidate)];
}

function workspaceEditorChecks(row) {
    const checks = ['fields', 'tabs/sections', 'workflow states/transitions', 'relationships', 'reports/views', 'scripts/permissions'];
    const text = `${row.name} ${(row.keywords || []).join(' ')}`.toLowerCase();
    if (hasKeyword(text, ['supplier'])) return ['supplier/source fields', 'open package/request states', ...checks];
    if (hasKeyword(text, ['bom', 'export', 'pdf', 'excel', 'csv', 'attachment'])) return ['BOM tab access', 'available BOM views', 'attachment tab permissions', ...checks];
    if (hasKeyword(text, ['service', 'asset', 'serial', 'equipment'])) return ['serial/asset linkage fields', 'service event/request states', ...checks];
    if (lane(row) === 'External collaboration') return ['external role/assignee fields', 'safe attachment/comment visibility', ...checks];
    if (lane(row) === 'Quality, requirements and validation') return ['evidence attachments', 'open task/action fields', ...checks];
    if (lane(row) === 'Product development governance') return ['approval gates', 'blocker/status fields', ...checks];
    if (lane(row) === 'Digital thread and compliance') return ['document/material/compliance fields', 'missing-data indicators', ...checks];
    return checks;
}

function configuredWorkspaces(endpoint) {
    const app = applications[endpointToSettingsKey(endpoint)] || {};
    return app.workspaces || [];
}

function normalizedName(value) {
    return String(value || '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_old$/i, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .toLowerCase();
}

function singularName(value) {
    return normalizedName(value).split(' ').map(part => part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part).join(' ');
}

function sameWorkspaceName(left, right) {
    return normalizedName(left) === normalizedName(right) || singularName(left) === singularName(right);
}

function tenantWorkspaceMatch(item, row) {
    return row.tenantWorkspaces
        .filter(workspace => sameWorkspaceName(workspace.name, item.label) || sameWorkspaceName(workspace.name, item.key))
        .sort((a, b) => Number(/_old$/i.test(a.name)) - Number(/_old$/i.test(b.name)))[0];
}

function workspaceStatus(item, row) {
    const id = applications[endpointToSettingsKey(row.mvp)]?.workspaceIds?.[item.key] || workspaceIds[item.key] || '';
    const tenantMatch = tenantWorkspaceMatch(item, row);
    if (id && tenantMatch) return `ready: ${item.key}=${id}, tenant ${tenantMatch.name}`;
    if (id) return `default id: ${item.key}=${id}`;
    if (tenantMatch) return `tenant match, ID needed: ${tenantMatch.name}`;
    return `missing tenant evidence: ${item.key}`;
}

const report = [
    '# Use-Case Miner Report',
    '',
    'Generated from `settings.js` using `tools/usecase-miner.js`.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    discovery.tenant ? `Tenant: ${discovery.tenant}.` : '',
    discovery.source ? `Discovery source: ${discovery.source}.` : '',
    '',
    '## Ranked Candidates',
    '',
    ...rows.flatMap((row, index) => [
        `### ${index + 1}. ${row.name}`,
        '',
        `Score: ${row.score}`,
        '',
        'Score breakdown:',
        '',
        scoreBreakdown(row),
        '',
        `Suggested MVP endpoint: \`${row.mvp}\``,
        '',
        row.blueprint ? `MVP blueprint: \`${row.blueprint}\`` : 'MVP blueprint: -',
        '',
        `Implementation status: ${row.implementation}`,
        '',
        'Matching workspaces:',
        '',
        workspaceList(row.workspaces),
        '',
        'Matching tenant-discovered workspaces:',
        '',
        tenantWorkspaceList(row.tenantWorkspaces),
        '',
        'Matching applications:',
        '',
        list(row.apps),
        '',
        'Matching menu entries:',
        '',
        list(row.commands),
        ''
    ]),
    '## Next Step',
    '',
    nextAction(),
    '',
    '## Unmapped Tenant Workspace Signals',
    '',
    'These workspace names did not match any configured archetype keyword. Review them after each browser scan to find new extension ideas.',
    '',
    unmappedTenantList(unmappedTenantWorkspaces),
    '',
    '## Unmapped Repo Workspace IDs',
    '',
    'These `settings.common.workspaceIds` keys did not match any configured archetype keyword.',
    '',
    workspaceList(unmappedRepoWorkspaces),
    ''
].join('\n');

const backlog = [
    '# Extension Candidate Backlog',
    '',
    'Generated from `settings.js`, tenant discovery evidence, and `tools/usecase-miner.js`.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Build Order',
    '',
    'Rank | Candidate | Score | Tenant Workspaces | Blueprint | Implementation | Readiness | Endpoint | Blueprint File',
    '--- | --- | ---: | ---: | --- | --- | --- | --- | ---',
    ...rows.map(backlogRow),
    '',
    '## Next Read-Only Slice',
    '',
    nextAction(),
    '',
    '## Rule',
    '',
    'Do not add tenant write actions until the read-only screen is useful and the target tenant, object list, before-state export, expected action, and rollback path are named.',
    '',
    '## Unmapped Signals',
    '',
    `Tenant workspaces without archetype match: ${unmappedTenantWorkspaces.length}.`,
    `Repo workspace IDs without archetype match: ${unmappedRepoWorkspaces.length}.`,
    '',
    'Use the unmapped section in `docs/USECASE-MINER-REPORT.md` for the next brainstorming pass before adding more archetypes.',
    ''
].join('\n');

const brief = [
    '# Extension Portfolio Brief',
    '',
    'Generated by `tools/usecase-miner.js` from repo settings, implemented shells, and tenant discovery evidence.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Story',
    '',
    'This repo can now turn Fusion Manage workspace evidence into extension candidates, build order, blueprints, local shell checks, and preview pages. The strongest current theme is connecting scattered PLM work into readable cockpit views before allowing any tenant write automation.',
    '',
    '## Demo Order',
    '',
    ...rows.slice(0, 6).map((row, index) => `${index + 1}. **${row.name}** - ${lane(row)}. Evidence: ${evidenceLine(row)}. Endpoint: \`${row.mvp}\`.`),
    '',
    '## First Conversation Starters',
    '',
    ...rows.slice(0, 3).map(row => `- **${row.name}**: strongest because it combines score ${row.score}, ${row.tenantWorkspaces.length} tenant workspace signal(s), and an implemented read-only shell.`),
    '',
    '## Decision View',
    '',
    ...rows.map(row => `- **${row.name}**: ${readiness(row)}. Next: ${pitchNextStep(row)}`),
    '',
    'Local preview index when OAuth blocks live review: `storage/extension-previews/index.html`.',
    '',
    '## PLM Pain Themes',
    '',
    ...[...new Set(rows.map(row => lane(row)))].map(name => `- **${name}**: ${painTheme(name)}`),
    '',
    '## Proof Plan',
    '',
    ...rows.slice(0, 5).map(row => `- Open \`${row.mvp}\`, confirm the workspace cards match tenant evidence (${evidenceLine(row)}), then check console/network before discussing write actions.`),
    '',
    '## Demo Script',
    '',
    ...rows.slice(0, 5).flatMap((row, index) => [
        `${index + 1}. **${row.name}**`,
        `   - Open: \`${row.mvp}\``,
        `   - Say: ${painTheme(lane(row))}`,
        `   - Ask: ${discoveryQuestions(row)[0]}`,
        `   - Gate: ${pitchNextStep(row)}`,
        ''
    ]),
    '## Source Anchors',
    '',
    '- Fusion Manage / connected PLM: `docs/EXTENSION-USECASE-BRAINSTORM.md` external evidence.',
    '- Digital thread: NIST and Autodesk links in `docs/EXTENSION-USECASE-BRAINSTORM.md`.',
    '- Digital Product Passport: EU links in `docs/DIGITAL-PRODUCT-PASSPORT-READINESS-MVP.md`.',
    '- Quality and requirements traceability: `docs/QUALITY-CLOSURE-COCKPIT-MVP.md` and `docs/REQUIREMENTS-COVERAGE-MATRIX-MVP.md`.',
    '',
    '## Portfolio Lanes',
    '',
    ...Object.entries(rows.reduce((groups, row) => {
        const key = lane(row);
        groups[key] = groups[key] || [];
        groups[key].push(row);
        return groups;
    }, {})).flatMap(([key, values]) => [
        `### ${key}`,
        '',
        ...values.map(row => `- ${row.name}: score ${row.score}, ${row.tenantWorkspaces.length} tenant workspace(s), ${row.implementation}.`),
        ''
    ]),
    '## Current Gate',
    '',
    nextAction(),
    '',
    '## Safe Automation Boundary',
    '',
    'Keep tenant actions read-only until the selected cockpit is browser-verified and the target tenant, object list, before-state export, expected action, and rollback path are named.',
    ''
].join('\n');

const pitchCards = [
    '# Extension Pitch Cards',
    '',
    'Generated by `tools/usecase-miner.js` for quick customer/internal presentation.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Present First',
    '',
    ...rows.slice(0, 3).map((row, index) => `${index + 1}. ${row.name} - ${evidenceLine(row)}.`),
    '',
    ...rows.map(row => [
        `## ${row.name}`,
        '',
        `Endpoint: \`${row.mvp}\``,
        '',
        `Lane: ${lane(row)}`,
        '',
        `Problem: ${painTheme(lane(row))}`,
        '',
        `Tenant proof: ${row.tenantWorkspaces.length} tenant workspace signal(s); ${evidenceLine(row)}.`,
        '',
        `Demo promise: Show one read-only cockpit that turns the related workspace records into blockers, gaps, and next actions.`,
        '',
        `Next step: ${pitchNextStep(row)}`,
        '',
        'Discovery questions:',
        '',
        ...discoveryQuestions(row).map(question => `- ${question}`),
        ''
    ].join('\n')),
    '## Boundary',
    '',
    'These are pitch cards, not tenant setup instructions. Tenant writes still require explicit approval, before-state capture, and rollback/export path.',
    ''
].join('\n');

const reuseMap = [
    '# Extension Reuse Map',
    '',
    'Generated by `tools/usecase-miner.js` from Graphify function nodes and candidate keywords.',
    '',
    `Graphify snapshot: ${(graphifyAst.nodes || []).length} node(s), ${(graphifyAst.edges || []).length} edge(s).`,
    '',
    '## Reusable Panels',
    '',
    ...panelCatalog.map(panel => `- \`${panel.name}\` - ${panel.purpose}. Source: ${panel.source}.`),
    '',
    '## Candidate Reuse',
    '',
    ...rows.flatMap(row => {
        const panels = reusePanels(row);
        return [
            `### ${row.name}`,
            '',
            `Endpoint: \`${row.mvp}\``,
            '',
            panels.length ? panels.map(panel => `- \`${panel.name}\`: ${panel.purpose}.`).join('\n') : '- no direct panel match',
            ''
        ];
    }),
    '## Rule',
    '',
    'Before building custom UI for an extension, check the listed panel source and reuse it when it already covers the needed record, evidence, workflow, BOM, sourcing, or file view.',
    ''
].join('\n');

const adoption = [
    '# Tenant Extension Adoption Matrix',
    '',
    'Generated by `tools/usecase-miner.js`. Use this to decide which implemented read-only shells fit a tenant and which workspace IDs still need tenant-specific overrides.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## How To Use',
    '',
    '1. Pick an extension with tenant evidence.',
    '2. Confirm each listed workspace in Fusion Manage.',
    '3. Put tenant-specific IDs into `settings/<tenant>.js`, not `settings.js`.',
    '4. Browser-verify the endpoint before adding write actions.',
    '',
    ...rows.flatMap(row => [
        `## ${row.name}`,
        '',
        `Endpoint: \`${row.mvp}\``,
        '',
        `Lane: ${lane(row)}`,
        '',
        `Adoption signal: score ${row.score}, ${row.tenantWorkspaces.length} tenant workspace(s), ${row.implementation}.`,
        '',
        'Workspace adoption:',
        '',
        ...configuredWorkspaces(row.mvp).map(item => `- ${item.label} (${item.role}): ${workspaceStatus(item, row)}`),
        ''
    ]),
    '## Boundary',
    '',
    'This matrix is read-only planning evidence. Do not use it to write tenant configuration without confirming workspace IDs and rollback/export path.',
    ''
].join('\n');

const promotionCandidates = whitespaceCandidates.filter(candidate => candidate.blueprint && candidate.implementation !== 'implemented');
const scanQueue = [
    '# Browser Tenant Scan Queue',
    '',
    'Generated by `tools/usecase-miner.js`. Use this as the read-only Workspace Manager queue for browser MCP or manual browser scans.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Rules',
    '',
    '- Read-only only.',
    '- Capture workspace names, tabs, sections, fields, workflow states/transitions, scripts, reports/views, and relationship tabs.',
    '- Do not click tenant-changing actions such as create, edit, save, delete, import, permission changes, or workflow/script writes.',
    '- If the browser shows Autodesk login/OAuth authorization, stop and do not save that page as discovery evidence.',
    '',
    '## Scan Order',
    '',
    ...rows.filter(row => row.implementation === 'implemented').flatMap((row, index) => [
        `### ${index + 1}. ${row.name}`,
        '',
        `Endpoint to preview locally: \`${row.mvp}\``,
        '',
        `Readiness: ${readiness(row)}`,
        '',
        'Workspace Manager targets:',
        '',
        ...browserScanTargets(row).map(target => `- ${target}`),
        '',
        'Workspace Editor checks:',
        '',
        ...workspaceEditorChecks(row).map(check => `- ${check}`),
        '',
        'Decision questions:',
        '',
        ...discoveryQuestions(row).map(question => `- ${question}`),
        ''
    ]),
    '## Promotion Candidate Scan Order',
    '',
    ...promotionCandidates.flatMap((candidate, index) => [
        `### ${index + 1}. ${candidate.name}`,
        '',
        `Planned endpoint: \`${candidate.endpoint}\``,
        '',
        `Blueprint: \`${candidate.blueprint}\``,
        '',
        `Promotion gate: ${promotionGate(candidate)}`,
        '',
        'Workspace Manager targets:',
        '',
        ...promotionScanTargets(candidate).map(target => `- ${target}`),
        '',
        'Workspace Editor checks:',
        '',
        ...workspaceEditorChecks(candidate).map(check => `- ${check}`),
        '',
        'Decision questions:',
        '',
        ...discoveryQuestions(candidate).map(question => `- ${question}`),
        ''
    ]),
    '## Output',
    '',
    'Save copied visible Workspace Manager evidence as `docs/tenant-discovery/<tenant>-workspace-manager-visible.txt`, then run:',
    '',
    '```powershell',
    'npm run usecases -- docs/tenant-discovery/<tenant>-workspace-manager-visible.txt',
    '```',
    ''
].join('\n');

const whitespace = [
    '# Extension Whitespace Radar',
    '',
    'Generated by `tools/usecase-miner.js` from `docs/EXTENSION-USECASE-BRAINSTORM.md` minus configured Workspace Health archetypes.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Why This Exists',
    '',
    'This catches promising use cases that were brainstormed but are not yet part of the automated archetype/backlog loop.',
    '',
    '## Candidates Outside The Archetype Loop',
    '',
    whitespaceCandidates.length ? whitespaceCandidates.flatMap((candidate, index) => [
        `### ${index + 1}. ${candidate.name}`,
        '',
        `Score: ${candidate.score}`,
        '',
        `Suggested endpoint: \`${candidate.endpoint}\``,
        '',
        `Implementation: ${candidate.implementation}`,
        '',
        candidate.blueprint ? `Blueprint: \`${candidate.blueprint}\`` : 'Blueprint: -',
        '',
        `Evidence: ${whitespaceEvidence(candidate)}`,
        '',
        `Source: \`${candidate.source}\``,
        '',
        `Next: ${whitespaceNextStep(candidate)}`,
        ''
    ]).join('\n') : 'No brainstorm-only candidates found.',
    '',
    '## Rule',
    '',
    'Promote a whitespace candidate only when tenant evidence or repeated customer demand beats an already implemented archetype.',
    ''
].join('\n');

const promotion = [
    '# Extension Promotion Queue',
    '',
    'Generated by `tools/usecase-miner.js` from brainstorm-only candidates that already have MVP blueprints.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    '',
    '## Next Promotion Decisions',
    '',
    promotionCandidates.length ? promotionCandidates.flatMap((candidate, index) => [
        `### ${index + 1}. ${candidate.name}`,
        '',
        `Score: ${candidate.score}`,
        '',
        `Endpoint: \`${candidate.endpoint}\``,
        '',
        `Blueprint: \`${candidate.blueprint}\``,
        '',
        `Evidence: ${whitespaceEvidence(candidate)}`,
        '',
        `Gate: ${promotionGate(candidate)}`,
        '',
        `Action: Add to \`settings.applications.workspaceHealth.archetypes\` only after the gate is satisfied; then build the read-only shell from the blueprint.`,
        ''
    ]).join('\n') : 'No promotable whitespace candidates found.',
    '',
    '## Rule',
    '',
    'This queue does not approve tenant writes. It only decides whether a planned use case is ready to enter the archetype/backlog automation loop.',
    ''
].join('\n');

const coverageRows = discoveredWorkspaces.map(discoveryCoverageRow);
const editorCaptured = discoveredWorkspaces.filter(workspace => workspaceEditorSignals(workspace).length > 0).length;
const coverage = [
    '# Tenant Discovery Coverage',
    '',
    'Generated by `tools/usecase-miner.js` from the active discovery file.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    discovery.tenant ? `Tenant: ${discovery.tenant}.` : '',
    '',
    '## Summary',
    '',
    `Workspace Manager rows: ${discoveredWorkspaces.length}.`,
    `Workspace Editor rows with detail signals: ${editorCaptured}.`,
    `Workspace Manager only rows: ${discoveredWorkspaces.length - editorCaptured}.`,
    '',
    '## Coverage Table',
    '',
    'Rank | Workspace | Type | Editor Signals | Status',
    '---: | --- | --- | --- | ---',
    ...(coverageRows.length ? coverageRows : ['- | none | - | - | -']),
    '',
    '## Next Scan Need',
    '',
    editorCaptured === discoveredWorkspaces.length && discoveredWorkspaces.length > 0
        ? 'All discovered workspace rows have at least one Workspace Editor detail signal.'
        : 'Open the highest-ranked Workspace Manager targets in `docs/BROWSER-TENANT-SCAN-QUEUE.md` and capture fields, tabs, workflow states/transitions, relationships, reports/views, scripts, and permissions.',
    '',
    '## Boundary',
    '',
    'Coverage is read-only evidence quality. It does not approve tenant writes or permission changes.',
    ''
].join('\n');

const workspaceUsecaseMap = [
    '# Tenant Workspace Usecase Map',
    '',
    'Generated by `tools/usecase-miner.js`. This reverses the candidate ranking into a Workspace Manager view.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    discovery.tenant ? `Tenant: ${discovery.tenant}.` : '',
    '',
    '## How To Use',
    '',
    'Open a workspace in Fusion Manage, find the same workspace below, then review which extension candidates already use it as evidence.',
    '',
    ...discoveredWorkspaces.flatMap((workspace, index) => {
        const signals = workspaceEditorSignals(workspace);
        return [
            `## ${index + 1}. ${workspaceDisplayName(workspace)}`,
            '',
            `Type: ${workspace.type || '-'}`,
            '',
            `Editor coverage: ${signals.length ? signals.join(', ') : 'workspace manager only'}`,
            '',
            'Matching extension/usecase candidates:',
            '',
            ...workspaceCandidateLines(workspace),
            ''
        ];
    }),
    discoveredWorkspaces.length ? '' : 'No tenant workspaces discovered.',
    '## Boundary',
    '',
    'This is read-only planning evidence. Workspace matches do not approve tenant writes, field changes, scripts, permissions, or workflow actions.',
    ''
].join('\n');

const promotionDecisions = promotionCandidates.map(candidate => ({
    candidate,
    decision: promotionDecision(candidate)
}));
const decisionGates = [
    '# Usecase Decision Gates',
    '',
    'Generated by `tools/usecase-miner.js`. Use this after each read-only Workspace Editor scan to decide which planned use cases enter the archetype/backlog loop.',
    discoveryFile ? `Tenant discovery: \`${relativePath(discoveryFile)}\`.` : '',
    discovery.tenant ? `Tenant: ${discovery.tenant}.` : '',
    '',
    '## Summary',
    '',
    `Workspace Editor rows with detail signals: ${editorCaptured}.`,
    `Ready for archetype review: ${promotionDecisions.filter(item => item.decision.status === 'ready for archetype review').length}.`,
    `Waiting for Workspace Editor scan: ${promotionDecisions.filter(item => item.decision.status === 'needs Workspace Editor scan').length}.`,
    `Waiting for tenant workspace match: ${promotionDecisions.filter(item => item.decision.status === 'needs tenant workspace match').length}.`,
    '',
    '## Decision Table',
    '',
    '| Candidate | Status | Scan Hints | Captured Evidence | Next |',
    '| --- | --- | --- | --- | --- |',
    ...promotionDecisions.map(({ candidate, decision }) => [
        candidate.name,
        decision.status,
        decision.hints.length ? decision.hints.join(', ') : '-',
        decision.captured.length ? decision.captured.join(', ') : '-',
        decision.next
    ].map(value => String(value).replace(/\|/g, '/')).join(' | ')).map(line => `| ${line} |`),
    '',
    '## Boundary',
    '',
    'This report promotes only local planning/archetype decisions. Tenant writes still require explicit approval, before-state capture, and rollback/export path.',
    ''
].join('\n');

const manifest = {
    discovery: {
        file: discoveryFile ? relativePath(discoveryFile) : '',
        tenant: discovery.tenant || '',
        source: discovery.source || '',
        workspaceCount: discoveredWorkspaces.length,
        workspaceEditorDetailCount: editorCaptured
    },
    currentState: {
        implementedShells: rows.filter(row => row.implementation === 'implemented').length,
        promotionCandidates: promotionCandidates.length,
        nextAction: nextAction()
    },
    candidates: rows.map(row => ({
        name: row.name,
        endpoint: row.mvp,
        score: row.score,
        implementation: row.implementation,
        readiness: readiness(row),
        blueprint: row.blueprint,
        lane: lane(row),
        tenantWorkspaces: row.tenantWorkspaces.map(workspaceDisplayName),
        repoWorkspaces: row.workspaces.map(([key, id]) => ({ key, id }))
    })),
    whitespace: whitespaceCandidates.map(candidate => ({
        name: candidate.name,
        endpoint: candidate.endpoint,
        score: candidate.score,
        implementation: candidate.implementation,
        blueprint: candidate.blueprint,
        evidence: whitespaceEvidence(candidate),
        source: candidate.source
    })),
    promotion: promotionCandidates.map(candidate => ({
        name: candidate.name,
        endpoint: candidate.endpoint,
        score: candidate.score,
        blueprint: candidate.blueprint,
        gate: promotionGate(candidate),
        targets: promotionScanTargets(candidate),
        decision: promotionDecision(candidate).status
    })),
    decisions: promotionDecisions.map(({ candidate, decision }) => ({
        name: candidate.name,
        endpoint: candidate.endpoint,
        status: decision.status,
        hints: decision.hints,
        captured: decision.captured,
        next: decision.next
    })),
    coverage: discoveredWorkspaces.map(workspace => ({
        workspace: workspaceDisplayName(workspace),
        type: workspace.type || '',
        editorSignals: workspaceEditorSignals(workspace),
        status: workspaceEditorSignals(workspace).length ? 'workspace editor captured' : 'workspace manager only'
    }))
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, report);
fs.writeFileSync(backlogFile, backlog);
fs.writeFileSync(briefFile, brief);
fs.writeFileSync(pitchFile, pitchCards);
fs.writeFileSync(reuseFile, reuseMap);
fs.writeFileSync(adoptionFile, adoption);
fs.writeFileSync(scanQueueFile, scanQueue);
fs.writeFileSync(whitespaceFile, whitespace);
fs.writeFileSync(promotionFile, promotion);
fs.writeFileSync(coverageFile, coverage);
fs.writeFileSync(workspaceUsecaseFile, workspaceUsecaseMap);
fs.writeFileSync(decisionGatesFile, decisionGates);
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${path.relative(root, outFile)}`);
console.log(`Wrote ${path.relative(root, backlogFile)}`);
console.log(`Wrote ${path.relative(root, briefFile)}`);
console.log(`Wrote ${path.relative(root, pitchFile)}`);
console.log(`Wrote ${path.relative(root, reuseFile)}`);
console.log(`Wrote ${path.relative(root, adoptionFile)}`);
console.log(`Wrote ${path.relative(root, scanQueueFile)}`);
console.log(`Wrote ${path.relative(root, whitespaceFile)}`);
console.log(`Wrote ${path.relative(root, promotionFile)}`);
console.log(`Wrote ${path.relative(root, coverageFile)}`);
console.log(`Wrote ${path.relative(root, workspaceUsecaseFile)}`);
console.log(`Wrote ${path.relative(root, decisionGatesFile)}`);
console.log(`Wrote ${path.relative(root, manifestFile)}`);

function relativePath(file) {
    return path.relative(root, file).replace(/\\/g, '/');
}
