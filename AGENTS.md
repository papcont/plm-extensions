# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A self-hosted Node.js/Express server that delivers ~30 web applications (and Vault/Inventor
add-ins) layered on top of Autodesk Fusion Manage (PLM) via the PLM and APS REST APIs. The server
is stateless with respect to PLM data — it proxies REST calls, but does not persist tenant data.
There is no build step, no test suite, and no linter configured.

## Commands

- `npm install` — install dependencies.
- `npm start` — launch using `./environment.js` (the default connection settings).
- `npm start <name>` — launch using `./environments/<name>.js` instead. Used to run the same
  server against multiple Fusion Manage tenants (`npm start adsktenant` loads
  `environments/adsktenant.js`).
- HTTPS is auto-selected when `redirectUri` uses `https://` and `keys/privkey.pem` +
  `keys/fullchain.pem` exist; otherwise HTTP is used. Port comes from `redirectUri` or `PORT`.
- No automated tests exist. Verification is manual: start the server, drive the real page in a
  browser, check the console/network tab and the actual PLM/ERP data, not just `node --check`.

Any setting in `environment.js` can be overridden by an uppercase-snake-case env var
(`TENANT`, `CLIENT_ID`, `REDIRECT_URI`, `SETTINGS`, `DEFAULT_THEME`, `ENABLE_CACHE`,
`DEBUG_MODE`, `FUSION_CONNECTED`, `ADMIN_CLIENT_ID`, `ADMIN_CLIENT_SECRET`, `VAULT_GATEWAY`,
`VAULT_NAME`, `DOLIBARR_API_URL`, `DOLIBARR_API_KEY`, `ERP_SERVICE_ACCOUNT_EMAIL`, `PORT`,
`PROTOCOL`). This is the intended path for cloud hosting.

## Three-layer settings system

1. **`environment.js`** (gitignored, per-deployment) — connection settings: `tenant`,
   `clientId`, `redirectUri`, `defaultTheme`, `vaultGateway`, `dolibarrApiUrl`/`dolibarrApiKey`,
   `erpServiceAccountEmail`, plus `exports.settings` pointing at the custom settings file.
2. **`settings.js`** (tracked, ~2000 lines, **do not edit**) — full default config for every
   application.
3. **`settings/<name>.js`** (gitignored except `custom.js` template) — per-tenant overrides,
   deep-merged onto `settings.js` at startup by `app.js:mergeSettings()`. Only put the keys that
   differ from the default in here — omitted keys keep their `settings.js` value.

For multiple tenants: paired `environments/<tenant>.js` + `settings/<tenant>.js`, launched with
`npm start <tenant>`.

## Request flow

`bin/www` boots `app.js`. Routes:

- `/` → `routes/landing.js` — Pug pages + APS OAuth (PKCE) at `/callback`.
- `/plm` → `routes/plm.js` (~8000 lines) — the PLM REST proxy (items, BOM, attachments,
  workflow, search, GraphQL, Excel import/export). Almost every client call lands here.
- `/aps` → `routes/aps.js` — Model Derivative / OSS proxy for the viewer.
- `/vault` → `routes/pdm.js` — Vault REST passthrough for the Vault/Inventor add-ins.
- `/services` → `routes/services.js`.
- `/erp` → `routes/erp.js` — ERP Integration (see below).
- `/storage` → static + directory listing of `./storage/`.

`routes/landing.js` is the routing table for user-facing apps: one line calling
`launch(view, appSettingsKey, title, req, res, next)`, which checks
`server.servicesEnabled[endpoint]`, handles the APS PKCE login, resolves `hubId`/`vaultId`, and
renders the Pug view with `config = app.locals.applications[appSettingsKey]`.

Adding a standard app = one `routes/landing.js` line + one Pug view extending
`views/framework/layout.pug` + one JS file in `public/javascripts/apps/` + a
`settings.js` `exports.applications` entry + a `servicesEnabled` flag.

## Client-side framework

No bundler, no module system. `views/framework/layout.pug` injects server state as **global
JS variables** (`tenant`, `theme`, `wsId`, `dmsId`, `common`, `config`, `menu`, `colors`, ...) and
loads shared modules in a fixed order before the per-app script: Viewer → jQuery →
`framework/utils.js` → `contents/*.js` → `custom.js` → the app script. Client code reads these as
bare globals — do not introduce ES module imports in app scripts.

