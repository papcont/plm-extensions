const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const discovery = process.argv[2] || 'docs/tenant-discovery/contelosuxdemo-initial.json';
const tenant = path.basename(discovery)
    .replace(/\.(json|txt)$/i, '')
    .replace(/-(initial|workspace-manager.*)$/i, '') || 'tenant';
const steps = [
    ['Verify discovery tools', ['tools/verify-discovery-tools.js']],
    ['Mine usecases', ['tools/usecase-miner.js', 'docs/USECASE-MINER-REPORT.md', discovery]],
    ['Verify shells', ['tools/verify-extension-shells.js']],
    ['Render previews', ['tools/render-extension-previews.js', discovery]],
    ['Render tenant override template', ['tools/render-tenant-extension-template.js', tenant, discovery]]
];
const lines = ['# Usecase Automation Run', '', `Discovery: \`${discovery}\`.`, ''];

for (const [label, args] of steps) {
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();

    lines.push(`## ${label}`, '', result.status === 0 ? 'Status: ok' : `Status: failed (${result.status})`, '');
    if (output) lines.push('```text', output, '```', '');

    if (result.status !== 0) {
        fs.writeFileSync(path.join(root, 'docs', 'USECASE-AUTOMATION-RUN.md'), lines.join('\n'));
        process.exit(result.status);
    }
}

lines.push('## Outputs', '');
lines.push('- `docs/USECASE-MINER-REPORT.md`');
lines.push('- `docs/EXTENSION-CANDIDATE-BACKLOG.md`');
lines.push('- `docs/EXTENSION-PORTFOLIO-BRIEF.md`');
lines.push('- `docs/EXTENSION-PITCH-CARDS.md`');
lines.push('- `docs/EXTENSION-REUSE-MAP.md`');
lines.push('- `docs/TENANT-EXTENSION-ADOPTION-MATRIX.md`');
lines.push('- `docs/BROWSER-TENANT-SCAN-QUEUE.md`');
lines.push('- `docs/TENANT-DISCOVERY-COVERAGE.md`');
lines.push('- `docs/TENANT-WORKSPACE-USECASE-MAP.md`');
lines.push('- `docs/USECASE-DECISION-GATES.md`');
lines.push('- `docs/USECASE-AUTOMATION-MANIFEST.json`');
lines.push('- `docs/EXTENSION-WHITESPACE-RADAR.md`');
lines.push('- `docs/EXTENSION-PROMOTION-QUEUE.md`');
lines.push(`- \`docs/tenant-discovery/${tenant}-extension-overrides.template.js\``);
lines.push('- `storage/extension-previews/index.html`');
lines.push('- `storage/extension-previews/index.md`');
lines.push('');

fs.writeFileSync(path.join(root, 'docs', 'USECASE-AUTOMATION-RUN.md'), lines.join('\n'));
console.log('Wrote docs\\USECASE-AUTOMATION-RUN.md');
