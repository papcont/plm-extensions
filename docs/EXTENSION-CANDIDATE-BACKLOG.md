# Extension Candidate Backlog

Generated from `settings.js`, tenant discovery evidence, and `tools/usecase-miner.js`.
Tenant discovery: `docs/tenant-discovery/contelosuxdemo-initial.json`.

## Build Order

Rank | Candidate | Score | Tenant Workspaces | Blueprint | Implementation | Readiness | Endpoint | Blueprint File
--- | --- | ---: | ---: | --- | --- | --- | --- | ---
1 | Installed Base Service Cockpit | 82 | 9 | ready | implemented | demo candidate; browser check needed | /installed-base-service | docs/INSTALLED-BASE-SERVICE-COCKPIT-MVP.md
2 | BOM Export And Attachment Studio | 53 | 3 | ready | implemented | demo candidate; browser check needed | /bom-export-attachment-studio | docs/BOM-EXPORT-AND-ATTACHMENT-STUDIO-MVP.md
3 | NPI Launch Readiness Board | 48 | 3 | ready | implemented | demo candidate; browser check needed | /launch-readiness | docs/NPI-LAUNCH-READINESS-BOARD-MVP.md
4 | Product Data Traceability Hub | 48 | 3 | ready | implemented | demo candidate; browser check needed | /product-traceability | docs/PRODUCT-DATA-TRACEABILITY-HUB-MVP.md
5 | Design Review Closure Cockpit | 42 | 4 | ready | implemented | demo candidate; browser check needed | /design-review-closure | docs/DESIGN-REVIEW-CLOSURE-COCKPIT-MVP.md
6 | Product Release Readiness Cockpit | 34 | 1 | ready | implemented | demo candidate; browser check needed | /release-readiness | docs/PRODUCT-RELEASE-READINESS-COCKPIT-MVP.md
7 | Supplier Command Center | 27 | 1 | ready | implemented | demo candidate; browser check needed | /supplier-center | docs/SUPPLIER-COMMAND-CENTER-MVP.md
8 | Test And Validation Evidence Hub | 26 | 2 | ready | implemented | demo candidate; browser check needed | /test-validation-hub | docs/TEST-AND-VALIDATION-EVIDENCE-HUB-MVP.md
9 | Quality Closure Cockpit | 22 | 0 | ready | implemented | preview only; tenant evidence needed | /quality-closure | docs/QUALITY-CLOSURE-COCKPIT-MVP.md
10 | Variant Governance Cockpit | 18 | 2 | ready | implemented | demo candidate; browser check needed | /variant-governance | docs/VARIANT-GOVERNANCE-COCKPIT-MVP.md
11 | Requirements Coverage Matrix | 17 | 0 | ready | implemented | preview only; tenant evidence needed | /requirements-coverage | docs/REQUIREMENTS-COVERAGE-MATRIX-MVP.md
12 | Spare Parts Request Desk | 16 | 1 | ready | implemented | demo candidate; browser check needed | /spare-parts-desk | docs/SPARE-PARTS-REQUEST-DESK-MVP.md
13 | Digital Product Passport Readiness | 11 | 0 | ready | implemented | preview only; tenant evidence needed | /dpp-readiness | docs/DIGITAL-PRODUCT-PASSPORT-READINESS-MVP.md

## Next Read-Only Slice

Browser-verify implemented `/installed-base-service` against live tenant evidence.

## Rule

Do not add tenant write actions until the read-only screen is useful and the target tenant, object list, before-state export, expected action, and rollback path are named.

## Unmapped Signals

Tenant workspaces without archetype match: 0.
Repo workspace IDs without archetype match: 0.

Use the unmapped section in `docs/USECASE-MINER-REPORT.md` for the next brainstorming pass before adding more archetypes.
