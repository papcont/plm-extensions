# ERP Integration (`/erp`)

Transfers Bills of Materials from Autodesk Fusion Manage (PLM) into an external ERP system —
currently [Dolibarr](https://www.dolibarr.org/) — either on demand (button click / batch) or
automatically when a Lean Change Order reaches an approved state, via an inbound Autodesk
webhook.

## Architecture

```
┌──────────────────┐        ┌───────────────────────────────┐        ┌─────────────┐
│  Fusion Manage    │        │  This server (/erp)           │        │  Dolibarr   │
│                    │        │                               │        │             │
│  - Items / BOM     │──REST──▶  routes/erp.js                │──REST──▶  Products   │
│  - Workflow        │        │  services/erpTransferService  │        │  BOMs       │
│  - Webhooks         │──webhook▶ services/erpWebhookManager  │        │             │
└──────────────────┘        │  services/erpDolibarrClient    │        └─────────────┘
                             │  services/erpBomTransformer    │
                             │  services/erpHistoryStore      │  (storage/erp/*.json)
                             │  services/erpProgressStore     │  (in-memory)
                             │  services/erpTransferQueue     │  (in-memory)
                             │  services/erpServiceAccountStore│ (storage/erp/*.json)
                             │  services/erpWebhookRegistrationStore│ (storage/erp/*.json)
                             └───────────────────────────────┘
```

The frontend (`views/apps/erp.pug`, `public/javascripts/apps/erp.js`) is a single-page item
search + BOM/transfer studio: pick an item on the left, review its BOM/Details on the right,
click **Transfer to ERP**, watch a live progress dialog, and inspect Transfer History below.

## Configuration

All ERP settings live in `environment.js` (gitignored) — required to enable the app at all:

| Setting | Env var | Purpose |
|---|---|---|
| `dolibarrApiUrl` | `DOLIBARR_API_URL` | Dolibarr REST API base, e.g. `http://localhost:3030/dolibarr/api/index.php` |
| `dolibarrApiKey` | `DOLIBARR_API_KEY` | Dolibarr `DOLAPIKEY` header value |
| `erpServiceAccountEmail` | — | Account whose refresh token is used for unattended (webhook) transfers — see [Service account](#service-account-unattended-auth) |

Per-tenant app behavior lives in `settings.js` / `settings/<tenant>.js` under
`exports.applications.erp`:

```js
erp: {
    workspaceId       : null,      // null -> common.workspaceIds.items
    itemNumberFieldId : 'NUMBER',  // PLM field id used as the Dolibarr product ref
    maxFieldLength    : 0,         // 0 = off; validate ref/label/description length once a target ERP needs it
    releasedLifecycleValues : ['Released'],  // unset = gate disabled (today's Dolibarr demo)

    // Optional: auto-transfer when a Lean Change Order reaches "Approved"
    leanChangeOrderWebhook : {
        workspaceId            : 1033,
        workflowId              : 1,
        transitionIds           : [1778, 1787, 1789],   // every transition that leads into "Approved"
        approvedLifecycleTitle  : 'Approved',
        callbackUrl             : 'https://<public-url>/erp/webhooks/lean-change-order',
        secret                  : '<hmac-secret>',
        notifyOnFailure : {                             // optional
            fieldId  : 'ERP_TRANSFER_ERROR',
            scriptId : 0
        }
    }
}
```

If `dolibarrApiUrl`/`dolibarrApiKey` aren't set, the UI shows a "not configured" banner
(`GET /erp/config`) but the endpoints still exist (transfers will fail with a clear error).

## REST endpoints (`routes/erp.js`)

All endpoints are mounted under `/erp`. Manual/UI endpoints run inside the interactive user's
`req.session` (3-legged PKCE, same as every other app) — see
[Authentication](#authentication-two-different-flows).

| Method & path | Purpose |
|---|---|
| `GET /erp/config` | Whether Dolibarr is configured, resolved workspace id, item-number field id (used by the UI's config-warning banner). |
| `POST /erp/transfer` | Transfer one item's BOM. Body: `{ wsId, dmsId, transferId?, override?, trigger? }`. Returns `{ success, message, requiresOverride, data }`. |
| `GET /erp/transfer-progress/:id` | Poll live progress of an in-flight transfer (`transferId` from the POST above). In-memory only, not resumable across page reloads. |
| `POST /erp/transfer-batch` | Transfer several items sequentially. Body: `{ items: [{ wsId, dmsId }, ...] }`. |
| `GET /erp/transfer-history?limit=50` | Most recent transfer records (newest first), each augmented with a browsable `dolibarrUrl` if it has a `dolibarrBomId`. |
| `GET /erp/transfer-status/:id` | One history record by its numeric id. |
| `GET /erp/transfer-item/:wsId/:dmsId` | Most recent transfer record for a specific item (used to show "Last transfer: ..." when an item is selected). |
| `POST /erp/webhooks/register` | Registers the 3 Lean-Change-Order transition webhooks at Autodesk for `applications.erp.leanChangeOrderWebhook`. Interactive, admin-triggered. |
| `POST /erp/webhooks/unregister/:hookId` | Unregisters one webhook by its Autodesk `hookId`. |
| `POST /erp/webhooks/lean-change-order` | **Inbound** — Autodesk calls this when a registered transition fires. See [Webhook flow](#webhook-driven-auto-transfer) below. Not called by the UI. |

### Transfer result shape

```json
{
  "success": true,
  "message": "BOM transferred successfully",
  "requiresOverride": false,
  "data": {
    "success": true,
    "dolibarrBomId": 26,
    "itemsTransferred": 6,
    "record": { "...": "the same object GET /erp/transfer-history returns" }
  }
}
```

`requiresOverride: true` means nothing ran server-side — the item's lifecycle isn't in
`releasedLifecycleValues` and no history record was written. The UI offers a "Trotzdem
übertragen" (transfer anyway) button that resubmits with `override: true`.

## Transfer pipeline (`services/erpTransferService.js`)

`transferBOM(req, wsId, dmsId, transferId, override, trigger)` → enqueued through
`erpTransferQueue` (see [Concurrency model](#concurrency-model)) → `transferBOMNow`:

1. **Fetch item details** (`GET /api/v3/workspaces/:wsId/items/:dmsId`).
2. **Lifecycle gate** (optional) — if `releasedLifecycleValues` is configured and the item's
   lifecycle isn't in that list, return `requiresOverride: true` instead of failing.
3. **Fetch flat BOM** (`GET .../bom-items?revisionBias=release&rootId=...`,
   `Accept: application/vnd.autodesk.plm.bom.flat.bulk+json`) — every position at every level,
   depth-flattened by PLM itself.
4. **Ensure the top-level Dolibarr product** (`erpDolibarrClient.ensureProduct`).
5. **Resolve BOM positions** (`resolveBOMPositions`) — see [Two-stage resolution](#two-stage-bom-resolution) below.
6. **Ensure the Dolibarr BOM header** (`erpDolibarrClient.ensureBOM`) — create or update
   `BOM-<ref>`.
7. **Add BOM lines** — **only if the BOM was newly created** (`bom.isNew`). On every subsequent
   transfer of an already-existing BOM, only the header (label/description) is refreshed; line
   items are *not* re-synced. ⚠️ See [Known gap](#known-gap-bom-line-changes-dont-propagate).
8. Write a `transfer-history` record and return.

Every step appends a timestamped entry to an in-memory `log` array that ends up on the history
record (`GET /erp/transfer-status/:id` → `data.log`) — a coarse trace of where a transfer got to
without needing server console access.

### Two-stage BOM resolution

For a large BOM (hundreds to thousands of positions), `resolveBOMPositions` deliberately uses two
different concurrency strategies, learned against a real ~1400-position assembly:

- **Stage 1 — PLM item lookups run concurrently** (`RESOLVE_CONCURRENCY` workers), deduped by
  link. Autodesk's cloud API tolerates concurrent reads fine, and this is the majority of round
  trips for BOMs with many distinct parts.
- **Stage 2 — Dolibarr product resolution runs strictly one at a time**, deduped by sanitized ref
  (`erpDolibarrClient.ensureProduct` result is memoized per-transfer in `productByKey`, **and**
  across transfers in a process-lifetime cache inside `erpDolibarrClient.js` — see
  [Performance notes](#performance-notes)). A local Apache+PHP+MySQL Dolibarr install could not
  tolerate concurrent product-creation writes (even 3 at a time caused MySQL lock contention
  severe enough to hang requests for tens of seconds) — one-at-a-time turned out faster overall.
- **Adding BOM lines** (`erpDolibarrClient.addBOMLines`) is likewise strictly sequential — a plain
  BOM-line `POST` has no idempotency check, so parallelizing or retrying it risks duplicate lines.

`withTransientRetry(fn, attempts)` wraps only the read-safe / find-before-create calls, retrying
up to `attempts` times on `ECONNRESET` / `ECONNABORTED` / "socket hang up" — never wrapped around
a plain write.

### Concurrency model

- **`erpTransferQueue.js`** — a single global promise chain. Every transfer (manual button,
  retry, batch item, webhook) is enqueued through it so two transfers never race Dolibarr writes
  against each other. In-memory only (a restart drops whatever was mid-flight); one global lane,
  not per-tenant — fine while there's a single tenant.
- **`erpProgressStore.js`** — in-memory `Map<transferId, {step, current, total, detail, done}>`,
  polled by the UI every 400ms via `GET /erp/transfer-progress/:id` while the long `POST
  /erp/transfer` request is in flight. Not persisted; a page reload during a transfer just loses
  the live display (the transfer itself keeps running).
- **HTTP keep-alive** — both the PLM and Dolibarr axios clients use a `keepAlive` agent. Without
  it, the connection churn from a large transfer can exhaust Windows' ephemeral port range and
  make unrelated requests queue for tens of seconds.

## Dolibarr client (`services/erpDolibarrClient.js`)

Thin wrapper around Dolibarr's REST API (`/products`, `/boms`, `/boms/:id/lines`), exposing an
ERP-neutral facade (`ensureProduct`, `ensureBOM`, `addBOMLines`, `sanitizeRef`) so a future
different ERP client can implement the same shape without leaking Dolibarr specifics into
`erpTransferService.js`.

### `sanitizeRef(ref)` — load-bearing

Dolibarr silently rewrites "special" characters in a product/BOM `ref` on storage:

- Runs of whitespace collapse to a single `_`.
- Each of `' " `  \ / : ; * ? = [ ] | $ , ( )` individually becomes `_` (not collapsed when
  repeated).

Searching or creating with an un-sanitized ref means the search never matches what's actually
stored — `ensureProduct`/`ensureBOM` would think nothing exists yet and try to create it again,
which then fails against Dolibarr's own uniqueness check (`ErrorProductAlreadyExists`) once two
different BOM lines resolve to refs that only differ by one of these characters. Parentheses are
additionally stripped (rather than escaped) because they break `findProductByRef`'s own
`sqlfilters` query syntax outright. **Always sanitize before both search and create.**

### Performance notes

`ensureProduct` keeps a process-lifetime `Map<sanitizedRef, product>` cache. A cold lookup
(`GET /products?sqlfilters=...`) costs roughly 1–1.2s against a local dev Dolibarr instance; a
cache hit is ~0ms (no HTTP call at all). This only removes *redundant reads* of products already
known from an earlier transfer in the same server process — every write (`POST`) still happens
exactly as often and exactly as sequentially as before, so the "no concurrent writes" tolerance
limit discovered above is unaffected.

- No invalidation: the cache assumes a product is never deleted/renamed directly in Dolibarr
  outside this app. A server restart clears it (next transfer for that ref is "cold" again).
- Real numbers observed against a 1424-position assembly (first-ever transfer, so every unique
  product was a genuine create): ~920 unique parts, stage 2 (product resolution) took **~18
  minutes**, adding the 1424 BOM lines took a further **~27 minutes** (≈1.16s/line, unavoidable —
  every line is a distinct required write). On any *re-transfer* of the same or an overlapping
  assembly (the common case via the Lean Change Order webhook), stage 2 now costs close to
  nothing once those refs are warm in the cache.

## Known gap: BOM line changes don't propagate

```js
if (bom.isNew) {
    await dolibarr.addBOMLines(dolibarrConfig, dolibarrBomId, dolibarrLines, ...);
}
```

BOM lines are written **only the first time** a Dolibarr BOM is created for a given item. Every
subsequent transfer of the same item calls `ensureBOM` → `updateBOM` (header only: label/
description) and **skips line writing entirely** — even if the underlying Fusion Manage BOM
changed (a part added, removed, or re-quantified) since the last transfer. This is a known,
not-yet-fixed limitation, not a design choice — flagged here so it isn't mistaken for tested
behavior. (A from-scratch idempotency test that only re-transfers an *unchanged* BOM will look
clean regardless of this gap, since the line-write path never runs in that case either.)

## Authentication (two different flows)

- **Manual / UI-triggered transfers** — the interactive user's normal 3-legged PKCE session
  (`req.session.headers`), same as every other app in this server. No special setup.
- **Unattended (webhook) transfers** — there is no logged-in user when Autodesk calls the
  inbound webhook. `erpWebhookManager.getServiceHeaders(req)` instead uses the refresh token of a
  designated **service account** (`environment.erpServiceAccountEmail`), captured automatically
  the next time that account logs into the app normally (`routes/landing.js`). 2-legged
  client-credentials + impersonation was tried and rejected ("Mapped user is either not present or
  not valid") since this tenant has no admin-side user mapping configured for it.
  - Refresh tokens **rotate on use** — the spent one is saved over immediately
    (`erpServiceAccountStore.saveRefreshToken`), so consuming it elsewhere while a webhook call is
    in flight would invalidate the other caller's copy.
  - Swap the service account later by pointing `erpServiceAccountEmail` at a different address and
    having that account log in once — no other code changes needed.

## Webhook-driven auto-transfer

### Registration

`POST /erp/webhooks/register` (interactive, admin-triggered) reads
`applications.erp.leanChangeOrderWebhook` and registers **one Autodesk webhook per transition
id** — Autodesk scopes a `workflow.transition` webhook to a single transition, not a target
state, so a state reachable via N transitions needs N registrations against the same
`callbackUrl`. Successful `{transitionId, hookId}` pairs are persisted to
`storage/erp/webhook-registration.json`.

`app.js` calls `ensureWebhooksRegistered()` once at every server startup: if the stored
`callbackUrl` still matches config and the registration count matches, it's a no-op; otherwise it
unregisters the old hooks (best-effort) and re-registers against the current `callbackUrl` — this
is what makes a changing tunnel URL (e.g. a Cloudflare Quick Tunnel restarting) self-heal without
a manual re-registration step. This path uses the service account's headers, not an interactive
session, since there's no logged-in admin at boot.

### Inbound receiver — `POST /erp/webhooks/lean-change-order`

1. Verifies `X-ADSK-Signature` as HMAC-SHA1 over the *raw* request bytes (`req.rawBody`, captured
   by a `bodyParser.json` `verify` hook in `app.js` — hashing a re-serialized copy would not
   match) using the configured `secret`. No secret configured ⇒ reject, never silently skip:
   an inbound endpoint that can trigger a real ERP transfer must not be optionally secured.
2. Responds `200` **immediately** ("Webhook received") — Autodesk expects a fast ack; the actual
   transfer work continues after the response is sent.
3. Parses the change order's `wsId`/`dmsId` out of the payload's `resourceUrn`.
4. Mints service-account headers, fetches the change order, and logs (but does not enforce) a
   lifecycle-state mismatch — the workflow can auto-advance past "Approved" before this check
   runs; the webhook's own registration scope (only the 3 transitions leading into Approved) is
   the real gate, re-checking live would just race the workflow.
5. Reads the change order's **Managed/Affected Items** (view 11) — this lists *every level* of
   an assembly the change touches, not just the top item. For each affected item, a `where-used`
   check determines whether it's a sub-component of another affected item in the same set; if so
   it's skipped — only items with no in-set parent are the real top-level transfer targets.
6. Transfers each top-level item **with retry**: up to 3 retries after the first attempt, backing
   off 30s / 2min / 10min between attempts (`transferWithRetry`), each item independent and
   concurrent so one slow backoff doesn't delay the others (queue-safe — see
   [Concurrency model](#concurrency-model)). `override: true` is passed since the approval itself
   is the release signal.
7. If all attempts fail and `notifyOnFailure` is configured: writes a status/link into a
   tenant-defined field on the Change Order item, then triggers an on-demand Fusion Manage
   script on that same item. The script itself (authored in the tenant) composes and sends the
   actual notification (email, Teams, etc.) — this server only supplies the field value and
   triggers the script, keeping "who gets notified and what it says" entirely tenant-owned.

```
ponytail: webhook retries are in-memory (setTimeout) - a server restart mid-backoff silently
drops the pending retry. Upgrade to a persisted retry queue if that turns out to matter.
```

## Storage (`storage/erp/`)

All file-backed, JSON, no database dependency — appropriate for this app's scale.

| File | Written by | Contents |
|---|---|---|
| `transfer-history.json` | `erpHistoryStore.js` | Last 500 transfer records (newest first): `{id, wsId, dmsId, itemTitle, dolibarrBomId, status, errorMessage, overridden, trigger, log, transferredAt}`. `status` ∈ `success \| warning \| rejected \| error` (`failed` is a pre-Phase-4 alias for `error`, kept for old records). `trigger` ∈ `manual \| retry \| batch \| webhook \| webhook-retry`. |
| `service-tokens.json` | `erpServiceAccountStore.js` | `{ "<email>": { refreshToken, updatedAt } }` — one entry per account that has ever logged in and been designated as the service account. |
| `webhook-registration.json` | `erpWebhookRegistrationStore.js` | `{ callbackUrl, registrations: [{transitionId, hookId}], updatedAt }` — last-known-good registration state. |

## Frontend (`views/apps/erp.pug`, `public/javascripts/apps/erp.js`)

- Left: item search (`insertSearch`, scoped to `config.workspaceId || common.workspaceIds.items`),
  live-filtered as you type.
- Center/right: selected item's title, a link to open it in Fusion Manage, a **Transfer to ERP**
  button, last-transfer status line, and (via the shared framework) its BOM (`insertBOM`, depth
  10) / Details tabs.
- Below: **Transfer History** table (date, item, status badge, Dolibarr BOM link, details, retry
  for failed rows) with running Transfers/Successful/Failed counters.
- A transfer opens a progress dialog polling `GET /erp/transfer-progress/:id` every 400ms for a
  live "step: current of total — detail" line, until the `POST /erp/transfer` call itself
  resolves.
- `?historyId=<id>` in the URL (used by the failure-notification email link) jumps straight to
  that transfer's details instead of requiring the user to find it in the table.

## Verification pattern

There is no automated test suite for this subsystem (or the rest of the app). The established
loop:

1. Edit a service/route file → `node --check <file>` for syntax.
2. Restart the server (route/service/env changes need a process restart; Pug views and client
   JS/CSS are served fresh per request, no restart needed for those).
3. Drive the actual `/erp` page (or the equivalent service calls directly, e.g. via the ERP
   service account's own refresh token when an interactive browser login isn't available) against
   the live tenant + local Dolibarr — several real bugs here (the exact ref-sanitization rules,
   the large-BOM performance ceiling, the BOM-line-update gap above) were only found this way, not
   by reading the code.
4. Cross-check results directly against Dolibarr's REST API (`GET /products?sqlfilters=...`,
   `GET /boms/:id`) rather than trusting the transfer-history record alone.