- `public/javascripts/framework/utils.js` — DOM helpers, dialogs, panel primitives
  (`genPanelTop`, `genPanelToolbar`, ...), lifecycle (`beforeApplicationStart`, `enableTabs`,
  `clickTab`).
- `public/javascripts/framework/registry.js` — the panel registry (`insertXxx` functions, their
  default options) — source of truth, also powers `/gallery`.
- `public/javascripts/contents/*.js` — shared "content panel" modules (item, nav, bom, viewer,
  vault, classification, analytics, aps) that apps mount and configure via `config.panels.insertXxx`.

## Conventions worth knowing

- **PLM field references use field IDs, not display names** (`'ITEM_NUMBER'`, not "Item Number").
  Mismatched IDs are the #1 cause of "field is undefined" bugs — tenant-specific, verify in the
  target tenant before assuming they match.
- **BOM views are referenced by name** (e.g. `'Tree Navigator'`) and must exist in the target
  tenant.
- **`null` in app settings means "resolve at runtime"** against a `common.*` default — the
  per-app script does the fallback (`config.workspaceId || common.workspaceIds.items`).
- **The custom settings file only carries deltas.** Empty per-app blocks (`abom: {}`) are
  intentional anchor points — keep them.
- **Never hard-code a tenant in `routes/plm.js`.** Use `getTenantLink(req)` (allows the Tenant
  Comparison utility to override per-request) and `req.session.headers` for auth, not
  `app.locals.tenant` directly.
- **Route responses through `sendResponse(req, res, response, error)`** in `routes/plm.js` —
  keeps caching and error formatting consistent. Don't `res.json()` directly in that file.
- **Caching**: `req.session.cache` (per-user) and `sharedCaches[slug]` (process-global, keyed by
  `req.query.sharedCache`) — opt in with `useCache=true`, force refresh with `updateCache=true`,
  `POST /plm/clear-cache` wipes the session cache, `app.locals.enableCache=false` disables both.
- **Commit style**: `[<TYPE> : <Area>] <subject>` — `TYPE` ∈ {UPD, BUG, CSS, NEW, ...}, `Area` is
  the subsystem (Framework, Addins, Chrome Extension, ERP, ...).
- **`dev/` folder apps are work-in-progress**, not in the production Start Menu, no stability
  guarantee. Only touch them when the task explicitly names one.

## ERP Integration subsystem (`/erp`)

Transfers BOMs from Fusion Manage to an external ERP (currently Dolibarr) and can auto-trigger on
a Fusion Manage workflow transition via Autodesk Webhooks. Built incrementally this session —
know these before changing anything here:

- **`routes/erp.js`** — HTTP endpoints: manual transfer, batch transfer, transfer history/status,
  webhook registration (`/webhooks/register`), and the inbound webhook receiver
  (`/webhooks/lean-change-order`).
- **`services/erpBomTransformer.js`** — PLM item → ERP-neutral `{ref, label, description}`
  shape, plus field validation (`validateNeutralItem`).
- **`services/erpDolibarrClient.js`** — Dolibarr REST wrapper + `ensureProduct`/`ensureBOM`
  (find-or-create). **`sanitizeRef(ref)` is load-bearing**: Dolibarr silently rewrites "special"
  characters in a product/BOM `ref` on storage (whitespace runs → one `_`; each of
  `' " \` \ / : ; * ? = [ ] | $ , ( )` individually → `_`, not collapsed when repeated).
  Searching/creating with an un-sanitized ref causes `ErrorProductAlreadyExists` once two BOM
  lines differ only by one of these characters, or a `sqlfilters` syntax error if the ref reaches
  Dolibarr's search query containing a raw `(`/`)`. Always sanitize before both search and create.
