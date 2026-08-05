# Development Environment Plan

Goal: make this repo the reliable home for core extensions, imported extension projects, customer-specific extensions, and safe browser-based Fusion Manage setup work.

## 1. Baseline

The repo is already a useful runtime:

- Express/Pug server, started with `npm start` or `npm start <tenant>`.
- One base config: `settings.js`.
- Per-tenant runtime files: `environments/<tenant>.js`.
- Per-tenant override files: `settings/<tenant>.js`.
- User-facing apps under `views/apps/` and `public/javascripts/apps/`.
- Development apps under `views/dev/` and `public/javascripts/dev/`.
- Shared UI/panel framework under `public/javascripts/framework/` and `public/javascripts/contents/`.
- Optional Chrome extension under `chrome/`.

Do not replace this with a heavy monorepo system first. The first reliable environment is convention, tenant isolation, and browser verification.

## 2. Target Folder Model

Keep the current app layout and add only thin organization around it:

```text
environments/
  template.js
  <tenant>.js

settings/
  custom.js
  <tenant>.js

docs/
  ADDING-APPLICATIONS.md
  DEVELOPMENT-ENVIRONMENT-PLAN.md

graphify-out/
  .graphify_ast.json
  .graphify_manifest.json
  chunks/
```

For imported external projects, migrate them into the existing seven-piece app shape instead of keeping nested repos inside this repo. If source history matters, keep the original repo as a reference branch or separate remote, not as a runtime dependency.

## 3. Extension Intake Process

For every scattered repo/project, create a short intake record before moving code:

```text
Extension:
Source repo/path:
Target endpoint:
Customer/global:
Tenant dependencies:
Workspaces:
Fields:
BOM views:
Routes needed:
Panels reused:
Browser verification URL:
```

Do not keep complete copied repos as permanent runtime folders. Use them only as source material:

```text
external/
  incoming/
    <source-project>/      temporary, ignored or short-lived
  archived/
    <source-project>.txt   pointer to original path/repo, not copied runtime code
```

Runtime code belongs in this repo's existing app locations:

- shared/core behavior: `public/javascripts/framework/` or `public/javascripts/contents/`,
- standard extension apps: `views/apps/`, `public/javascripts/apps/`, `public/stylesheets/apps/`,
- unstable experiments: `views/dev/`, `public/javascripts/dev/`,
- tenant/customer deltas: `settings/<tenant>.js` and optional `public/javascripts/custom/`.

Then map it to the existing app pattern:

- route in `routes/landing.js`,
- Pug view,
- app JS,
- app CSS,
- custom JS/CSS hooks,
- settings block,
- `server.servicesEnabled` flag,
- optional menu/Chrome entry.

Skip new abstractions until at least two imported extensions need the same missing thing.

An imported extension is "modular" when it can be enabled/disabled by `server.servicesEnabled.<endpoint>` and configured through its settings block. Add a stronger plugin/module layer only after several extensions need independent release, versioning, or installation.

## 4. Tenant Model

Use one environment/settings pair per tenant:

```text
environments/acme-dev.js      -> settings/acme-dev.js
environments/acme-test.js     -> settings/acme-test.js
environments/acme-prod.js     -> settings/acme-prod.js
```

Rules:

- Tenant files name the tenant and redirect URI only.
- Customer settings files contain deltas only.
- Secrets stay in environment variables where possible.
- Production tenant changes are read/compare/export first, write second.

Minimum tenant checklist:

- tenant slug,
- APS client ID source,
- redirect URI,
- `settings` filename,
- workspace ID map,
- field ID map for customized apps,
- required BOM views,
- enabled services,
- Chrome extension entries if used.

## 5. Browser UI/UX Environment

Use the real local server for UI work:

```powershell
npm start <tenant>
```

Then inspect:

- landing/start page,
- target extension endpoint,
- target endpoint with context parameters if relevant,
- desktop viewport,
- mobile/tablet viewport,
- browser console,
- failed network requests,
- OAuth redirect flow when auth is involved.

Preferred browser automation scope:

- open pages,
- capture screenshots,
- inspect console/network failures,
- compare visual layout after CSS/markup changes,
- verify links and controls.

Do not let browser automation mutate Fusion Manage tenant setup unless the action is explicitly approved and the before-state is captured.

## 6. Fusion Manage Tenant Setup Workflow

Reliable setup should be staged:

1. Discover: read tenant/workspace metadata.
2. Compare: use existing admin comparison utilities where possible.
3. Plan: list exact objects to create/change.
4. Backup/export: capture current scripts, picklists, views, workspace config when possible.
5. Apply: perform the smallest approved change.
6. Verify: reload app and inspect the affected UI/API output.
7. Record: summarize changed object names/IDs and follow-up.

Automation should start read-only. Writes need an explicit target tenant and action list.

## 7. Graphify Usage

Graphify is useful here as a repo map:

