# AGENTS.md

Guidance for AI coding agents working in this repository.

## What this is

A self-hosted Node.js/Express server that delivers ~30 web applications (and Vault/Inventor
add-ins) layered on top of Autodesk Fusion Manage (PLM) via the PLM and APS REST APIs. The server
is stateless with respect to PLM data — it proxies REST calls, but does not persist tenant data.
There is no build step and no linter configured. The only automated tests are the IoT unit
suite (`npm test` → `node --test test/iot/**`); the rest of the app is verified manually.

## Commands

- `npm install` — install dependencies.
- `npm start` — launch using `./environment.js` (the default connection settings).
- `npm start <name>` — launch using `./environments/<name>.js` instead. Used to run the same
  server against multiple Fusion Manage tenants (`npm start adsktenant` loads
  `environments/adsktenant.js`).
- HTTPS is auto-selected when `redirectUri` uses `https://` and `keys/privkey.pem` +
  `keys/fullchain.pem` exist; otherwise HTTP is used. Port comes from `redirectUri` or `PORT`.
- `npm test` — runs the IoT unit suite (`node --test test/iot/**/*.test.js`). This is the only
  automated coverage; everything else is verified manually by driving the real page in a browser
  and checking the console/network tab and the actual PLM/ERP data, not just `node --check`.

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
- `/iot` → `routes/iot.js` — IoT / Condition Monitoring (see below).
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

## Reuse existing building blocks before building new (check first)

**Before writing a new panel or app, search the framework catalog for a module that already does
it — do not reinvent a panel that exists.** Apps here are compositions of shared `insertXxx`
panels, not bespoke UI. Where the catalog lives:

- **`/docs`** (`routes/landing.js:29` → `views/framework/docs.pug`, assembled from
  `views/docs/*.pug`) — the Developer Guide: tutorials + one documented block per module.
- **`/gallery`** — live demo of every panel. **`/studio`** — click-to-configure a panel and copy
  its settings.
- **`public/javascripts/framework/registry.js`** — the source of truth all three read from: every
  `insertXxx` with its `description`, `usage`, inputs, default options and filters. **Read this
  first when picking a panel.**

Available panels (mount via a `config.panels.insertXxx` block + `insertXxx(params)`):

- *Navigation* (`contents/nav.js`): `insertMOW`, `insertRecentItems`, `insertBookmarks`,
  `insertWorkspaceViews`, `insertWorkspaceSearch`, `insertSearch` (cross-workspace),
  `insertResults` (fixed query, no search box).
- *Creation* (`contents/item.js`): `insertCreate`.
- *Item* (`contents/item.js`): `insertDetails`, `insertImages`, `insertAttachments`, `insertGrid`,
  `insertBOM`, `insertBOMPartsList`/`insertFlatBOM`, `insertRootParents`, `insertParents`,
  `insertBOMChanges`, `insertManagedItems`, `insertChangeProcesses`, `insertProject`,
  `insertRelationships`, `insertSourcing`, `insertWorkflowHistory`, `insertRevisions`,
  `insertChangeLog`, `insertItemSummary`.
- *Classification* (`contents/classification.js`): `insertClasses`, `insertClassContents`,
  `insertClassFilters`, `insertItemClassification`, `insertSimilarItems`.
- *Admin*: `insertUsers`. *Viewer* (`contents/viewer.js`, `/docs` → Viewer): events, selection,
  colors, visibility.

If nothing matches, extend the closest `insertXxx` via its `insertXxxDone`/`insertXxxDataDone`
hooks and compose from the `genPanel*` primitives in `utils.js` — don't hand-roll markup.

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

## IoT / Condition Monitoring subsystem (`/iot`)

Ingests LoRaWAN sensor uplinks, derives a health score + condition, and writes it back to the
Asset in Fusion Manage (plus a Tandem time-series stand-in feeding the dashboard). This is the one
part of the app with real automated tests (`npm test`, `test/iot/**`) — keep them green.

- **`routes/iot.js`** (mounted `/iot` in `app.js`): `/config /tick /state /history /reset /ticker`
  drive the simulator/runtime; **`POST /iot/uplink`** is the real-hardware entry point (accepts a
  TTN/TTS or ChirpStack/Dragino uplink envelope).
- **`services/iot/bridge.js`** — the pipeline: validate → identify device → map to canonical →
  merge → dedupe → health → condition → events → Tandem + Fusion Manage. Structured JSON logs,
  no secrets. Central acceptance criterion: a simulator reading and a raw hardware uplink must
  produce the *same* canonical structure (asserted in `test/iot/bridge.test.js`).
- **`canonical.js`** — versioned canonical metric schema (validation, unknown-metric rejection).
- **Device adapters**: `netvoxR718E.js` (velocity mm/s + temp, fPort 6), `draginoLHT65VIB.js`
  (peak-g amplitude + vib counts, fPort 2/9/10), `bfloat16.js` (Netvox word codec), `tts.js`
  (The Things Stack envelope), `chirpstack.js` (ChirpStack/Dragino envelope). `service.ingestUplink`
  auto-detects the envelope (`deviceInfo` → ChirpStack path, `uplink_message` → TTS path).
