# Service Feedback To Engineering Loop MVP

Goal: turn recurring service and spare-part signals into read-only engineering follow-up candidates.

Implementation Status: Blueprint only. No route or shell yet.

## Why This Matters

Service problems often stay operational: a ticket is closed, a spare part is shipped, and engineering never sees the repeated pattern. This extension should expose when service demand, serial-number context, problem reports, and spare-part requests justify an engineering review.

## Tenant Signals

- `Service`
- `Serial Numbers`
- `Asset Services`
- `Spare Parts Request`
- `Problem Reports`
- change request/order workspaces when the tenant uses them for engineering follow-up

## First Screen

```text
/service-feedback-engineering-loop

left: recurring service/spare-part signals grouped by product, item, serial, or asset
center: selected signal with service history, affected serials/assets, and problem reports
right: suggested engineering follow-up, linked item/BOM context, open change/release blockers
```

## Reuse

- `service`
- `installed-base-service`
- `spare-parts-desk`
- `quality-closure`
- item/BOM panels
- `insertResults`
- `insertDetails`
- `insertGrid`
- `insertBOM`
- `insertChangeProcesses`
- `insertWorkflowHistory`

## MVP Questions

1. Which products or components have repeated service tickets?
2. Which spare-part requests cluster around the same item, asset, or serial-number family?
3. Which problem reports already exist for the same context?
4. Which signals should become a problem report or change request candidate?
5. Which service-to-engineering handoff is still managed by email, Excel, or meetings?

## Tenant Discovery Needed

```text
Service workspace ID:
Asset Services workspace ID:
Serial Numbers workspace ID:
Spare Parts Request workspace ID:
Problem Reports workspace ID:
Change Requests workspace ID:
Fields linking service records to serial/assets/items:
Fields linking spare-part requests to item/assets:
Fields linking problem reports to item/assets/service records:
Workflow states that mean open, blocked, closed, duplicate:
Reports/views already used by service or engineering teams:
```

## MVP Boundary

Read-only first. Do not create problem reports, change requests, or workflow actions until the signal grouping is browser-verified and a tenant rollback/export path is named.

## Promote When

- at least one tenant has service or asset-service evidence,
- spare-part or problem-report links can be found without custom data entry,
- the cockpit answers a real repeated-failure or service-to-engineering question better than the existing Service Portal.
