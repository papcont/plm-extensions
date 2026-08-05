# PLM Pain To Extension Map

Purpose: connect current PLM/manufacturing pressure points to concrete Fusion Manage extension ideas in this repo.

Last source check: 2026-07-30.

## Source Anchors

- Autodesk supply-chain PLM: supplier collaboration needs connected workflows for shared data and deliverables. Source: https://www.autodesk.com/industry/design-manufacturing/plm/supply-chain-collaboration
- EU Digital Product Passport: the DPP Registry went live on 20 July 2026; battery passport obligations start on 18 February 2027 for relevant categories. Sources: https://single-market-economy.ec.europa.eu/news/digital-product-passport-registry-now-live-2026-07-20_en and https://single-market-economy.ec.europa.eu/single-market/digital-product-passport/batteries_en
- NIST Digital Thread: design, manufacturing, and product-support information need a connected thread to speed design-to-production and reduce cost. Source: https://www.nist.gov/programs-projects/digital-thread-smart-manufacturing
- Deloitte 2026 Manufacturing Outlook: digital tools are a major lever for managing global supply-chain complexity. Source: https://www.deloitte.com/us/en/insights/industry/manufacturing-industrial-products/manufacturing-industry-outlook.html

## Pressure Map

| PLM pain | Extension response | Status | Evidence to capture next |
| --- | --- | --- | --- |
| Supplier work scattered across emails, files, quote loops, due dates, and package records | `Supplier Command Center` plus `Supplier Risk And Readiness Radar` | implemented + planned | Supplier Packages fields, workflow states, item links, supplier/date/compliance fields |
| Supply-chain complexity and late supplier signals | `Supplier Risk And Readiness Radar` | planned | package aging, lead time, quality links, country/compliance fields |
| Service feedback does not reliably reach engineering | `Service Feedback To Engineering Loop` | planned | Service, Asset Services, Serial Numbers, Spare Parts Request, Problem Reports relations |
| Change decisions need one cross-functional evidence room | `Change Impact War Room` | planned | Change Requests, Change Orders, Change Tasks, affected item links, supplier/quality/service blockers |
| Digital thread breaks between items, documents, BOM, release state, and support | `Product Data Traceability Hub`, `Installed Base Service Cockpit`, `Service Feedback To Engineering Loop` | implemented + planned | item-document links, BOM view names, serial/asset links, service/problem relations |
| DPP/compliance readiness is becoming time-bound | `Digital Product Passport Readiness` | implemented | material, supplier, REACH/RoHS/carbon, classification, document evidence |
| External contributors need narrow access without full PLM exposure | `External Contributor Portal` | planned | Supplier Packages, Design Reviews, Design Review Tasks, safe attachment/comment/workflow visibility |
| Launch/release meetings rely on manual blocker checks | `NPI Launch Readiness Board`, `Product Release Readiness Cockpit`, `Test And Validation Evidence Hub` | implemented | project tasks, release records, test evidence, meeting actions |

## Next Browser Scan Focus

1. `Service` and `Asset Services`: prove whether Service Feedback To Engineering should be promoted.
2. `Supplier Packages`: prove whether Supplier Risk should become a shell or stay inside Supplier Center.
3. `Change Requests`, `Change Orders`, `Change Tasks`: prove whether Change Impact War Room has enough tenant evidence.
4. `Design Reviews` and `Design Review Tasks`: prove External Contributor Portal scope.
5. `Items` and `Documents`: enrich Product Data Traceability and DPP Readiness.

## Decision Rule

Promote a planned extension only when Workspace Editor evidence shows real fields, workflow states, relationships, or reports that the existing implemented shell does not already cover.
