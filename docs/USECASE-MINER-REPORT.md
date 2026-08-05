# Use-Case Miner Report

Generated from `settings.js` using `tools/usecase-miner.js`.
Tenant discovery: `docs/tenant-discovery/contelosuxdemo-initial.json`.
Tenant: contelosuxdemo.
Discovery source: Workspace Manager screenshot provided in chat; Chrome browser read-only extraction on 2026-07-29.

## Ranked Candidates

### 1. Installed Base Service Cockpit

Score: 82

Score breakdown:

- repo workspaces: 21
- tenant-discovered workspaces: 36
- matching applications: 24
- matching menu entries: 1

Suggested MVP endpoint: `/installed-base-service`

MVP blueprint: `docs/INSTALLED-BASE-SERVICE-COCKPIT-MVP.md`

Implementation status: implemented

Matching workspaces:

- equipments: 280
- equipmentServices: 284
- serialNumbers: 277
- serializedItems: 282
- assets: 280
- assetItems: 282
- assetServices: 284

Matching tenant-discovered workspaces:

- Instance Management / Service (Revision controlled)
- Instance Management / Serial Numbers (Revision controlled)
- Instance Management / Motors (Revision controlled)
- Instance Management / Sensors (Revision controlled)
- Instance Management / Control Elements (Revision controlled)
- Asset Lifecycle & Projects / Assets (Basic with workflow)
- Asset Lifecycle & Projects / Asset Items (Revision controlled)
- Asset Lifecycle & Projects / Asset Groups (Basic with workflow)
- Asset Lifecycle & Projects / Asset Services (Revisioning)

Matching applications:

- abom
- dashboard
- editor
- explorer
- instances
- mbom
- portal
- portfolio
- sbom
- service
- variants
- addins

Matching menu entries:

- Service Portal

### 2. BOM Export And Attachment Studio

Score: 53

Score breakdown:

- repo workspaces: 9
- tenant-discovered workspaces: 12
- matching applications: 32
- matching menu entries: 0

Suggested MVP endpoint: `/bom-export-attachment-studio`

MVP blueprint: `docs/BOM-EXPORT-AND-ATTACHMENT-STUDIO-MVP.md`

Implementation status: implemented

Matching workspaces:

- items: 57
- serializedItems: 282
- assetItems: 282

Matching tenant-discovered workspaces:

- Product Development / Items (Revision controlled)
- Product Development / Item Variants (Revision controlled)
- Asset Lifecycle & Projects / Asset Items (Revision controlled)

Matching applications:

- abom
- compare
- configurator
- dashboard
- editor
- explorer
- instances
- matrix
- mbom
- portal
- portfolio
- reviews
- sbom
- service
- variants
- addins

Matching menu entries:

- none

### 3. NPI Launch Readiness Board

Score: 48

Score breakdown:

- repo workspaces: 18
- tenant-discovered workspaces: 12
- matching applications: 16
- matching menu entries: 2

Suggested MVP endpoint: `/launch-readiness`

MVP blueprint: `docs/NPI-LAUNCH-READINESS-BOARD-MVP.md`

Implementation status: implemented

Matching workspaces:

- engineeringProjects: 213
- engineeringProjectActivities: 211
- projects: 86
- projectTasks: 90
- orderProjects: 283
- orderProjectDeliveries: 279

Matching tenant-discovered workspaces:

- Asset Lifecycle & Projects / Order Project Deliveries (Revisioning)
- Asset Lifecycle & Projects / Order Projects (Basic with workflow)
- Asset Lifecycle & Projects / Order Project Tasks (Basic with workflow)

Matching applications:

- abom
- dashboard
- insights
- projects
- reports
- service
- worklist
- addins

Matching menu entries:

- Projects Dashboard
- Tenant Insights

### 4. Product Data Traceability Hub

Score: 48

Score breakdown:

- repo workspaces: 12
- tenant-discovered workspaces: 12
- matching applications: 24
- matching menu entries: 0

Suggested MVP endpoint: `/product-traceability`

MVP blueprint: `docs/PRODUCT-DATA-TRACEABILITY-HUB-MVP.md`

Implementation status: implemented

Matching workspaces:

- items: 57
- products: 95
- serializedItems: 282
- assetItems: 282

Matching tenant-discovered workspaces:

- Product Development / Items (Revision controlled)
- Product Development / Documents (Revision controlled)
- Asset Lifecycle & Projects / Asset Items (Revision controlled)

Matching applications:

- abom
- compare
- dashboard
- editor
- explorer
- mbom
- portal
- portfolio
- sbom
- service
- variants
- addins

Matching menu entries:

- none

### 5. Design Review Closure Cockpit

Score: 42

Score breakdown:

- repo workspaces: 6
- tenant-discovered workspaces: 16
- matching applications: 18
- matching menu entries: 2

Suggested MVP endpoint: `/design-review-closure`

MVP blueprint: `docs/DESIGN-REVIEW-CLOSURE-COCKPIT-MVP.md`

Implementation status: implemented

Matching workspaces:

- designReviews: 76
- designReviewTasks: 77

Matching tenant-discovered workspaces:

- Product Development / Design Reviews_old (Basic with workflow)
- Product Development / Design Reviews (Basic with workflow)
- Product Development / Design Review Tasks_old (Basic with workflow)
- Product Development / Design Review Tasks (Basic with workflow)

Matching applications:

- abom
- dashboard
- impactanalysis
- instances
- mbom
- portal
- portfolio
- reviews
- service

Matching menu entries:

- Design Reviews
- Change Orders Dashboard

### 6. Product Release Readiness Cockpit

Score: 34

Score breakdown:

- repo workspaces: 9
- tenant-discovered workspaces: 4
- matching applications: 16
- matching menu entries: 5

