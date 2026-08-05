# Konti (Conti Machinery) — customer intake manifest

- **Customer:** Conti Machinery
- **Tenant:** `sbcmm`
- **Source:** `external/incoming/CM_plm/` (a Jan 2026-baseline deployment, own history since then)
- **Local config:** `environments/konti.js` + `settings/konti.js` (2026-08-05, ported from
  `CM_plm/environment.js` + `CM_plm/settings/custom.js`)
- **Target repo:** not yet decided — `customer-extensions/konti.config.json` has a `TODO` placeholder.

## What was ported

- Real `common.workspaceIds` for `sbcmm` (19 workspace IDs).
- `common.workspaces.items` / `common.viewer` overrides — structurally unchanged since the source
  was written, ported verbatim.
- `applications` block — almost entirely empty anchors in the source; kept as anchors here too.

## Open items (not resolved, flagged for follow-up)

1. **`ubom` (Usage BOM Editor) no longer exists in this cockpit.** The source's `settings/custom.js`
   had a `ubom: {}` block, and `ai/HANDOVER.md` documents active work-in-progress setting up a
   `USAGE_BOM` linking field on workspace 57 specifically for that app. This cockpit's May 2026
   baseline has no `ubom` route/app (only `abom`, `mbom`, `sbom` remain) — no direct successor was
   found. **Needs a decision:** was `ubom` intentionally retired upstream, folded into `mbom`, or
   does Conti Machinery still need equivalent functionality built as a customer-specific extension?
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
  `docs/CUSTOMER-EXTENSIONS-PLAN.md`. `npm start konti` has not been run/verified in this cockpit.
- No browser-based tenant verification against `sbcmm` performed from this cockpit yet.
