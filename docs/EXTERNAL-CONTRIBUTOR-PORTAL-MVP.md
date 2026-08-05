# External Contributor Portal MVP

Goal: give suppliers, reviewers, or customers a narrow read-only collaboration view without exposing full PLM workspace complexity.

Implementation Status: Blueprint only. No route or shell yet.

## Why This Matters

External contributors usually need one safe task surface: assigned packages, design reviews, attachments, markups, due dates, and comments. This extension should prove the simplified experience before any external writeback, permissions change, or workflow action is added.

## Tenant Signals

- `Supplier Packages`
- `Design Reviews`
- `Design Review Tasks`
- attachments and workflow history on package/review records
- existing `portal` and `reviews` app patterns

## First Screen

```text
/external-contributor-portal

left: assigned packages, reviews, and tasks
center: selected assignment with item/document context and attachments
right: due dates, required responses, workflow state, comments/markup checklist
```

## Reuse

- `portal`
- `reviews`
- `supplier-center`
- `design-review-closure`
- `insertResults`
- `insertDetails`
- `insertAttachments`
- `insertGrid`
- `insertWorkflowHistory`

## MVP Questions

1. Which external work can be shown without exposing admin/internal fields?
2. Which attachments or markup files are required for response?
3. Which workflow states are safe to display to contributors?
4. Which actions must stay manual until permissions and rollback are proven?
5. Which supplier/reviewer handoff still happens by email today?

## Tenant Discovery Needed

```text
Supplier Packages workspace ID:
Design Reviews workspace ID:
Design Review Tasks workspace ID:
External assignee/supplier/reviewer fields:
Attachment fields and file visibility rules:
Workflow states safe for external users:
Relationship tabs that should be hidden:
Existing permissions/roles for external users:
```

## MVP Boundary

Read-only first. Do not create users, change permissions, expose supplier links, write comments, upload files, or trigger workflow actions until access control is explicitly approved and tested.

## Promote When

- a tenant has supplier or design-review work with external handoffs,
- the required fields can be displayed without private/internal sections,
- the read-only portal reduces email/file-link coordination risk.
