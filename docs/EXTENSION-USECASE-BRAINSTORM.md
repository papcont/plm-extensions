# Extension Use-Case Brainstorm

Purpose: derive new Fusion Manage extensions from existing apps, tenant workspaces, and urgent PLM pain points.

Current pain-to-extension crosswalk: `docs/PLM-PAIN-TO-EXTENSION-MAP.md`.

## Evidence Used

Repo evidence:

- Existing workspaces already include items, change orders/requests/tasks, design reviews, requirements, products, projects, problem reports, non-conformances, spare part requests, supplier packages, assets, serial numbers, and equipment service records.
- `settings.js` already models Supplier Packages as "Supplier Collaboration Platform" with details, attachments, line items, and workflow progress.
- `explorer` already has KPIs for vendor, country, long lead time, pending packages, REACH, RoHS, carbon emissions, and quality inspection.
- `insertSourcing` already renders suppliers, manufacturer data, lead time, and unit cost.
- `impactanalysis` already shows pending supplier packages beside stock and production order quantities.

External evidence:

- Autodesk positions Fusion Manage around connected PLM workflows, BOM/change/task/supplier/quality/NPI/requirements, dashboards, APIs, mobile access, and external collaboration: https://www.autodesk.com/products/fusion-360/fusion-manage
- Autodesk's supply-chain PLM page names the common mess directly: emails, spreadsheets, file links, supplier data, compliance, quoting, reviews, ERP/CRM integration, supplier quality, risk, and traceability: https://www.autodesk.com/industry/design-manufacturing/plm/supply-chain-collaboration
- EU Digital Product Passport is now a concrete compliance driver. The EU describes DPP as product/component/material identity data for sustainability, circularity, legal compliance, traceability, role-based access, and a live registry since 20 July 2026: https://single-market-economy.ec.europa.eu/single-market/digital-product-passport_en
- Deloitte's 2026 manufacturing outlook calls out global supply-chain complexity and digital tools as a major operating theme: https://www.deloitte.com/us/en/insights/industry/manufacturing-industrial-products/manufacturing-industry-outlook.html
- NIST frames Digital Thread work as connecting design, manufacturing, and product support information to speed design-to-production and reduce cost: https://www.nist.gov/programs-projects/digital-thread-smart-manufacturing
- Autodesk describes digital thread as unifying product information across the lifecycle into a real-time single source of truth: https://www.autodesk.com/solutions/design-manufacturing/digital-thread
- Digital-thread discussions keep pointing at fragmented data, traceability, interoperability, product complexity, change tracking, extensive configurations, and disconnected supply chains: https://www.automationworld.com/factory/digital-transformation/article/55294866/digital-threads-transforming-plm-into-a-strategic-asset and https://aras.com/en/news/press-releases/2025/05/89-of-industrial-companies-recognize-the-digital-thread-is-essential-to-success

## Automation Idea: Use-Case Miner

When a browser MCP or internal browser session is available for a Fusion Manage tenant, use it read-only first:

1. Open tenant admin and workspace editor.
2. Inventory workspaces, tabs, sections, fields, workflows, states, transitions, scripts, relationships, permissions, and reports.
3. Compare tenant objects with this repo's known patterns: BOM, sourcing, attachments, grid, details, search, workflow, reports, change impact, service, project, requirements.
4. Cluster workspaces by business process:
   - supplier collaboration,
   - quality/non-conformance,
   - change/release,
   - requirements/specification,
   - service/spare parts,
   - project/NPI,
   - compliance/sustainability,
   - assets/installed base.
5. Score each cluster:
   - user pain,
   - data already available,
   - workflow activity,
   - number of related workspaces,
   - external stakeholder value,
   - reusability across customers,
   - effort using existing panels.
6. Generate candidate extension briefs.

No write automation in this phase. Tenant writes need explicit approval and an export/rollback path.

Use `docs/TENANT-DISCOVERY-SCORECARD.md` for the actual tenant scan. The scorecard turns visible Workspace Manager evidence into ranked extension candidates.

## Extension Candidates

### 1. Supplier Command Center

Pain: supplier work hides in emails, spreadsheets, old attachments, and individual packages.

Existing base:

