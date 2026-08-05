# Spare Parts Request Desk MVP

Goal: connect spare-part demand to service, item/BOM, sourcing, and engineering follow-up.

Implementation Status: Minimal read-only shell implemented at `/spare-parts-desk`.

## Tenant Signals

- `Spare Parts Request`
- `Service`
- `Serial Numbers`
- `Motors`
- `Sensors`
- `Control Elements`

## First Screen

```text
/spare-parts-desk

left: request queue by age, status, urgency
center: requested item/component and BOM context
right: sourcing, supplier package exposure, related service/problem signals
```

## Reuse

- `service`
- `sparePartsRequests`
- item/BOM panels
- `insertSourcing`
- problem reports

## MVP Boundary

Read-only first. The first write action can be a proposed handoff to Problem Report or Change Request after the signals are trusted.
