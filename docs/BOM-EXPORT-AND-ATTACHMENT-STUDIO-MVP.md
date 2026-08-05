# BOM Export And Attachment Studio MVP

Purpose: export a selected Fusion Manage BOM view as PDF, Excel, or CSV, then optionally attach the generated file back to the root item.

## Pain

BOM snapshots often leave PLM as screenshots, manual Excel exports, or copied tables. Teams need controlled exports from the exact BOM view they selected, with repeatable layout, revision context, and an optional evidence attachment on the item.

## Existing Repo Base

- BOM view discovery: `GET /plm/bom-views-and-fields`.
- BOM data: `GET /plm/bom` with `viewId`, `depth`, and `revisionBias`.
- Excel export: `POST /plm/excel-export` with sheet type `bom`.
- Attachment upload: `POST /plm/upload/:wsId/:dmsId`.
- UI panels: `insertSearch`, `insertBOM`, `insertBOMPartsList`, `insertAttachments`.
- Default BOM view convention: `Tree Navigator`.

## MVP Screen

Endpoint: `/bom-export-attachment-studio`.

Read-only first screen:

1. Select an item.
2. Select a BOM view.
3. Select depth and revision bias.
4. Preview the BOM rows and selected columns.
5. Export local file:
   - Excel `.xlsx` through existing `/plm/excel-export`.
   - CSV from the same flattened BOM rows.
   - PDF from a selected layout template.
6. Show generated file path under `storage/`.

## PDF Design Workspace

Keep PDF layout configuration local and tenant-safe:

- template name,
- page size and orientation,
- logo/header/footer,
- visible BOM columns,
- column widths,
- grouping or indentation,
- root item metadata,
- revision/date/user block,
- optional QR/data carrier placeholder.

Store template presets as local config first. Do not store customer logos or private branding in tracked defaults.

## Attach Gate

Attaching the generated PDF, Excel, or CSV to the item is a tenant write.

Before enabling it:

1. Name tenant, item workspace, and root item.
2. Name generated file and target attachment folder.
3. Capture current attachment list.
4. Confirm whether an existing file should create a new version or be skipped.
5. Upload through `POST /plm/upload/:wsId/:dmsId`.
6. Re-read attachments and report the created/updated attachment.

Default attachment folder: `Generated BOM Exports`.

## CSV Scope

CSV is a lightweight export from the flattened BOM rows. It should use the selected BOM view columns and escape values with standard CSV quoting.

## Not In MVP

- No tenant write by default.
- No automatic workflow transition.
- No official document release package.
- No new PDF library until the local PDF layout proof needs it.

## Promotion Evidence

Promote this use case when Workspace Editor or BOM evidence confirms:

- Items workspace has BOM tab access.
- Target BOM views exist and expose useful columns.
- Attachments tab is available.
- Users need controlled BOM snapshots for review, release, supplier, service, or compliance work.

## First Implementation Slice

Reuse existing export and attachment paths:

```text
read item -> read BOM views -> read selected BOM -> generate local xlsx/csv/pdf -> optional confirmed upload
```

Build export-only first. Add attach only after the write boundary is explicitly approved.
