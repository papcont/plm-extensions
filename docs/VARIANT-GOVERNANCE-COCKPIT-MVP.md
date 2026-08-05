# Variant Governance Cockpit MVP

Goal: make variant completeness, approval state, and base-item context visible in one place.

Implementation Status: Minimal read-only shell implemented at `/variant-governance`.

## Tenant Signals

- `Item Variants`
- open local `Variants Manager` tabs
- product item workspaces

## First Screen

```text
/variant-governance

left: variant families and released variants
center: selected variant details, base item, BOM context
right: missing option data, workflow state, inconsistent variant warnings
```

## Reuse

- `variants` app
- item details
- BOM panels
- workflow history

## MVP Boundary

Read-only first. Do not generate or change variants until comparison and readiness checks are useful.