- `.graphify_detect.json` gives file inventory and corpus size.
- `.graphify_manifest.json` points to chunk lists.
- `.graphify_ast.json` gives nodes, functions, and call edges.
- `chunks/` can scope follow-up reads.

Current hotspots from Graphify:

- `public/javascripts/framework/utils.js`
- `public/javascripts/contents/item.js`
- `public/javascripts/contents/viewer.js`
- `public/javascripts/apps/mbom.js`
- `public/javascripts/admin/comparison.js`
- `public/javascripts/contents/nav.js`

Use Graphify before touching shared framework files. For app-only changes, read the app file and its mounted panel functions first.

## 8. Use-Case Discovery

Use these as the current discovery map for new extensions:

- `docs/EXTENSION-USECASE-BRAINSTORM.md`
- `docs/TENANT-DISCOVERY-SCORECARD.md`

Discovery loop:

1. Inspect the tenant read-only through browser/admin/workspace views.
2. Inventory workspaces, fields, workflows, scripts, relationships, reports, and permissions.
3. Match tenant structures to existing panels and apps.
4. Propose small extension MVPs that can be enabled through `server.servicesEnabled`.
5. Browser-verify the proposed MVP against real tenant pages before automating writes.

First preferred candidate: Supplier Command Center, because this repo already has supplier packages, sourcing, supplier KPIs, pending package indicators, attachments, grids, and item/BOM context.

Local mining helper:

```powershell
node tools/usecase-miner.js
```

This generates `docs/USECASE-MINER-REPORT.md` from `settings.js`. Candidate archetypes come from `exports.applications.workspaceHealth.archetypes`, so the local report and `/workspace-health` use the same list.

With browser/tenant evidence:

```powershell
node tools/usecase-miner.js docs/USECASE-MINER-REPORT.md docs/tenant-discovery/contelosuxdemo-initial.json
```

Browser extraction helper: `docs/BROWSER-WORKSPACE-EXTRACTOR.md`.

Usecase automation index: `docs/USECASE-AUTOMATION-INDEX.md`.

Repeatable discovery pipeline: `docs/USECASE-DISCOVERY-PIPELINE.md`.

Customer/project onboarding: `docs/PROJECT-ONBOARDING.md`.

The matching tenant-side MVP is `docs/WORKSPACE-HEALTH-SCANNER-MVP.md`.

## 9. Skills And Agent Library

Default order:

1. Repo docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `docs/ADDING-APPLICATIONS.md`.
2. Graphify outputs for orientation.
3. Local code search with `rg`.
4. Browser/playwright-style verification for visible UI changes.
5. Harmonia-MCP / `harmonia-inventor-2026` for approved Inventor-related work only.

Do not use Unity or alternate Inventor orchestration MCPs in this repo.

## 10. Verification Matrix

For each extension:

```text
Tenant:
Command:
Endpoint:
Auth mode:
Required servicesEnabled flag:
Required workspace IDs:
Required field IDs:
Required BOM views:
Desktop screenshot:
Mobile screenshot:
Console errors:
Failed requests:
Tenant writes performed:
Rollback/export location:
```

This can live in the task notes until it becomes repetitive. Add a tracked template only after it is used more than once.

## 11. Implementation Phases

### Phase 1: Repo Guardrails

- Add `AGENTS.md`.
- Use this plan as the environment baseline.
- Keep customer configuration out of `settings.js`.
- Define MCP boundary.

### Phase 2: Tenant Registry

- Create environment/settings pairs for active tenants.
- Normalize tenant filenames.
- Confirm redirect URIs and workspace IDs.
- Keep secrets in environment variables.

### Phase 3: Extension Consolidation

- Inventory scattered repos.
- Import one extension at a time.
- Map each to the seven-piece app pattern.
- Reuse panels from `registry.js` and `/studio`.

### Phase 4: Browser Verification

- Start local tenant server.
- Inspect target apps through browser automation.
- Capture screenshots.
- Check console/network failures.
- Record verification matrix.

### Phase 5: Tenant Setup Automation

- Start with read-only discovery and comparison.
- Use admin comparison utilities where possible.
- Add write automation only for repeated, approved setup tasks.
- Log changed tenant objects after every write.

### Phase 6: Use-Case Mining

- Run read-only tenant/workspace discovery.
- Score candidate extension ideas by pain, data availability, workflow activity, customer reuse, and effort.
- Build one read-only MVP first.
- Add write actions only after the read-only cockpit is useful.

## 12. First Practical Next Steps

1. Pick one customer tenant and create/check its `environments/<tenant>.js` plus `settings/<tenant>.js`.
2. Pick one scattered extension repo and fill the intake record.
3. Import it into the seven-piece app shape.
4. Run `npm start <tenant>`.
5. Browser-verify the extension endpoint.
6. Record tenant-specific IDs in the customer settings delta.
