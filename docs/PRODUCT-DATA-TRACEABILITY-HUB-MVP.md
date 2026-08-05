# Product Data Traceability Hub MVP

Goal: connect item master data, documents, product context, BOM evidence, and release/change state into one read-only traceability view.

Implementation Status: Minimal read-only shell implemented at `/product-traceability`.

## Tenant Signals

- `Items`
- `Documents`
- repo workspace key `products`

## First Screen

```text
/product-traceability

left: item/product selector and recent records
center: selected item, linked documents, BOM/documentation completeness
right: release/change context, missing master-data signals, export checklist
```

## Reuse

- item details
- attachments
- BOM panels
- product portfolio/catalog patterns
- release readiness
- classification/explorer KPIs

## MVP Boundary

Read-only first. Do not create documents, update item fields, or change release state until the traceability gaps are trusted.
