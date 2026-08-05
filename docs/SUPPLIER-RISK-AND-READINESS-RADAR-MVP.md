# Supplier Risk And Readiness Radar MVP

Goal: show supplier risk before late packages, quality issues, or missing compliance evidence break release or production work.

Implementation Status: Blueprint only. No route or shell yet.

## Why This Matters

Supplier risk is already visible in fragments: supplier packages, sourcing data, lead time, quality issues, compliance flags, and affected items. This extension should turn those fragments into a read-only risk/readiness view before adding supplier writeback or scoring persistence.

## Tenant Signals

- `Supplier Packages`
- `Items`
- `Problem Reports`
- `Non Conformances`
- sourcing fields such as supplier, manufacturer, lead time, country, REACH, RoHS, and carbon

## First Screen

```text
/supplier-risk-readiness-radar

left: supplier list ranked by open risk signals
center: selected supplier with packages, affected items, due dates, and sourcing evidence
right: quality, compliance, long-lead, country, attachment, and release blockers
```

## Reuse

- `supplier-center`
- `explorer`
- `impactanalysis`
- `quality-closure`
- item/BOM panels
- `insertResults`
- `insertDetails`
- `insertGrid`
- `insertAttachments`
- `insertSourcing`
- `insertWorkflowHistory`

## MVP Questions

1. Which suppliers have late or stale packages?
2. Which suppliers affect released or soon-to-release items?
3. Which suppliers have related problem reports or non-conformances?
4. Which supplier records miss compliance, sourcing, attachment, or lead-time evidence?
5. Which risk should trigger a buyer or engineering review before workflow automation exists?

## Tenant Discovery Needed

```text
Supplier Packages workspace ID:
Supplier package supplier field:
Supplier package due date/status fields:
Supplier package line-item grid fields:
Item supplier/manufacturer fields:
Lead-time, country, REACH, RoHS, carbon fields:
Problem report/non-conformance supplier relation fields:
Reports/views already used for supplier meetings:
```

## MVP Boundary

Read-only first. Do not write supplier scores, send supplier messages, create packages, or transition workflows until the risk signals are verified in browser and the tenant export/rollback path is named.

## Promote When

- supplier packages are active in the tenant,
- at least one quality or compliance signal can be joined to supplier/item context,
- the radar answers a supplier review question better than `/supplier-center`.