- `supplierPackages`,
- `sparePartsRequests`,
- item sourcing,
- `insertSourcing`,
- attachments,
- workflow progress,
- explorer KPIs: vendor, country, long lead time, pending packages.

MVP:

- one dashboard per supplier,
- open supplier packages,
- quote/lead-time table,
- affected items/BOM context,
- pending tasks and late deliverables,
- supplier package creation from selected BOM rows.

Why good: this is probably the strongest next extension because this repo already has most data and Autodesk's own PLM narrative pushes supplier collaboration hard.

### 2. Supplier Risk And Readiness Radar

Pain: teams know a supplier is risky only after a delay or quality issue.

Existing base:

- supplier packages,
- non-conformances,
- problem reports,
- quality inspection fields,
- country/vendor/lead-time KPIs,
- workflow states.

MVP:

- supplier score from open packages, late packages, failed inspections, long lead time, country, missing compliance,
- drill-down to affected items and BOMs,
- simple red/yellow/green table,
- exportable risk list.

Skipped for MVP: predictive model. Add it only after historical outcomes are clean enough.

### 3. Digital Product Passport Readiness

Pain: DPP needs product/component/material/compliance data across the lifecycle; most tenants will have gaps.

Existing base:

- item details,
- BOM traversal,
- attachments,
- REACH/RoHS/carbon KPIs,
- supplier/source data,
- classification,
- change history.

MVP:

- select item/product,
- collect BOM, material, supplier, compliance, attachments, lifecycle state,
- show missing DPP fields,
- generate internal readiness report,
- QR/data-carrier placeholder only, no official registry submission.

Why now: EU DPP Registry became operational on 20 July 2026; batteries start mandatory 18 February 2027, with other product groups following.

### 4. Change Impact War Room

Pain: impact analysis exists, but cross-functional decisions still require many screens.

Existing base:

- `impactanalysis`,
- BOM/where-used,
- supplier package pending count,
- stock/order indicators,
- relationships,
- attachments,
- workflow history.

MVP:

- one page for a change request/order,
- affected items,
- BOM parents,
- supplier/open package exposure,
- service/spare-part exposure,
- compliance exposure,
- open tasks and blockers.

### 5. Quality Closure Cockpit

Pain: NCR/Problem Reports/CAPA-like work often lacks a single closure view.

Existing base:

- `problemReports`,
- `nonConformances`,
- dashboard route with `wsId`,
- attachments,
- workflow history,
- related items,
- supplier data.

MVP:

- quality issue queue,
- root-cause/affected-item view,
- related supplier packages,
- open corrective actions,
- time-in-state and overdue indicators.

### 6. Requirements Coverage Matrix

Pain: requirements exist, but coverage to items, tests, design reviews, and change processes is hard to see.

Existing base:

- requirements workspace,
- specification editor,
- relationships,
- design reviews/tasks,
- item details,
- change processes.

MVP:

- requirement tree,
- coverage indicators,
- linked item/design review/change records,
- orphan requirements,
- changed items without requirement review.

### 7. NPI Launch Readiness Board

Pain: NPI readiness spans projects, tasks, BOM, supplier packages, quality, and attachments.

Existing base:

- projects/projectTasks,
- items/BOM,
- supplierPackages,
- quality dashboards,
- attachments,
- workflow progress.

MVP:

- one launch board per product/project,
- milestones,
- missing deliverables,
- supplier readiness,
- quality blockers,
- BOM maturity.

### 8. Service Feedback To Engineering Loop

Pain: service issues and spare-parts requests do not always become engineering change signals.

Existing base:

- service portal,
- sparePartsRequests,
- problemReports,
- equipments/assets/serial numbers,
- item/BOM details.

MVP:

- installed-base item view,
- recurring service issues,
- spare part demand,
- suggested problem report/change request,
- affected product family summary.

### 9. Workspace Health Scanner

Pain: admins do not quickly see which workspaces are extension-ready.

Existing base:

- admin comparison,
- workspace metadata endpoints,
- scripts/permissions/reports/workflow endpoints,
- Graphify orientation.

MVP:

- read-only tenant scan,
- workspace score: fields present, workflow active, relationships, scripts, reports, permissions,
- suggested extension archetype per workspace,
- missing setup checklist.

