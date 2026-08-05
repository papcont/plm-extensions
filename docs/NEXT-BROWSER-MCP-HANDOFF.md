# Next Browser MCP Handoff

Purpose: run the next Fusion Manage tenant scan without changing tenant data.

## Current Gate

- Tenant: `contelosuxdemo`
- Workspace Manager evidence: 24 rows
- Workspace Editor detail evidence: 0 rows
- In-app browser status: unavailable (`Browser is not available: iab`)
- Chrome status: available, but last observed at Autodesk sign-in/OAuth

## Browser Surface Rule

Use the internal browser when available. If it remains unavailable, use Chrome only after explicit user approval for this task.

Do not click save, create, delete, import, permission changes, workflow changes, script edits, OAuth consent, or tenant write actions.

## First Scan Targets

1. `Service`
2. `Asset Services`
3. `Supplier Packages`
4. `Change Requests`
5. `Change Orders`
6. `Change Tasks`
7. `Design Reviews`
8. `Design Review Tasks`
9. `Items`
10. `Documents`

Why these first:

- `Service` and `Asset Services` decide whether `Service Feedback To Engineering Loop` should be promoted.
- `Supplier Packages` decides whether `Supplier Risk And Readiness Radar` should be promoted or stay inside Supplier Center.
- `Change Requests`, `Change Orders`, and `Change Tasks` decide whether `Change Impact War Room` is justified.
- `Design Reviews` and `Design Review Tasks` decide External Contributor Portal scope.
- `Items` and `Documents` enrich Product Data Traceability and DPP Readiness.

## Files To Use

- Workspace Manager extractor: `docs/BROWSER-WORKSPACE-EXTRACTOR.md`
- Workspace Editor extractor: `docs/BROWSER-WORKSPACE-EDITOR-EXTRACTOR.md`
- Merge command: `npm run usecases:discovery:merge -- ...`
- Scan queue: `docs/BROWSER-TENANT-SCAN-QUEUE.md`
- Coverage report: `docs/TENANT-DISCOVERY-COVERAGE.md`

## Output Files

Use one base file:

```text
docs/tenant-discovery/contelosuxdemo-workspace-manager-enriched.json
```

Use one detail file per Workspace Editor page:

```text
docs/tenant-discovery/contelosuxdemo-service-editor.json
docs/tenant-discovery/contelosuxdemo-asset-services-editor.json
docs/tenant-discovery/contelosuxdemo-supplier-packages-editor.json
docs/tenant-discovery/contelosuxdemo-change-requests-editor.json
docs/tenant-discovery/contelosuxdemo-change-orders-editor.json
docs/tenant-discovery/contelosuxdemo-change-tasks-editor.json
docs/tenant-discovery/contelosuxdemo-design-reviews-editor.json
docs/tenant-discovery/contelosuxdemo-design-review-tasks-editor.json
docs/tenant-discovery/contelosuxdemo-items-editor.json
docs/tenant-discovery/contelosuxdemo-documents-editor.json
```

## Merge Command

```powershell
npm run usecases:discovery:merge -- docs/tenant-discovery/contelosuxdemo-initial.json docs/tenant-discovery/contelosuxdemo-service-editor.json docs/tenant-discovery/contelosuxdemo-asset-services-editor.json docs/tenant-discovery/contelosuxdemo-supplier-packages-editor.json docs/tenant-discovery/contelosuxdemo-change-requests-editor.json docs/tenant-discovery/contelosuxdemo-change-orders-editor.json docs/tenant-discovery/contelosuxdemo-change-tasks-editor.json docs/tenant-discovery/contelosuxdemo-design-reviews-editor.json docs/tenant-discovery/contelosuxdemo-design-review-tasks-editor.json docs/tenant-discovery/contelosuxdemo-items-editor.json docs/tenant-discovery/contelosuxdemo-documents-editor.json docs/tenant-discovery/contelosuxdemo-workspace-manager-enriched.json
```

Then run:

```powershell
npm run usecases -- docs/tenant-discovery/contelosuxdemo-workspace-manager-enriched.json
```

## Done Criteria

- `docs/TENANT-DISCOVERY-COVERAGE.md` shows Workspace Editor detail rows greater than `0`.
- `docs/EXTENSION-PROMOTION-QUEUE.md` gates are updated by real tenant evidence.
- `docs/BROWSER-TENANT-SCAN-QUEUE.md` no longer lists only Workspace Manager evidence for the first scan targets.
- No tokens, cookies, passwords, user lists, OAuth pages, or screenshots with secrets are saved.
- No tenant write actions were taken.
