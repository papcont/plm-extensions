# NPI Launch Readiness Board MVP

Goal: turn project, delivery, task, BOM, supplier, and validation signals into one launch readiness view.

## Tenant Signals

- `Order Projects`
- `Order Project Deliveries`
- `Order Project Tasks`
- existing repo workspaces for engineering projects, project tasks, and order project deliveries

## First Screen

```text
/launch-readiness

left: launch/order project queue by status and age
center: selected project, deliverables, milestones, linked item/BOM context
right: missing deliverables, open tasks, supplier/service/test blockers
```

## Reuse

- `projects`
- `worklist`
- item/BOM panels
- supplier package indicators
- test/validation evidence signals
- workflow panels

## MVP Boundary

Read-only first. Do not create project tasks, change deliverables, or advance workflow state until the readiness view is validated in the tenant.

## Implementation Status

Minimal read-only shell implemented at `/launch-readiness`.
