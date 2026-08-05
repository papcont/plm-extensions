# Installed Base Service Cockpit MVP

Goal: turn the strongest local mining signal into a read-only extension blueprint.

## Why This First

`tools/usecase-miner.js` ranks this highest from current `settings.js`.

Existing repo base:

- `service` app already connects products, equipments, equipment services, spare part requests, problem reports, BOM, details, attachments, and serial grids.
- `abom` app already reads Asset BOM, Engineering BOM, and serial-number links.
- `instances` app already maps BOM parts to serial-number/instance records.
- Common workspace IDs already include equipments, equipmentServices, serialNumbers, serializedItems, assets, assetItems, and assetServices. `Asset Groups` is visible in the current tenant evidence but needs its tenant-specific workspace ID before it is enabled in the shell.

Current tenant signal:

- Workspace Manager screenshot shows `Instance Management` with Service, Serial Numbers, Motors, Sensors, and Control Elements.

## App Shape

```text
endpoint: /installed-base-service
settings key: installedBaseService
title: Installed Base Service Cockpit
route: routes/landing.js
view: views/apps/installed-base-service.pug
script: public/javascripts/apps/installed-base-service.js
style: public/stylesheets/apps/installed-base-service.css
custom script: public/javascripts/custom/installed-base-service.js
custom style: public/stylesheets/custom/installed-base-service.css
```

Use the existing seven-piece app pattern.

Implementation status: minimal read-only shell is implemented at `/installed-base-service`.

The shell shows configured workspaces with counters. Tenant-visible workspaces without verified IDs, such as `Asset Groups`, remain visible in discovery evidence but need a tenant settings override before counters and links can work.

## Read-Only First Screen

```text
Header
- asset / serial / service search
- status filter
- reload

Left
- projects / facilities / assets
- open equipment service tickets

Center
- selected asset or serial number details
- service history
- problem reports

Right
- BOM / instance context
- files and documentation
- spare part requests
```

Existing panels to reuse:

- `insertResults`
- `insertDetails`
- `insertGrid`
- `insertAttachments`
- `insertBOM`
- `insertChangeProcesses`
- `insertItemSummary`

## Tenant Discovery Needed

```text
Service workspace ID:
Serial Numbers workspace ID:
Motors workspace ID:
Sensors workspace ID:
Control Elements workspace ID:
Equipment service workspace ID:
Asset/equipment workspace ID:
Asset groups workspace ID:
Fields linking services to serial numbers:
Fields linking components to parent asset:
Workflow states for service tickets:
Problem report relation fields:
Spare part request relation fields:
Relevant attachments/documentation conventions:
```

## Minimum Settings Shape

```js
exports.applications.installedBaseService = {
    workspaces : {
        assets            : { workspaceId : null },
        assetGroups       : { workspaceId : null },
        equipments        : { workspaceId : null },
        equipmentServices : { workspaceId : null },
        serialNumbers     : { workspaceId : null },
        motors            : { workspaceId : null },
        sensors           : { workspaceId : null },
        controlElements   : { workspaceId : null },
        problemReports    : { workspaceId : null },
        sparePartsRequests: { workspaceId : null }
    },
    fieldIds : {
        serialNumbers : {
            partNumber   : 'NUMBER',
            path         : 'LOCATION',
            instanceId   : 'INSTANCE_ID',
            instancePath : 'INSTANCE_PATH'
        },
        equipmentServices : {
            asset     : 'ASSET',
            assignee  : 'ASSIGNEE',
            serialnrs : 'SERIAL_NUMBERS_LIST'
        }
    },
    panels : {
        assets            : {},
        equipmentServices : {},
        serialGrid        : {},
        details           : {},
        attachments       : {},
        bom               : {},
        problemReports    : {},
        spareRequests     : {}
    }
};
```

Keep tenant-specific fields as `null` until browser discovery confirms them.

## MVP User Stories

1. As a service user, I search a serial number and see the linked asset, component, and service history.
2. As an engineer, I open an asset and see its BOM/instance context plus documentation.
3. As a service manager, I see open service tickets excluding completed/cancelled states.
4. As quality/support, I see related problem reports and spare part requests from the same context.
5. As an admin, I see which workspace links are missing before write automation is considered.

## Deferred Write Actions

- create service ticket,
- create problem report,
- create spare part request,
- update serial/component records,
- workflow transition buttons.

Reuse existing `service` write patterns only after the read-only cockpit is browser-verified.

## Acceptance Check

```text
npm start <tenant>
open /installed-base-service
asset/project list renders
service ticket list renders
serial grid renders for selected context
BOM/details/attachments render
related problem reports/spare requests render
console has no new errors
failed network requests understood
```

## Browser-MCP Scan Sequence

When the FM tab is connected:

1. Open Workspace Manager.
2. Inspect Service, Serial Numbers, Motors, Sensors, and Control Elements.
3. Capture field IDs, grid columns, workflow states, relationships, and scripts.
4. Inspect equipment/equipment service workspaces if present.
5. Fill `docs/TENANT-DISCOVERY-SCORECARD.md`.
6. Decide whether this cockpit or Supplier Command Center should be the first built app for the tenant.
