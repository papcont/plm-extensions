# Tenant Discovery Scorecard

Use this when inspecting a Fusion Manage tenant through browser MCP. Keep the first pass read-only.

## Browser MCP Preflight

```text
Tenant URL:
Browser MCP connected:
Signed in user:
Read-only pass only: yes
Date:
Screenshots captured:
Console/network checked:
```

If Browser MCP is not connected, connect the active tab from the browser toolbar first. Do not continue with write actions from screenshots alone.

Use `docs/BROWSER-WORKSPACE-EXTRACTOR.md` to turn visible Workspace Manager rows into miner input JSON.

## Workspace Inventory

For each workspace/category visible in Workspace Manager:

```text
Category:
Workspace:
Workspace ID:
Type:
Revision controlled:
Description:
Warning icon:
Item count / activity signal:
Workflow states:
Tabs:
Key fields:
Relationships:
Scripts:
Reports:
Permissions / external users:
Existing repo match:
Extension candidate:
```

## Scoring

Score each cluster from 0 to 3.

```text
Cluster:
Workspaces:

User pain:
Data already available:
Workflow activity:
Cross-workspace relationships:
External stakeholder value:
Compliance / audit value:
Existing panel reuse:
Customer reuse potential:
Implementation effort inverse:

Total:
Recommended MVP:
Read-only first screen:
Write actions to defer:
```

Scoring guide:

- `0`: no evidence.
- `1`: weak or speculative.
- `2`: clear tenant evidence.
- `3`: strong tenant evidence plus existing repo building blocks.

Prioritize totals above 18. Build read-only first.

## Extension Archetype Mapping

```text
Supplier/package/quote/lead-time fields -> Supplier Command Center
Supplier + quality + late package fields -> Supplier Risk Radar
Material/compliance/carbon/REACH/RoHS -> DPP Readiness
Change + affected items + BOM + supplier exposure -> Change Impact War Room
Problem report/NCR/CAPA/SCAR -> Quality Closure Cockpit
Requirement + relationship coverage -> Requirements Coverage Matrix
Project/task/milestone/deliverable -> NPI Launch Readiness Board
Asset/serial/service/equipment -> Installed Base Service Cockpit
Variant/configuration/option -> Variant Governance Cockpit
Design review/review task/markup -> Design Review Closure Cockpit
Spare part/request/service part -> Spare Parts Request Desk
Test/validation/meeting -> Test And Validation Evidence Hub
Many active workspaces but unclear extension fit -> Workspace Health Scanner
External user/package/review/task -> External Contributor Portal
```

## MVP Blueprint Links

```text
Supplier Command Center -> docs/SUPPLIER-COMMAND-CENTER-MVP.md
Installed Base Service Cockpit -> docs/INSTALLED-BASE-SERVICE-COCKPIT-MVP.md
Workspace Health Scanner -> docs/WORKSPACE-HEALTH-SCANNER-MVP.md
Design Review Closure Cockpit -> docs/DESIGN-REVIEW-CLOSURE-COCKPIT-MVP.md
Spare Parts Request Desk -> docs/SPARE-PARTS-REQUEST-DESK-MVP.md
Variant Governance Cockpit -> docs/VARIANT-GOVERNANCE-COCKPIT-MVP.md
Test And Validation Evidence Hub -> docs/TEST-AND-VALIDATION-EVIDENCE-HUB-MVP.md
NPI Launch Readiness Board -> docs/NPI-LAUNCH-READINESS-BOARD-MVP.md
Product Release Readiness Cockpit -> docs/PRODUCT-RELEASE-READINESS-COCKPIT-MVP.md
```

## First Evidence From Current Tenant Read

Visible URL:

```text
https://contelosuxdemo.autodeskplm360.net/plm/admin/workspace-manager
```

Visible categories/workspaces from screenshot plus Chrome read-only extraction:

```text
Instance Management (5)
- Service
- Serial Numbers
- Motors
- Sensors
- Control Elements

Product Development (9)
- Items
- VIES Freigabe
- Item Variants
- Documents
- Design Reviews_old
- Design Reviews
- Design Review Tasks_old
- Design Review Tasks
- Spare Parts Request
```

Immediate candidates:

1. Installed Base Service Cockpit
   - Uses Service, Serial Numbers, Motors, Sensors, Control Elements.
   - Likely value: equipment/component lifecycle, service history, spare parts, recurring failures.
   - Existing repo base: `service`, `abom`, `instances`, asset/serial workspace config.

2. Smart Component Health / IoT Readiness Cockpit
   - Uses Motors, Sensors, Control Elements.
   - Likely value: connect physical components, maintenance, status, replacement history.
   - MVP should stay manual/read-only until real sensor data exists.

3. Product Release / VIES Approval Cockpit
   - Uses Items and `VIES Freigabe`.
   - Likely value: release readiness, missing approvals, affected BOMs, open supplier/quality blockers.
   - Existing repo base: workflow history, BOM, change impact, dashboard.

4. Variant Governance Cockpit
   - Uses `Item Variants` and the existing local `variants` app.
   - Likely value: released variant completeness, option consistency, linked base item context.
   - Existing repo base: Variants Manager, item/BOM panels, workflow history.

5. Design Review Closure Cockpit
   - Uses Design Reviews and Design Review Tasks.
   - Likely value: close reviews faster, track open tasks/markups, expose stale reviews.
   - Existing repo base: review/task settings, attachments, item context, external contributor portal concept.

6. Spare Parts Request Desk
   - Uses Spare Parts Request, Service, Serial Numbers, and item/BOM context.
   - Likely value: connect service demand back to sourcing, engineering change, and installed base.
   - Existing repo base: service portal, spare part request workspace config, sourcing, problem reports.

7. Test And Validation Evidence Hub
   - Uses `VISI_TEST`, `VisiTEST`, and `VisiTEST_Meeting`.
   - Likely value: validation evidence, meeting outcomes, and linked item/change context in one audit-ready view.
   - Existing repo base: attachments, workflow panels, item context, design review/task patterns.

Only the visible part of the Workspace Manager has been discovered. Finish the full pass with connected browser scrolling and workspace detail reads before building write actions.

Captured initial evidence file:

```text
docs/tenant-discovery/contelosuxdemo-initial.json
```

Regenerate the ranked report with:

```powershell
node tools/usecase-miner.js docs/USECASE-MINER-REPORT.md docs/tenant-discovery/contelosuxdemo-initial.json
```
