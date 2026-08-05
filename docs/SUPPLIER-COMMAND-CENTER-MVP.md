# Supplier Command Center MVP

Goal: first concrete extension generated from tenant/use-case mining.

Start read-only. Add create/update actions only after the cockpit proves useful in a real tenant.

## Why This First

This repo already has:

- `supplierPackages` workspace configuration,
- item sourcing endpoints and `insertSourcing`,
- package attachments and line-item grids,
- workflow progress patterns,
- pending supplier package signals in impact analysis,
- KPIs for vendor, country, long lead time, pending packages, quality, REACH/RoHS, and carbon.

Current tenant signal:

- Workspace Manager screenshot shows Product Development and Instance Management.
- Supplier workspaces still need browser scan confirmation once Browser MCP is connected.

## App Shape

```text
endpoint: /supplier-center
settings key: supplierCenter
title: Supplier Command Center
route: routes/landing.js
view: views/apps/supplier-center.pug
script: public/javascripts/apps/supplier-center.js
style: public/stylesheets/apps/supplier-center.css
custom script: public/javascripts/custom/supplier-center.js
custom style: public/stylesheets/custom/supplier-center.css
```

Use existing app pattern from `docs/ADDING-APPLICATIONS.md`.

## Read-Only First Screen

Layout:

```text
Header
- supplier search/filter
- package state filter
- reload

Left
- supplier list / package queue

Center
- selected supplier or package details
- package line items

Right
- affected item/BOM context
- sourcing quotes
- attachments
- risk/readiness indicators
```

Existing panels to reuse:

- `insertSearch`
- `insertResults`
- `insertDetails`
- `insertGrid`
- `insertAttachments`
- `insertSourcing`
- `insertBOM`
- workflow/history panels if package workflow is active

## Tenant Discovery Needed

Before implementation, capture:

```text
Supplier package workspace ID:
Supplier package workflow states:
Package fields:
Package grid columns:
Field linking package to items/BOM rows:
Supplier field IDs:
Due date / requested date fields:
Attachment conventions:
External supplier permissions:
Sourcing data available on item workspace:
Quality/problem-report relation fields:
```

## Minimum Data Model

Settings block should only store tenant-specific IDs as deltas:

```js
exports.applications.supplierCenter = {
    workspaces : {
        supplierPackages : { workspaceId : null },
        items            : { workspaceId : null },
        problemReports   : { workspaceId : null },
        nonConformances  : { workspaceId : null }
    },
    fieldIds : {
        supplierPackages : {
            supplier : null,
            status   : null,
            dueDate  : null,
            items    : null
        },
        items : {
            vendor       : 'VENDOR',
            country      : 'COUNTRY',
            longLeadTime : 'LONG_LEAD_TIME',
            reach        : 'REACH',
            rohs         : 'ROHS'
        }
    },
    panels : {
        insertResults     : {},
        insertDetails     : {},
        insertGrid        : {},
        insertAttachments : {},
        insertSourcing    : {},
        insertBOM         : {}
    }
};
```

Keep `null` when runtime fallback or tenant discovery should fill the value.

## Implementation Status

Minimal read-only shell implemented at `/supplier-center`.

## MVP User Stories

1. As a buyer, I see all open supplier packages grouped by supplier and due date.
2. As an engineer, I open a package and immediately see the affected items and BOM context.
3. As a quality user, I see whether this supplier has related problem reports or non-conformances.
4. As a planner, I see lead-time and quote data from item sourcing.
5. As an admin, I can verify which tenant fields are missing for the cockpit.

## Deferred Write Actions

Do not build these first:

- create supplier package from BOM selection,
- send supplier email/link,
- supplier portal writeback,
- workflow transition buttons,
- automatic risk scoring writes.

Add them after the read-only cockpit has been browser-verified.

## Acceptance Check

```text
npm start <tenant>
open /supplier-center
OAuth/session works
package list renders
package details render
line-item grid renders
attachments render
sourcing quote table renders when item context exists
console has no new errors
failed network requests understood
```

## Browser-MCP Scan Sequence

When connected to `https://contelosuxdemo.autodeskplm360.net/plm/admin/workspace-manager`:

1. Search for supplier/package/procurement/purchasing workspaces.
2. Open the supplier package workspace.
3. Read fields, grid, workflow, relationships, scripts, reports, permissions.
4. Capture screenshots of tabs and field lists.
5. Fill `docs/TENANT-DISCOVERY-SCORECARD.md`.
6. Decide whether `/supplier-center` or `/installed-base-service` should be built first for this tenant.
