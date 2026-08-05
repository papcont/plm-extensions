---
name: fm-admin-fields
description: Create/verify workspace fields in the Fusion Manage (FM) tenant admin UI (Workspace Manager). Use when a workspace is missing fields that settings.js/custom.js expect.
---

# FM Workspace Manager — creating fields

Field creation is **not possible via the v3 REST API** — confirmed by probing
`POST /api/v3/workspaces/:id/fields` against the live tenant → `405 METHOD_NOT_ALLOWED`.
It must go through the classic admin UI. This doc is what to do instead of re-discovering
the flow by trial and error.

## Diff what's actually missing (read-only, safe, do this first)

Never trust a field list written down in an earlier chat/spec — re-derive it live:

```js
fetch('/api/v3/workspaces/<wsId>/fields', {credentials:'same-origin', headers:{Accept:'application/json'}, cache:'no-store'})
  .then(r => r.json())
  .then(d => {
    const existing = new Set(d.fields.map(f => f.__self__.split('/').pop())); // fieldId is the last path segment of __self__, NOT a top-level key
    const required = [/* fieldIds from settings.js / custom.js config */];
    return required.filter(id => !existing.has(id));
  })
```

Run this from the browser console on a tab already logged into the tenant
(`https://<tenant>.autodeskplm360.net/...`) — it reuses that session's cookies, no
separate auth needed. **Caveat:** this endpoint appears to be served from a cache that
does not update immediately after admin UI changes (see below) — don't use it to verify
a just-created field, only to find what's missing before you start.

## Find the workspace's admin URL directly

The Workspace Manager entry in the hamburger menu is a hover-flyout — clicking it
programmatically is unreliable. Instead, grab the real href once and navigate directly:

```js
document.querySelector('a[href*="workspace-manager"]').href
// -> https://<tenant>.autodeskplm360.net/plm/admin/workspace-manager
```

Then `.../workspace-manager/<wsId>` opens that workspace directly (found by clicking a
workspace tile once and reading `location.href` — the URL contains the numeric ID).
Sub-pages (`/item-details-tab` etc.) are reached by clicking the left-nav items; there's
no need to guess further URLs, the click updates the top-frame URL predictably.

## The field editor lives in an iframe

`/plm/admin/workspace-manager/...` pages render their content in an `<iframe>`. Always go
through `document.querySelector('iframe').contentDocument` — direct `document.body`
queries on the top frame return almost nothing.

## Creating a plain field (Single Line Text, Check Box, Date, Integer, etc.)

1. Click the button with `title="Add Field"` inside the iframe (a `dgrid`/dojo widget;
   there is no reliable link/anchor, only this input's title attribute).
2. **Do not chain click + fill in one `browser_eval` call.** The dialog's inputs (`input[name=fieldName]`, `fieldID`, the type `<select>`) don't exist synchronously right after the click — query for them in a *separate* eval call after the click has returned.
3. Set `fieldName`, then dispatch **both** `input` and `keyup` on it — `fieldID` is
   auto-derived (uppercased, spaces → underscores) but only updates on `keyup`, not just
   `input`/`change`. The ID field itself is not editable — get the exact fieldId you need
   by choosing the display name that transforms into it (e.g. name it "Usage" to get
   `USAGE`, not "Usage Code").
4. Set the type `<select>` value and dispatch `change`.
5. For text-type fields, `fieldLength`/`displayLength` inputs only appear **after** that
   change event fires and are themselves not present in the same synchronous call that
   set the select — query for them in a following eval call, then fill both (e.g. `200`/`200`) or Save fails with "Field length must be greater than 0."
6. Click the **last** `input[type=submit]` with `value === 'Save'` — there are always two
   matches (query filters can pick up a stale reference from the closed prior dialog); take
   `offsetParent !== null` to be sure you get the visible one, and pick the last if more
   than one remains.
7. **Repeat per field one at a time.** Reusing a dialog-element handle across a
   click→reopen cycle throws `Cannot set properties of null` — always re-query from
   scratch after each `Add Field` click.

## Committing the change — the easy-to-miss step

Saving a field only stages it in that tab's local layout. Nothing is actually persisted
to the tenant until you click the separate button `input[name=saveworkspacebutton]`
("Save Layout") once, after all fields for that tab are added. Confirmation text:
"The layout was successfully saved". Skipping this looks like success (fields appear in
the on-page list immediately) but a full page reload will show they're gone if you forget
this step.

## Verifying

The v3 metadata API (`/api/v3/workspaces/:id/fields`) does **not** reflect the change
immediately after "Save Layout" — it's backed by a separate, slower-to-invalidate cache
from whatever the classic admin UI writes to. Don't use it as the source of truth right
after a save. Instead do a hard `location.reload()` on the tab and check the field still
appears in the admin UI's field list — that's the real persistence check. The v3 API will
catch up on its own schedule (unconfirmed how long; treat "not there yet" as expected, not
a failure, for at least a few minutes after saving).

## Fields with type "Single Selection" (linking fields — e.g. MBOM, EBOM)

**Unsolved / needs more investigation.** `MBOM`/`EBOM` on the Items workspace are
`fieldType 23` ("Single Selection") with `picklist: /api/v3/lookups/CUSTOM_LOOKUP_WS_ITEMS`
(a self-referencing lookup back to the same workspace, via `CUSTOM_LOOKUP_WS_ITEMS`) and
`picklistFieldDefinition` pointing at that workspace's `DESCRIPTOR` field. This confirms
what target a new linking field *should* use to match the existing pattern, but:

- "Single Selection" (type 20/23) is **not** an option in the basic "Add Field" dialog's
  Data Type dropdown (confirmed: only Integer/Float/Money/Date/Single Line Text/Paragraph/
  Paragraph w/o Line Breaks/Check Box/Image/URL/Email/CSV/Flash/BOM UOM Pick List/Derived/
  Auto Number/Pick List are present).
- "Workspace relationships" (left-nav item) turned out to be about which workspaces are
  linkable from BOM/Relationships/Managed Items/Project Management **tabs**, not about
  creating an arbitrary Single-Selection field with a specific existing lookup attached.
- Next things to try: **Picklist Manager** (top admin menu) — `CUSTOM_LOOKUP_WS_ITEMS` is
  presumably managed there and a new field might attach to an existing picklist from a
  field-creation flow reachable from that screen instead of Workspace Manager's basic
  dialog. Check there before assuming a new custom lookup is needed.
