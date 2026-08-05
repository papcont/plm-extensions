# Workspace Health Scanner MVP

Goal: make use-case mining repeatable inside a Fusion Manage tenant.

Start read-only. This scanner recommends extension candidates; it does not change tenant setup.

## Why This Exists

The current process needs two evidence sources:

- local repo signal from `tools/usecase-miner.js`,
- live tenant signal from Workspace Manager / workspace metadata.

Workspace Health Scanner is the small bridge between both. It reads workspace metadata and scores which extension archetypes fit.

## Existing Repo Base

No new server routes needed for MVP.

Existing endpoints:

- `/plm/workspaces`
- `/plm/workspace`
- `/plm/workspace-counter`
- `/plm/workspace-scripts`
- `/plm/workspace-all-relationships`
- `/plm/workspace-print-views`
- `/plm/workspace-workflow-states`
- `/plm/workspace-workflow-transitions`
- `/plm/permissions-definition`
- `/plm/permissions`

Existing app patterns:

- `admin/shortcuts` already lists workspaces and links to workspace editor tabs.
- `admin/comparison` already reads workspace settings, tabs, workflow, scripts, print views, permissions, relationships.
- `admin/insights` already counts workspace activity.

## App Shape

```text
endpoint: /workspace-health
settings key: workspaceHealth
title: Workspace Health Scanner
route: routes/landing.js
view: views/admin/workspace-health.pug
script: public/javascripts/admin/workspace-health.js
style: public/stylesheets/admin/workspace-health.css
custom script: none for MVP
custom style: none for MVP
```

Use `admin/` instead of `apps/` because this is a tenant/admin discovery utility.

Minimal shell status: implemented. It loads `/plm/workspaces`, scores workspaces locally against extension archetype keywords, loads read-only details for a selected workspace, can sequentially scan currently visible workspaces, renders ranked candidates, and exports markdown.

The same `workspaceHealth.archetypes` list is used by `tools/usecase-miner.js`, keeping the browser scanner and generated report aligned.

## Read-Only First Screen

```text
Header
- scan button
- workspace filter
- category filter
- export markdown

Left
- workspace/category list
- score badges

Center
- selected workspace health details
- metadata completeness
- workflow/scripts/relationships/permissions signals

Right
- recommended extension archetypes
- missing data checklist
- direct admin links
```

## Scoring Signals

Score each workspace/cluster from visible tenant metadata:

```text
item count/activity
has workflow states
has workflow transitions
has scripts
has relationships
has BOM relationships
has managed-item relationships
has grid/tab structure
has print views/reports
has permissions/external role signals
matches known workspace keywords
matches existing repo app/panel patterns
```

## Archetype Mapping

Reuse the mapping from `docs/TENANT-DISCOVERY-SCORECARD.md`:

- supplier/package/quote -> Supplier Command Center
- asset/serial/service/equipment -> Installed Base Service Cockpit
- change/release -> Product Release Readiness Cockpit
- quality/problem/NCR -> Quality Closure Cockpit
- requirement/review -> Requirements Coverage Matrix
- project/task/milestone -> NPI Launch Readiness Board
- material/compliance/carbon -> DPP Readiness

## Minimum Settings Shape

```js
exports.applications.workspaceHealth = {
    limit : 1000,
    archetypes : [{
        name : 'Installed Base Service Cockpit',
        url  : '/installed-base-service',
        keys : ['asset', 'serial', 'equipment', 'service', 'motor', 'sensor', 'control']
    }]
};
```

Keep permissions disabled by default because they may be slower and more sensitive.

## MVP User Stories

1. As an admin, I scan all workspaces and see which ones are extension-ready.
2. As a consultant, I see recommended extension archetypes per workspace cluster.
3. As a developer, I export a markdown discovery report for the next extension.
4. As a tenant owner, I see missing metadata that blocks a good extension.

## Deferred Write Actions

- create workspace,
- create fields,
- update scripts,
- update permissions,
- generate app files automatically.

Add file generation only after the scanner's recommendations are reliable across at least two tenants.

## Acceptance Check

```text
npm start <tenant>
open /workspace-health
scan returns workspace list
workspace details render
workflow/script/relationship signals render
recommended archetypes render
export markdown works
console has no new errors
failed network requests understood
```

## First Implementation Shortcut

Start from `admin/shortcuts` workspace listing and reuse API calls from `admin/comparison`.

Skipped for MVP: graph database, ML scoring, write automation.