This is the meta-extension that helps discover all other extensions.

### 10. External Contributor Portal

Pain: suppliers/customers need narrow, safe access without dumping them into full PLM complexity.

Existing base:

- mobile client,
- design reviews,
- supplier packages,
- attachments,
- workflow actions,
- comments/markups.

MVP:

- one simplified external view,
- assigned packages/reviews/tasks,
- attachments and markups,
- approve/reject/comment actions,
- no admin-visible internals.

### 11. Installed Base Service Cockpit

Pain: asset/service teams need one view of serial numbers, components, service events, spare parts, and engineering context.

Existing base:

- `service`,
- `abom`,
- `instances`,
- asset/serial/equipment workspace settings,
- BOM/details/attachments/workflow panels.

MVP:

- select serial number or component,
- show service history,
- show linked item/BOM and attachments,
- show open problem reports/spare part requests,
- show related motors/sensors/control elements when present.

First tenant signal: current Workspace Manager screenshot shows `Instance Management` with Service, Serial Numbers, Motors, Sensors, and Control Elements.

### 12. Product Release Readiness Cockpit

Pain: release approval work is spread across item data, workflows, BOM state, supplier readiness, quality blockers, and attachments.

Existing base:

- item/BOM panels,
- workflow history,
- change impact,
- supplier package indicators,
- dashboards.

MVP:

- select item/release record,
- show workflow status,
- show missing release data,
- show BOM maturity,
- show supplier/quality/service blockers,
- show required attachments.

First tenant signal: current Workspace Manager screenshot shows `Product Development` with Items and `VIES Freigabe`.

### 13. Variant Governance Cockpit

Pain: variant rules, released item variants, and option decisions become hard to audit when configuration work sits between item master, approvals, and local extension UI.

Existing base:

- `variants` app,
- item/BOM panels,
- workflow history,
- local FM tabs already showing workspace 241 item variants,
- Product Development workspace `Item Variants`.

MVP:

- show variant families and released variants,
- compare option/attribute completeness,
- show approval state and linked base item,
- list inconsistent or unreleased variants,
- export variant readiness for engineering review.

First tenant signal: Chrome read-only extraction shows `Item Variants` in Product Development and several open local `Variants Manager` tabs.

### 14. Design Review Closure Cockpit

Pain: design reviews create tasks, markups, and comments, but closure status is often split across review records, review tasks, attachments, and item context.

Existing base:

- design reviews,
- design review tasks,
- attachments,
- item details,
- workflow panels,
- external contributor portal concept.

MVP:

- review queue by status,
- open tasks and assignees,
- linked items/documents,
- missing attachments/markup response checklist,
- overdue closure and stale review indicators.

First tenant signal: Chrome read-only extraction shows `Design Reviews`, `Design Reviews_old`, `Design Review Tasks`, and `Design Review Tasks_old`.

### 15. Spare Parts Request Desk

Pain: spare-part demand is a strong service-to-engineering signal, but requests usually stay operational and are not connected back to item/BOM/change context.

Existing base:

- `sparePartsRequests`,
- service portal,
- item/BOM panels,
- supplier sourcing,
- problem reports,
- installed-base concept.

MVP:

- request queue by item/component,
- requested quantity and urgency,
- linked serial/equipment context when available,
- sourcing/supplier availability,
- one-click handoff candidate for problem report or change request, kept read-only for MVP.

First tenant signal: Chrome read-only extraction shows `Spare Parts Request` in Product Development.

### 16. Test And Validation Evidence Hub

Pain: test evidence, validation meetings, and closure decisions often sit in separate records and are hard to review for audits or release readiness.

Existing base:

- item details,
- attachments,
- workflow panels,
- design review/task patterns,
- change impact context.

MVP:

- queue of test records and meetings,
- selected test with linked item/document context,
- missing evidence checklist,
- open meeting actions,
- related design review/change blockers.

First tenant signal: Chrome read-only extraction shows `VISI_TEST`, `VisiTEST`, and `VisiTEST_Meeting`.

### 17. Product Data Traceability Hub

