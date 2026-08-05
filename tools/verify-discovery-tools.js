const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'plm-discovery-'));

try {
    const base = writeJson('base.json', {
        tenant: 'x',
        workspaces: [
            { category: 'Instance Management', name: 'Service', type: 'Revision controlled' },
            { category: 'Product Development', name: 'Supplier Packages', type: 'Basic with workflow' }
        ]
    });
    const service = writeJson('service.json', {
        name: 'Service',
        fields: ['Serial Number'],
        workflowStates: ['Open', 'Closed']
    });
    const supplier = writeJson('supplier.json', {
        name: 'Supplier Packages',
        fields: ['Supplier', 'Due Date'],
        tabs: ['Workflow Actions'],
        relationships: ['Items']
    });
    const out = path.join(temp, 'enriched.json');

    runOk(['tools/merge-workspace-editor-discovery.js', base, service, supplier, out]);

    const merged = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert(merged.workspaces[0].fields.includes('Serial Number'), 'Service fields were not merged');
    assert(merged.workspaces[1].tabs.includes('Workflow Actions'), 'Supplier tabs were not merged');

    const unsafe = writeJson('unsafe.json', { name: 'Supplier Packages', access_token: 'abc123' });
    runFails(['tools/merge-workspace-editor-discovery.js', base, unsafe, path.join(temp, 'unsafe-out.json')], 'unsafe detail was accepted');
    runFails(['tools/usecase-miner.js', path.join(temp, 'unsafe-report.md'), unsafe], 'unsafe miner discovery was accepted');

    const authPage = path.join(temp, 'auth-page.txt');
    fs.writeFileSync(authPage, 'Bei Autodesk anmelden\nE-Mail-Adresse zur Anmeldung');
    runFails(['tools/usecase-miner.js', path.join(temp, 'auth-report.md'), authPage], 'auth page discovery was accepted');

    console.log('Verified discovery merge and guard checks.');
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}

function writeJson(name, value) {
    const file = path.join(temp, name);
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
    return file;
}

function runOk(args) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    if (result.status === 0) return result;
    process.stderr.write([result.stdout, result.stderr].filter(Boolean).join('\n'));
    process.exit(result.status || 1);
}

function runFails(args, message) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert(result.status !== 0, message);
}

function assert(condition, message) {
    if (condition) return;
    console.error(message);
    process.exit(1);
}
