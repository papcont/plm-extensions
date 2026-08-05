# Usecase Discovery Pipeline

Goal: repeatedly derive extension candidates from repo evidence plus read-only Fusion Manage tenant evidence.

Short index: `docs/USECASE-AUTOMATION-INDEX.md`.

## Inputs

- `settings.js`
- `settings/<tenant>.js` when available
- `docs/tenant-discovery/*.json`
- `docs/tenant-discovery/*.txt` copied from visible Workspace Manager text
- optional Workspace Editor details in JSON: fields, tabs, sections, workflow states/transitions, relationships, reports/views, scripts, permissions
- `exports.applications.workspaceHealth.archetypes`
- visible Workspace Manager evidence from browser read-only scans

## Loop

```text
1. Read Workspace Manager visible rows with `docs/BROWSER-WORKSPACE-EXTRACTOR.md`.
2. Open selected Workspace Editor pages read-only and capture details with `docs/BROWSER-WORKSPACE-EDITOR-EXTRACTOR.md`.
3. Merge Workspace Editor details with `npm run usecases:discovery:merge -- <base.json> <editor-detail.json> [editor-detail-2.json ...] <out.json>`.
4. For the next Contelos browser pass, follow `docs/NEXT-BROWSER-MCP-HANDOFF.md`.
5. Save evidence as `docs/tenant-discovery/<tenant>-workspace-manager.json`, or as `.txt` when you only copied visible page text. Use `docs/tenant-discovery/WORKSPACE-EDITOR-DISCOVERY-TEMPLATE.json` when Workspace Editor details are available.
6. Run the pipeline with that evidence file.
7. Review `docs/USECASE-MINER-REPORT.md` for evidence details.
8. Review `docs/EXTENSION-CANDIDATE-BACKLOG.md` for build order.
9. Review `docs/EXTENSION-PORTFOLIO-BRIEF.md` for the presentation/demo story.
10. Review `docs/PLM-PAIN-TO-EXTENSION-MAP.md` for external PLM pressure mapped to repo candidates.
11. Review `docs/EXTENSION-PITCH-CARDS.md` for quick customer/internal presentation.
12. Review `docs/EXTENSION-REUSE-MAP.md` for existing panels to reuse before writing UI.
13. Review `docs/TENANT-EXTENSION-ADOPTION-MATRIX.md` for tenant-specific workspace ID gaps.
14. Review `docs/BROWSER-TENANT-SCAN-QUEUE.md` for the next read-only Workspace Manager targets.
15. Review `docs/TENANT-DISCOVERY-COVERAGE.md` to see which Workspace Editor details are still missing.
16. Review `docs/TENANT-WORKSPACE-USECASE-MAP.md` to see which extension candidates each tenant workspace supports.
17. Review `docs/USECASE-DECISION-GATES.md` to see which planned candidates can be promoted after Workspace Editor evidence.
18. Review `docs/EXTENSION-WHITESPACE-RADAR.md` for brainstormed candidates not yet in the archetype loop.
19. Review `docs/EXTENSION-PROMOTION-QUEUE.md` for planned candidates ready to enter the archetype/backlog loop.
20. Review unmapped tenant workspace signals for new archetypes we have not thought of yet.
21. Pick the highest candidate with strong tenant evidence and an existing MVP blueprint.
22. Build read-only first screen.
23. Run `node tools/verify-extension-shells.js`.
24. Run `node tools/render-extension-previews.js <discovery-file>` when OAuth blocks live browser review.
25. Run `node tools/render-tenant-extension-template.js <tenant> <discovery-file>` for a tenant override starter.
26. Browser-check local endpoint before planning tenant write actions.
```

## Commands

```powershell
npm run usecases:discovery:verify
npm run usecases -- docs/tenant-discovery/contelosuxdemo-initial.json
node tools/usecase-miner.js docs/USECASE-MINER-REPORT.md docs/tenant-discovery/contelosuxdemo-initial.json
npm run usecases:verify
npm run usecases:previews -- docs/tenant-discovery/contelosuxdemo-initial.json
node tools/render-tenant-extension-template.js contelosuxdemo docs/tenant-discovery/contelosuxdemo-initial.json
```

Shortcut:

```powershell
npm run usecases -- docs/tenant-discovery/contelosuxdemo-initial.json
```

Text import also works:

```powershell
npm run usecases -- docs/tenant-discovery/contelosuxdemo-workspace-manager-visible.txt
```

Malformed `.json` discovery files, Autodesk login/OAuth pages, and files containing obvious tokens/cookies/password fields fail early. Save only real Workspace Manager or Workspace Editor evidence.

For a Chrome-visible partial scan, keep a separate report first, then regenerate the main report from the full tenant discovery:

```powershell
node tools/usecase-miner.js docs/USECASE-MINER-BROWSER-VISIBLE-REPORT.md docs/tenant-discovery/contelosuxdemo-workspace-manager-chrome-visible-2026-07-29.txt
node tools/usecase-miner.js docs/USECASE-MINER-REPORT.md docs/tenant-discovery/contelosuxdemo-initial.json
```

## Scoring

```text
repo workspace match: 3 points
tenant-discovered workspace match: 4 points
matching application: 2 points
matching menu entry: 1 point
```

`workspaceHealth` is excluded from matching application evidence because it is the meta-scanner.

Candidate app configs and candidate menu entries are excluded from evidence scoring. Build progress is tracked in the separate implementation status column.

Tenant workspace matching scores only the workspace name. Category and description stay in evidence, but are not scored because Fusion Manage categories/template descriptions often contain broad words like project, lifecycle, or asset.

Implementation status is local-file based: `implemented` means route, Pug view, and app/admin script exist for the endpoint; `partial` means only some exist; `planned` means none exist yet.

Unmapped tenant workspace signals are workspace names that did not match any configured archetype keyword. Treat them as the brainstorming queue for net-new extension candidates.

## Write Boundary

No tenant writes from this pipeline. Tenant setup automation starts only after a read-only candidate is validated and the target tenant, object list, before-state export, expected action, and rollback path are named.
