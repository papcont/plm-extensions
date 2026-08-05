# Requirements Coverage Matrix MVP

Goal: show requirement coverage from source requirement to linked item, design review, test/validation evidence, and change context.

Implementation Status: Minimal read-only shell implemented at `/requirements-coverage`.

## Tenant Signals

- repo workspace key `requirements`
- specification editor settings
- design reviews and design review tasks
- VisiTEST and VisiTEST Meeting tenant workspaces

## PLM Pain

Requirement gaps are hard to find when requirements, item design, reviews, tests, and changes live in separate records. A traceability matrix makes missing design or verification evidence visible before release or audit.

## First Screen

```text
/requirements-coverage

left: requirement/specification tree and filters
center: selected requirement with linked item, design review, test record, and change links
right: orphan requirements, changed items without requirement review, missing verification evidence
```

## Reuse

- specification editor
- item details
- relationships
- design review/task patterns
- test validation hub
- change/release context

## MVP Boundary

Read-only first. Do not create links, update requirements, or change verification status until the coverage matrix exposes reliable gaps.
