# Browser Workspace Editor Extractor

Use this when Browser MCP is connected to a Fusion Manage Workspace Editor page.

Goal: enrich a Workspace Manager discovery JSON with read-only Workspace Editor signals that `tools/usecase-miner.js` can score.

## Output Shape

Add the returned object to the matching entry in `docs/tenant-discovery/<tenant>-workspace-manager.json`:

```json
{
  "name": "Supplier Packages",
  "fields": ["Supplier", "Due Date"],
  "tabs": ["Item Details", "Workflow Actions"],
  "workflowStates": ["Open", "Closed"],
  "workflowTransitions": ["Submit", "Close"],
  "relationships": ["Items", "Problem Reports"],
  "reports": ["Open Supplier Packages"],
  "scripts": ["none captured"],
  "permissions": ["roles only; no users, no secrets"]
}
```

## Browser Snippet

Run this against one Workspace Editor page. It only reads visible text.

Do not save output when the page shows Autodesk sign-in, OAuth authorization, tokens, cookies, user lists, or credential-like values. `tools/usecase-miner.js` rejects obvious unsafe discovery files, but the browser scan should avoid collecting them in the first place.

```js
(() => {
  const text = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const uniq = (values) => [...new Set(values.map(text).filter(Boolean))].slice(0, 80);
  const visible = (element) => {
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.offsetParent !== null;
  };
  const read = (selector) => uniq([...document.querySelectorAll(selector)].filter(visible).map((element) => element.innerText || element.textContent));
  const body = document.body.innerText || '';
  const unsafe = /Bei Autodesk anmelden|OAuth authorization|Authorization\s*[:=]\s*Bearer|access_token|refresh_token|id_token|client_secret|password|Cookie\s*[:=]/i;

  if (unsafe.test(body)) {
    return { error: 'Unsafe or non-workspace page. Do not save as discovery evidence.' };
  }

  const heading = text(document.querySelector('h1, h2, .workspace-title, .page-title')?.innerText);
  const labels = read('label, th, td:first-child, .field-label, .form-label, .field-name');
  const tabs = read('[role="tab"], .tab, .tabs li, nav a');
  const links = read('a, button').filter((value) => value.length < 80);
  const states = links.filter((value) => /open|draft|review|approve|approved|reject|rejected|release|released|close|closed|complete|completed|submit|pending|supplier|workflow/i.test(value));
  const relations = labels.filter((value) => /relationship|related|item|document|supplier|problem|non.?conformance|change|task|review|asset|serial|spare/i.test(value));
  const reports = links.filter((value) => /report|view|dashboard|audit/i.test(value));
  const scripts = links.filter((value) => /script|validation|condition|action/i.test(value));
  const permissions = links.filter((value) => /permission|role|group|read|write|view/i.test(value));

  return {
    name: heading || text(document.title).replace(/[-|].*$/, ''),
    sourceUrl: location.href,
    fields: labels,
    tabs,
    sections: read('h2, h3, legend, .section-title, .panel-title'),
    workflowStates: states,
    workflowTransitions: states,
    relationships: relations,
    reports,
    views: reports,
    scripts,
    permissions
  };
})();
```

## Merge Rule

Keep Workspace Manager data as the source of truth for `category`, `name`, `description`, and `type`.

Merge only read-only Workspace Editor details into the matching workspace object:

```json
{
  "category": "Product Development",
  "name": "Supplier Packages",
  "type": "Basic with workflow",
  "fields": ["Supplier", "Due Date"],
  "workflowStates": ["Open", "Closed"]
}
```

You can merge the Workspace Editor result into the Workspace Manager discovery with:

```powershell
npm run usecases:discovery:merge -- docs/tenant-discovery/<tenant>-workspace-manager.json docs/tenant-discovery/<tenant>-workspace-editor-detail.json docs/tenant-discovery/<tenant>-workspace-manager-enriched.json
```

Multiple Workspace Editor detail files can be merged in one run:

```powershell
npm run usecases:discovery:merge -- docs/tenant-discovery/<tenant>-workspace-manager.json docs/tenant-discovery/<tenant>-service-editor.json docs/tenant-discovery/<tenant>-supplier-editor.json docs/tenant-discovery/<tenant>-workspace-manager-enriched.json
```

Then run:

```powershell
npm run usecases -- docs/tenant-discovery/<tenant>-workspace-manager-enriched.json
```

## Boundary

- Do not click save, create, delete, import, permission changes, workflow changes, or script edits.
- Do not store user lists, emails, tokens, cookies, OAuth pages, or screenshots with secrets.
- Capture names and configuration labels only.
