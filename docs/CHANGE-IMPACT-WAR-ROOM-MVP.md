# Change Impact War Room MVP

Goal: turn change requests, change orders, affected items, and cross-functional blockers into one read-only decision room.

Implementation Status: Blueprint only. No route or shell yet.

## Why This Matters

Impact analysis exists in the repo, but change decisions still spread across item/BOM context, supplier packages, service exposure, quality issues, and open tasks. This extension should show whether a change is ready for decision before workflow buttons or tenant writes are added.

## Tenant Signals

- `Change Requests`
- `Change Orders`
- `Change Tasks`
- `Items`
- `Supplier Packages`
- `Problem Reports`
- `Non Conformances`
- `Spare Parts Request`

## First Screen

```text
/change-impact-war-room

left: change queue by age, state, owner, and urgency
center: selected change with affected items, BOM/where-used, documents, and workflow history
right: supplier, quality, service, spare-part, validation, and release blockers
```

## Reuse

- `impactanalysis`
- `release-readiness`
- `supplier-center`
- `quality-closure`
- `spare-parts-desk`
- `product-traceability`
- `insertResults`
- `insertDetails`
- `insertBOM`
- `insertBOMChanges`
- `insertChangeProcesses`
- `insertWorkflowHistory`
- `insertAttachments`

## MVP Questions

1. Which affected items or BOM parents make this change risky?
2. Which supplier packages or long-lead items are exposed?
3. Which problem reports, non-conformances, or spare-part requests are related?
4. Which change tasks are open, stale, or blocking release?
5. Which evidence is missing before approval, rejection, or escalation?

## Tenant Discovery Needed

```text
Change Requests workspace ID:
Change Orders workspace ID:
Change Tasks workspace ID:
Fields linking change records to affected items:
Fields linking change tasks to parent change:
Workflow states for draft, review, approved, rejected, implemented:
Relationship tabs for supplier packages, quality issues, problem reports, spare requests:
Reports/views already used for change decision meetings:
BOM view name used for impact review:
```

## MVP Boundary

Read-only first. Do not create tasks, change workflow states, approve changes, or write affected-item data until the blocker list is trusted and the tenant export/rollback path is named.

## Promote When

- the tenant has active change request/order/task workspaces,
- affected-item links are visible from the Workspace Editor or API,
- at least one related blocker source exists: supplier, quality, service, spare parts, validation, or release readiness,
- the cockpit answers a change meeting question better than the existing dashboards.
