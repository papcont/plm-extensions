# Design Review Closure Cockpit MVP

Goal: turn Design Reviews and Design Review Tasks into one closure view.

## Tenant Signals

- `Design Reviews`
- `Design Review Tasks`
- `Design Reviews_old`
- `Design Review Tasks_old`

## First Screen

```text
/design-review-closure

left: review queue by state and age
center: selected review, linked item/document, attachments
right: open tasks, missing responses, stale markup checklist
```

## Reuse

- `reviews` settings and app patterns
- item details
- attachments
- workflow state/history panels

## MVP Boundary

Read-only first. Do not close tasks, approve reviews, or write comments until the queue and checklist prove useful in the tenant.

## Implementation Status

Minimal read-only shell implemented at `/design-review-closure`.
