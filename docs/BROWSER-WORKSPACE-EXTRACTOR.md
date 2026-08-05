# Browser Workspace Extractor

Use this when Browser MCP is connected to Fusion Manage Workspace Manager.

Goal: extract visible workspace rows into the JSON format consumed by `tools/usecase-miner.js`.

For per-workspace fields, tabs, workflows, relationships, reports/views, scripts, and permissions, use `docs/BROWSER-WORKSPACE-EDITOR-EXTRACTOR.md` after this Workspace Manager scan.

## Output Format

```json
{
  "tenant": "contelosuxdemo",
  "source": "Browser MCP Workspace Manager scan",
  "url": "https://contelosuxdemo.autodeskplm360.net/plm/admin/workspace-manager",
  "workspaces": [
    {
      "category": "Instance Management",
      "name": "Serial Numbers",
      "description": "",
      "type": "Revision controlled"
    }
  ]
}
```

## Browser Snippet

Run this against the Workspace Manager page. It only reads visible rows/text.

Do not save output when the page shows Autodesk sign-in (`Bei Autodesk anmelden`) or OAuth authorization instead of the Workspace Manager table. Sign in/authorize in Chrome first, then rerun the read-only extraction.

`tools/usecase-miner.js` rejects saved Autodesk sign-in/authorization pages and obvious tokens/cookies/password fields so they cannot become false or unsafe tenant evidence.

```js
(() => {
  const tenant = location.hostname.split('.')[0];
  const typeLabels = [
    'Revision controlled',
    'Mit Revisionskontrolle',
    'Revisioning',
    'Revisionierung',
    'Basic with workflow',
    'Basis mit Arbeitsablauf'
  ];
  const rows = [...document.querySelectorAll('tr')];
  let category = '';
  const workspaces = [];

  for (const row of rows) {
    const cells = [...row.querySelectorAll('td, th')].map(cell => cell.innerText.trim()).filter(Boolean);
    if (cells.length === 0) continue;

    if (cells.length === 1 || /\(\d+\)$/.test(cells[0])) {
      category = cells[0].replace(/\s+\(\d+\)$/, '');
      continue;
    }

    const link = row.querySelector('a');
    const name = link ? link.innerText.trim() : cells[0];
    if (!name || name === 'Name') continue;

    workspaces.push({
      category,
      name,
      description: cells[1] || '',
      type: cells[cells.length - 1] || ''
    });
  }

  if (workspaces.length === 0) {
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
    const lines = (document.body.innerText || '').split('\n').map(line => line.trim()).filter(Boolean);

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
  }

  return {
    tenant,
    source: 'Browser MCP Workspace Manager scan',
    url: location.href,
    workspaces
  };
})();
```

Save the result as:

```text
docs/tenant-discovery/<tenant>-workspace-manager.json
```

Then run:

```powershell
node tools/usecase-miner.js docs/USECASE-MINER-REPORT.md docs/tenant-discovery/<tenant>-workspace-manager.json
```

## Notes

- This snippet intentionally reads visible rows only.
- Scroll/search/filter the Workspace Manager and rerun if the tenant uses lazy loading.
- Do not use it for writes or configuration changes.
