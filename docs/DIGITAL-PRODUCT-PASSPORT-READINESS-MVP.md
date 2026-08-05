# Digital Product Passport Readiness MVP

Goal: collect product, component, material, supplier, compliance, lifecycle, and documentation signals into one read-only DPP readiness view.

Implementation Status: Minimal read-only shell implemented at `/dpp-readiness`.

## Current Regulatory Signal

The European Commission Digital Product Passport Registry went live on 20 July 2026. Battery passport obligations for relevant battery categories are listed for 18 February 2027, with more product groups expected through EU product legislation.

Sources:

- https://single-market-economy.ec.europa.eu/single-market/digital-product-passport_en
- https://single-market-economy.ec.europa.eu/single-market/digital-product-passport/batteries_en

## Tenant Signals

- items
- documents
- supplier packages
- classifications
- REACH/RoHS/carbon KPIs in existing explorer settings
- attachments and lifecycle states

## First Screen

```text
/dpp-readiness

left: product/item selector and passport scope
center: BOM, supplier, material, compliance, lifecycle, and document coverage
right: missing DPP data, stale supplier evidence, unresolved compliance blockers, export checklist
```

## Reuse

- product traceability hub
- item details
- BOM traversal
- attachments
- sourcing/supplier context
- explorer compliance KPIs
- classification browser

## MVP Boundary

Read-only first. Do not submit to the DPP Registry, create QR/data carriers, or certify compliance until the tenant data gaps are reviewed by the customer.
