# Conti Machinery — customer intake manifest

- **Customer:** Conti Machinery
- **Tenant:** `sbcmm`
- **Source:** `external/incoming/CM_plm/` (a Jan 2026-baseline deployment, own history since then)
- **Local config:** `environments/conti.js` + `settings/conti.js` (2026-08-05, ported from
  `CM_plm/environment.js` + `CM_plm/settings/custom.js`)
- **Target repo:** not yet decided — `customer-extensions/conti.config.json` has a `TODO` placeholder.

## What was ported

- Real `common.workspaceIds` for `sbcmm` (19 workspace IDs).
- `common.workspaces.items` / `common.viewer` overrides — structurally unchanged since the source
  was written, ported verbatim.
- `applications` block — almost entirely empty anchors in the source; kept as anchors here too.

## Priority (confirmed by user, 2026-08-05)

Conti Machinery is the intended primary customer for two existing cockpit apps. These get
workspace/field configuration completed **first**, ahead of the `ubom` rebuild below:

- **`supplierCenter`** (Supplier Command Center) — anchor added to `settings/conti.js`, needs real
  `workspaceIds` for `supplierPackages`, `sparePartsRequests`, `items`, `problemReports`,
  `nonConformances` on `sbcmm`.
- **`bomExportAttachmentStudio`** (BOM Export And Attachment Studio) — anchor added, needs real
  `workspaceIds.items`/`workspaceIds.documents`, `defaultBOMView`, and export field lists for
  `sbcmm`.
- **`supplierPackageCenter`** — related app, anchor added, needs `workspaceId` + `listFields`.

None of these existed in the source's Jan 2026 `settings/custom.js` (all three apps are newer than
that baseline) — real values need live discovery against `sbcmm`, a good first use of
`tools/fm-mcp` (`fm_workspaces`/`fm_fields`) or a browser-based tenant discovery pass.

## Open items (not resolved, flagged for follow-up)

1. **`ubom` (Usage BOM Editor) is a Conti-specific feature to rebuild, not a generic cockpit app.**
   Confirmed by user: work on it continues, as a customer-specific extension for Conti (not
   upstream). The source's `ai/HANDOVER.md` documents active work-in-progress setting up a
   `USAGE_BOM` linking field on workspace 57 specifically for it. This cockpit's May 2026 baseline
   has no `ubom` route/app to build on top of — it needs to be built from scratch as Conti-only
   code (`public/javascripts/custom/`, referenced via `customFiles` in
   `customer-extensions/conti.config.json` once it exists). Deferred until the priority items above
   are done.
2. **4 unresolved linking fields on WS 57** (from `ai/HANDOVER.md`): `EBOM_ROOT_ITEM`,
   `SERVICE_BOM`, `ENGINEERING_BOM`, `USAGE_BOM` — need "Single Selection" type with a
   `CUSTOM_LOOKUP_WS_ITEMS` self-lookup, which the basic Workspace Manager "Add Field" dialog
   doesn't offer. Next step per the source's own notes: check the Picklist Manager. See
   `.claude/skills/fm-admin-fields/SKILL.md` for the general field-creation workflow this needs.
3. **`serialNumbers: 307` is identical to `designReviews: 307`** in the ported workspace ID map —
   carried over as-is from the source, but worth verifying against the live tenant rather than
   assuming it's intentional.
4. **`settings/custom_old.js`** existed in the source alongside `custom.js` — not ported, presumed
   superseded backup. Still sitting in `external/incoming/CM_plm/` if it's ever needed.
5. **Target repo URL** for packaging (ZIP/git push) not yet decided.

## Not yet done

- Packaging script (`tools/package-customer-extension.js`) doesn't exist yet — see
  `docs/CUSTOMER-EXTENSIONS-PLAN.md`. `npm start conti` has not been run/verified in this cockpit.
- No browser-based tenant verification against `sbcmm` performed from this cockpit yet.
- Real workspace/field IDs for `supplierCenter`, `bomExportAttachmentStudio`,
  `supplierPackageCenter` not yet filled in (see Priority section above).
