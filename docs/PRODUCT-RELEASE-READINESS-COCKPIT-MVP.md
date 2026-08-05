# Product Release Readiness Cockpit MVP

Goal: make release approval state, missing product data, BOM maturity, and cross-functional blockers visible before release.

## Tenant Signals

- `Items`
- `VIES Freigabe`
- existing repo workspaces for change requests, change orders, and change tasks

## First Screen

```text
/release-readiness

left: release approval queue by state and age
center: selected item/release record, lifecycle, BOM maturity, required attachments
right: open change, supplier, quality, service, and validation blockers
```

## Reuse

- item details
- BOM panels
- workflow history
- change impact
- supplier package indicators
- quality/test evidence patterns

## MVP Boundary

Read-only first. Do not approve releases or modify item lifecycle state until the blocker list is trusted.

## Implementation Status

Minimal read-only shell implemented at `/release-readiness`.