Pain: product teams need one trusted line between item master, documents, product context, BOM evidence, and release/change state. In the current tenant, `Items` and `Documents` were unmapped signals, which means they are core data but not yet represented as a dedicated extension archetype.

Existing base:

- item details,
- document attachments,
- BOM panels,
- product portfolio/catalog patterns,
- change/release readiness views,
- classification and explorer KPIs.

MVP:

- select item or product,
- show linked documents and attachments,
- show BOM/documentation completeness,
- show release/change context,
- list missing master-data and documentation signals,
- export traceability package for review.

First tenant signal: use-case miner unmapped section shows `Items`, `Documents`, and repo key `products`.

### 18. BOM Export And Attachment Studio

Pain: BOM snapshots are often exported by hand, reformatted in Excel, or attached inconsistently as review evidence.

Existing base:

- item/BOM panels,
- BOM view selector,
- existing `/plm/excel-export` BOM sheet support,
- attachments tab and `/plm/upload/:wsId/:dmsId`,
- `Tree Navigator` BOM view convention,
- PDF/report need from release, supplier, service, and compliance work.

MVP:

- select item,
- choose BOM view, depth, and revision bias,
- preview flattened BOM rows,
- export Excel, CSV, or PDF from the selected view,
- choose local PDF layout template,
- optionally attach generated file back to the item after explicit write confirmation.

First tenant signal: current discovery shows `Product Development / Items`; Workspace Editor scan must confirm BOM and attachments tab access.

## Prioritization

Build first:

1. Supplier Command Center.
2. Workspace Health Scanner.
3. Digital Product Passport Readiness.
4. Change Impact War Room.
5. Variant Governance Cockpit.
6. Design Review Closure Cockpit.
7. Quality Closure Cockpit.
8. Installed Base Service Cockpit.

Reason: these reuse the most existing code and address the clearest PLM pain.

Generated local signal report: `docs/USECASE-MINER-REPORT.md`.

Detailed Installed Base MVP blueprint: `docs/INSTALLED-BASE-SERVICE-COCKPIT-MVP.md`.

Detailed Workspace Health Scanner blueprint: `docs/WORKSPACE-HEALTH-SCANNER-MVP.md`.

Detailed Design Review Closure blueprint: `docs/DESIGN-REVIEW-CLOSURE-COCKPIT-MVP.md`.

Detailed Quality Closure blueprint: `docs/QUALITY-CLOSURE-COCKPIT-MVP.md`.

Detailed Requirements Coverage blueprint: `docs/REQUIREMENTS-COVERAGE-MATRIX-MVP.md`.

Detailed Digital Product Passport Readiness blueprint: `docs/DIGITAL-PRODUCT-PASSPORT-READINESS-MVP.md`.

Detailed Spare Parts Request Desk blueprint: `docs/SPARE-PARTS-REQUEST-DESK-MVP.md`.

Detailed Variant Governance blueprint: `docs/VARIANT-GOVERNANCE-COCKPIT-MVP.md`.

Detailed Test And Validation blueprint: `docs/TEST-AND-VALIDATION-EVIDENCE-HUB-MVP.md`.

Detailed NPI Launch Readiness blueprint: `docs/NPI-LAUNCH-READINESS-BOARD-MVP.md`.

Detailed Product Release Readiness blueprint: `docs/PRODUCT-RELEASE-READINESS-COCKPIT-MVP.md`.

Detailed Product Data Traceability blueprint: `docs/PRODUCT-DATA-TRACEABILITY-HUB-MVP.md`.

Detailed BOM Export And Attachment Studio blueprint: `docs/BOM-EXPORT-AND-ATTACHMENT-STUDIO-MVP.md`.

## First Build Slice

Start with Supplier Command Center:

```text
endpoint: /supplier-center
settings key: supplierCenter
workspaces: supplierPackages, items, problemReports, nonConformances
panels: insertSearch, insertResults, insertDetails, insertAttachments, insertGrid, insertSourcing
first tenant action: read-only workspace/field discovery
browser check: package list, supplier detail, item/BOM context, console/network
```

Keep it read-only until the view proves useful. Add "create package from BOM selection" after that.

Detailed MVP blueprint: `docs/SUPPLIER-COMMAND-CENTER-MVP.md`.