- **`services/erpTransferService.js`** — orchestration (`transferBOM`, `batchTransfer`,
  `resolveBOMPositions`). Two deliberately different concurrency strategies, learned live against
  a 643-line real assembly:
  - PLM item-detail lookups run concurrently (`RESOLVE_CONCURRENCY`) — Autodesk's cloud API
    tolerates it fine, and it's the majority of round trips for BOMs with many distinct parts.
  - Dolibarr writes (`ensureProduct`, `addBOMLine`) run **strictly sequentially**. A local
    Apache+PHP+MySQL Dolibarr install could not tolerate concurrent product-creation writes (MySQL
    lock contention caused multi-minute hangs, far worse than one-at-a-time) — and unlike
    find-or-create, a plain BOM-line POST has no idempotency check, so parallelizing/retrying it
    risks duplicate lines.
  - Both PLM and Dolibarr axios clients use a `keepAlive` HTTP agent — without it, the sustained
    connection churn from a large transfer can exhaust Windows' ephemeral port range and make
    unrelated requests queue for tens of seconds.
  - `withTransientRetry` retries only operations that are safe to retry (a plain GET, or a
    find-before-create flow) on `ECONNRESET`/`ECONNABORTED`/"socket hang up" — never wrap a
    non-idempotent write in it.
- **`services/erpTransferQueue.js`** — serial promise-chain queue. Every transfer (manual, retry,
  batch, webhook) goes through it so two transfers never race Dolibarr writes against each other.
- **`services/erpWebhookManager.js`** — registers/unregisters Autodesk `workflow.transition`
  webhooks (scoped per-transition, not per-state — a state reachable via N transitions needs N
  registrations against the same callback) and verifies the inbound HMAC-SHA1 signature. Runs
  unattended calls via a **service account's refresh token** (`erpServiceAccountStore.js`,
  captured automatically on that account's next normal login in `routes/landing.js`) — not
  2-legged client-credentials, since impersonation requires a tenant-admin mapping this tenant
  doesn't have configured.
- **`services/erpWebhookRegistrationStore.js`** — persists which hookIds are registered against
  which `callbackUrl`, so `ensureWebhooksRegistered()` (called once at server startup in `app.js`)
  can skip re-registering when the tunnel URL hasn't changed, and safely replace them when it has.
- The Managed Items tab (Fusion Manage view 11) lists **every level** of an assembly a change
  touches, not just the top item — `routes/erp.js`'s webhook handler filters to top-level items
  only via a `where-used` check (an item that appears as another affected item's parent is a
  sub-component, skip it).
- APS access tokens last ~1 hour regardless of 2-legged vs 3-legged — the actual fix for
  "transfer takes long enough for the token to expire" is making the transfer fast (concurrency),
  not chasing a longer-lived token.
- Local Dolibarr dev instances (Apache+PHP+MySQL, not a provisioned server) are noticeably more
  fragile under write concurrency than under read concurrency or in isolation — a single isolated
  request responding fast is not proof the system tolerates load; verify against a realistic
  large BOM before trusting a performance fix.

## Verification pattern for this repo

There is no test suite. The established loop for a live server you can't directly inspect:

1. Edit → `node --check <file>` for syntax.
2. Ask the user to restart the server (env/route/service changes need a process restart; Pug
   views, client JS/CSS are served fresh per request).
3. Drive the actual page in a browser (or via browser automation) — re-run a known-good
   regression case first, then the specific new behavior.
4. For anything with real network calls (PLM, Dolibarr, webhooks), verify against the live
   tenant/API directly (curl, or through the app's own proxy) rather than assuming the code is
   correct from reading it — several real bugs in this codebase were only found this way
   (an API's exact ref-sanitization behavior, a webhook payload's actual field, a real
   large-BOM performance ceiling).

## Hard rules

- Keep diffs small and scoped to what was asked.
- Do not edit `settings.js` — tenant-specific values belong in `settings/<tenant>.js`.
- Do not introduce a bundler or ES module imports in client app scripts.
- Do not hard-code a tenant in `routes/plm.js` — use `getTenantLink(req)`.
- Grep callers before editing a shared helper (`routes/plm.js` top-of-file functions,
  `framework/utils.js`, `contents/*.js`) — these are used by many apps at once.
- Never commit secrets (client secrets, API keys, refresh tokens) — they belong in
  `environment.js` (gitignored) or env vars.
- Browser automation for tenant-changing actions (webhook registration, workflow transitions,
  data creation) needs the tenant, the exact action, and expected effect named explicitly before
  acting — prefer read/compare first, write second.