Suggested MVP endpoint: `/release-readiness`

MVP blueprint: `docs/PRODUCT-RELEASE-READINESS-COCKPIT-MVP.md`

Implementation status: implemented

Matching workspaces:

- changeOrders: 84
- changeRequests: 83
- changeTasks: 80

Matching tenant-discovered workspaces:

- Product Development / VIES Freigabe (Revisioning)

Matching applications:

- dashboard
- editor
- explorer
- insights
- reports
- service
- variants
- addins

Matching menu entries:

- Non Conformances Dashboard
- Change Requests Dashboard
- Change Orders Dashboard
- Change Tasks Dashboard
- Tenant Comparison

### 7. Supplier Command Center

Score: 27

Score breakdown:

- repo workspaces: 6
- tenant-discovered workspaces: 4
- matching applications: 16
- matching menu entries: 1

Suggested MVP endpoint: `/supplier-center`

MVP blueprint: `docs/SUPPLIER-COMMAND-CENTER-MVP.md`

Implementation status: implemented

Matching workspaces:

- sparePartsRequests: 241
- supplierPackages: 147

Matching tenant-discovered workspaces:

- Product Development / Spare Parts Request (Basic with workflow)

Matching applications:

- abom
- dashboard
- explorer
- mbom
- portal
- reports
- sbom
- service

Matching menu entries:

- Service Portal

### 8. Test And Validation Evidence Hub

Score: 26

Score breakdown:

- repo workspaces: 0
- tenant-discovered workspaces: 8
- matching applications: 18
- matching menu entries: 0

Suggested MVP endpoint: `/test-validation-hub`

MVP blueprint: `docs/TEST-AND-VALIDATION-EVIDENCE-HUB-MVP.md`

Implementation status: implemented

Matching workspaces:

- none

Matching tenant-discovered workspaces:

- VISI_TEST / VisiTEST (Basic with workflow)
- VISI_TEST / VisiTEST_Meeting (Basic with workflow)

Matching applications:

- classes
- compare
- editor
- explorer
- instances
- matrix
- mbom
- service
- addins

Matching menu entries:

- none

### 9. Quality Closure Cockpit

Score: 22

Score breakdown:

- repo workspaces: 6
- tenant-discovered workspaces: 0
- matching applications: 12
- matching menu entries: 4

Suggested MVP endpoint: `/quality-closure`

MVP blueprint: `docs/QUALITY-CLOSURE-COCKPIT-MVP.md`

Implementation status: implemented

Matching workspaces:

- nonConformances: 98
- problemReports: 82

Matching tenant-discovered workspaces:

- none

Matching applications:

- dashboard
- editor
- explorer
- reports
- service
- addins

Matching menu entries:

- Problem Reporting Dashboard
- Non Conformances Dashboard
- Reports Dashboard
- Outstanding Work Report

### 10. Variant Governance Cockpit

Score: 18

Score breakdown:

- repo workspaces: 0
- tenant-discovered workspaces: 8
- matching applications: 10
- matching menu entries: 0

Suggested MVP endpoint: `/variant-governance`

MVP blueprint: `docs/VARIANT-GOVERNANCE-COCKPIT-MVP.md`

Implementation status: implemented

Matching workspaces:

- none

Matching tenant-discovered workspaces:

- Product Development / Item Variants (Revision controlled)
- Konifguratix / Konfiguratix (Basic with workflow)

Matching applications:

- configurator
- editor
- mbom
- portfolio
- variants

Matching menu entries:

- none

### 11. Requirements Coverage Matrix

Score: 17

Score breakdown:

- repo workspaces: 9
- tenant-discovered workspaces: 0
- matching applications: 8
- matching menu entries: 0

Suggested MVP endpoint: `/requirements-coverage`

MVP blueprint: `docs/REQUIREMENTS-COVERAGE-MATRIX-MVP.md`

Implementation status: implemented

Matching workspaces:

- designReviews: 76
- designReviewTasks: 77
- requirements: 143

Matching tenant-discovered workspaces:

- none

Matching applications:

- editor
- matrix
- portfolio
- reviews

Matching menu entries:

- none

### 12. Spare Parts Request Desk

Score: 16

Score breakdown:

- repo workspaces: 3
- tenant-discovered workspaces: 4
- matching applications: 8
- matching menu entries: 1

Suggested MVP endpoint: `/spare-parts-desk`

MVP blueprint: `docs/SPARE-PARTS-REQUEST-DESK-MVP.md`

Implementation status: implemented

Matching workspaces:

- sparePartsRequests: 241

Matching tenant-discovered workspaces:

- Product Development / Spare Parts Request (Basic with workflow)

Matching applications:

- abom
- explorer
- sbom
- service

Matching menu entries:

- Service Portal

### 13. Digital Product Passport Readiness

Score: 11

Score breakdown:

- repo workspaces: 0
- tenant-discovered workspaces: 0
- matching applications: 10
- matching menu entries: 1

Suggested MVP endpoint: `/dpp-readiness`

MVP blueprint: `docs/DIGITAL-PRODUCT-PASSPORT-READINESS-MVP.md`

Implementation status: implemented

Matching workspaces:

- none

Matching tenant-discovered workspaces:

- none

Matching applications:

- editor
- explorer
- portal
- variants
- addins

Matching menu entries:

- Class Browser

## Next Step

Browser-verify implemented `/installed-base-service` against live tenant evidence.

## Unmapped Tenant Workspace Signals

These workspace names did not match any configured archetype keyword. Review them after each browser scan to find new extension ideas.

- none

## Unmapped Repo Workspace IDs

These `settings.common.workspaceIds` keys did not match any configured archetype keyword.

- none