- **`health.js` / `condition.js`** — 0-100 weakest-link health score; OFF/NORMAL/OBSERVE/WARNING/
  CRITICAL condition from threshold crossings + health.
- **`simulator.js`** — deterministic state-machine sensor for demos; `serverTickMs:0` turns it off
  so a real sensor owns the asset.
- **`tandemRepository.js` / `fusionManageRepository.js`** — persistence targets; both default to
  dry-run and only do live writes when explicitly gated on (`TANDEM_ENABLED`, and admin 2-legged
  creds + tenant link for FM writes).
- **`deviceRegistry.js` + `sensorDirectory.js`** — DevEUI→asset resolution. Order: static
  `deviceAssetMap` > learned FM directory (Sensors WS 968 `IOT_DEVICE_ID` → `ASSET`) > identity.
  FM resolution is gated (`IOT_RESOLVE_FROM_FM=true` + admin creds + `IOT_TENANT_LINK`); default
  off → static map, resolver errors never break ingestion.
- **`ttnMqtt.js`** — pulls uplinks from The Things Stack's MQTT broker (no public URL needed),
  feeds each to `service.ingestUplink`. Started in `app.js`, gated on `environment.iot.ttnMqtt.enabled`.
  Adds the `mqtt` dependency.
- **`config.js`** — `applyDeployment(environment)` folds the per-deployment `exports.iot` block
  (`deviceAssetMap`, `serverTickMs`, g-scale vibration `thresholds`, `source`, `ttnMqtt`) into the
  runtime; called once at startup.
- **Dashboard**: app `conditionMonitoring`, route `/condition-monitoring`
  (`views/apps/condition-monitoring.pug` + `public/javascripts/apps/condition-monitoring.js`).
- Full status/history: `docs/features/iot-condition-monitoring/` (STATUS.md, GOAL.md, HANDOVER.md,
  device specs). **A server restart is required** for any IoT env/wiring change (MQTT, deployment).

## Recently added apps (beyond the README's ~30)

- **`/condition-monitoring`** (`conditionMonitoring`) — IoT dashboard, see the subsystem above.
- **`/variants-bom`** (`variantsBom`) — Variant BOM Editor: a `VARIANT_ALLOWED` flag marks
  variant-eligible items; swapping+saving a BOM node creates new variants bottom-up for every
  flagged ancestor, and a recursive NUMBER-based `BOM_FINGERPRINT` dedupes identical assemblies.
  Design + verification: `docs/VARIANTS-BOM-PLAN.md`, handover `docs/VARIANTS-BOM-HANDOVER.md`.
- **`/mebom`** (`mebom`, **`dev/` — work in progress**) — Mechatronic BOM Editor: evolution of the
  `instances` app; context is an Asset (WS 904), mechanical Engineering BOM + viewer on one side,
  per-instance lists (serials, motors, sensors, control elements) as alignment tabs. Tenant setup:
  `docs/MEBOM-TENANT-SETUP.md`.

## Verification pattern for this repo

Only the IoT subsystem has automated tests (`npm test`). For everything else, the established loop
for a live server you can't directly inspect:

1. Edit → `node --check <file>` for syntax (and `npm test` if you touched `services/iot/**`).
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

- **Reuse before building**: check `/docs` + `registry.js` for an existing `insertXxx` panel before
  writing a new one (see "Reuse existing building blocks").
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

## Git and customer extensions

This directory is a git repo (`git init` 2026-08-05) with `origin` = this project's fork
(`papcont/plm-extensions`) and `upstream` = the original project (`dickmans/plm-extensions`).
Commits happen locally as normal; **never push without the user explicitly confirming it first**
(same rule as any other action affecting a shared/remote system) - ask, show what would be pushed
and where, then push.

Developing a feature "for" a specific customer usually means just building it here like anything
else - one shared codebase, tenant differences live in `environments/<tenant>.js` +
`settings/<tenant>.js`. A separate customer-specific deliverable (ZIP or its own repo) is only
assembled when that customer needs a standalone deployment - see
`docs/CUSTOMER-EXTENSIONS-PLAN.md` for that model, `external/incoming/` for triaging material from
existing/scattered customer projects, and `customer-extensions/<slug>/manifest.md` for what's been
decided per customer. First customer set up this way: Conti Machinery (tenant `sbcmm`,
`environments/conti.js` + `settings/conti.js`, both gitignored).

`tools/fm-mcp/` is a small dependency-free MCP server (`fm_tenants`, `fm_get`, `fm_post`,
`fm_workspaces`, `fm_fields`, `fm_diff`, `fm_snapshot`) for reading and diffing Fusion Manage
tenant metadata across multiple tenants via 2-legged auth - useful for tenant-setup/discovery work
that doesn't need a browser. Real tenant credentials go in `tools/fm-mcp/tenants.json`
(gitignored); `tenants.example.json` is the tracked template. `.claude/skills/fm-admin-fields`
documents the actual browser workflow for creating workspace fields, since Fusion Manage's REST
API does not support that (`405` on `POST .../fields`).
