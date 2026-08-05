# Quality Closure Cockpit MVP

Goal: connect problem reports, non-conformances, supplier quality signals, affected items, corrective actions, and closure evidence into one read-only quality view.

Implementation Status: Minimal read-only shell implemented at `/quality-closure`.

## Tenant Signals

- repo workspace key `problemReports`
- repo workspace key `nonConformances`
- existing dashboard routes for Problem Reports and Non Conformances
- supplier package and item context

## PLM Pain

Quality work often splits across NCR, CAPA, SCAR, supplier follow-up, item records, attachments, and change processes. Autodesk positions cloud PLM quality management around closed-loop traceability for non-conformance, CAPA, FMEA, supplier quality action reports, and change links.

## First Screen

```text
/quality-closure

left: quality issue queue by state, age, supplier, and affected item
center: selected issue, root-cause evidence, affected item/BOM, attachments
right: open corrective actions, supplier exposure, change/release blockers, closure checklist
```

## Reuse

- dashboard
- item details
- attachments
- workflow panels
- supplier package context
- change impact context

## MVP Boundary

Read-only first. Do not create CAPA/SCAR records, transition quality workflows, or open change requests until the closure view is trusted.
