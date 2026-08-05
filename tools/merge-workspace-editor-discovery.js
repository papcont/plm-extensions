const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const baseFile = args[0];
const outFile = args[args.length - 1];
const editorFiles = args.slice(1, -1);

if (!baseFile || editorFiles.length === 0 || !outFile) {
    console.error('Usage: node tools/merge-workspace-editor-discovery.js <base-discovery.json> <editor-details.json> [editor-details-2.json ...] <out.json>');
    process.exit(1);
}

const basePath = path.resolve(root, baseFile);
const outPath = path.resolve(root, outFile);
const base = readJson(basePath);
const details = editorFiles.flatMap(file => {
    const editor = readJson(path.resolve(root, file));
    return Array.isArray(editor) ? editor : [editor];
});
const workspaces = base.workspaces || [];
let merged = 0;

for (const detail of details) {
    const name = normalizedName(detail.name);
    const workspace = workspaces.find(item => normalizedName(item.name) === name);
    if (!workspace) continue;
    mergeDetail(workspace, detail);
    merged++;
}

if (merged === 0) {
    console.error(`No Workspace Editor detail matched ${relative(basePath)}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(base, null, 2) + '\n');
console.log(`Merged ${merged} workspace editor detail(s) into ${relative(outPath)}`);

function readJson(file) {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    rejectUnsafe(text, file);
    return JSON.parse(text);
}

function rejectUnsafe(text, file) {
    const patterns = [
        /Bei Autodesk anmelden|Autodesk-Konto erstellen|E-Mail-Adresse zur Anmeldung|OAuth authorization|Anwendung autorisieren|Erlauben/i,
        /\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/-]+=*/i,
        /["']?\b(access_token|refresh_token|id_token|client_secret|password|passwd|pwd)\b["']?\s*[:=]\s*["']?[^"',\s}]+/i,
        /\b(sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/,
        /\bCookie\s*[:=]\s*[^;\n]+=[^;\n]+/i
    ];
    if (!patterns.some(pattern => pattern.test(text))) return;
    console.error(`Discovery merge input appears unsafe: ${relative(file)}`);
    process.exit(1);
}

function mergeDetail(workspace, detail) {
    for (const key of ['fields', 'tabs', 'sections', 'workflowStates', 'workflowTransitions', 'relationships', 'reports', 'views', 'scripts', 'permissions']) {
        if (detail[key] == null) continue;
        workspace[key] = unique([].concat(workspace[key] || [], detail[key]));
    }
    if (detail.sourceUrl) workspace.editorSourceUrl = detail.sourceUrl;
}

function unique(values) {
    return [...new Set(values.flat().map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizedName(value) {
    return String(value || '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase();
}

function relative(file) {
    return path.relative(root, file).replace(/\\/g, '/');
}
