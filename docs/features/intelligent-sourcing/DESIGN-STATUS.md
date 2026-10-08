# Intelligent Sourcing — design + status (FM-backed read phase)

_Last updated: 2026-10-07 · `npm test` = 223/223 (FM adapter tests included)_

The UI now supports `SOURCING_DATA_SOURCE=demo|fm|hybrid`. `fm` and `hybrid` use the
read-only Fusion Manage adapter and `docs/features/intelligent-sourcing/FM-DEMO-MAPPING.json`;
the deterministic engine remains the authority. RFQ creation remains disabled and no FM schema
mutation is performed.

For a live local demo on PowerShell, restart with `$env:SOURCING_DATA_SOURCE='fm'; npm start`
(or `hybrid` for the explicit local history-family similarity provider). The default remains `demo`.

## 1. Platform architecture after this pass

Two domains share one AI core; everything else stays where it was until a second domain actually needs it.

```
services/
  ai/                      SHARED (new)
    structured.js          mode table -> JSON schema + strict validator (same source), bounded output,
                           context-hash cache, provenance { insight, cached, latencyMs }, lastInsight(mode, subject)
    providers/anthropic.js one request, exact model, maxRetries 0, no tools (moved from services/iot/ai/providers;
                           the old path is a 1-line alias so IoT callers/tests are untouched)
  iot/                     Predictive Maintenance (unchanged behaviour)
    ai/aiService.js        now a thin domain layer: IoT prompts + mode table on top of services/ai/structured.js
    fmAuth.js, fmTransport.js, fusionManageReadRepository.js, fusionManageCaseSearch.js
                           FM auth/transport/read/search — domain-neutral in shape, NOT moved yet (see §8)
    maintenanceCaseFlow.js, fusionManageCaseRepository.js, caseLinkStore.js
                           the proven preview -> confirm -> gate -> idempotency -> ONE write pattern
  sourcing/                Intelligent Sourcing (new, local-first)
    model.js               enums + shapes; TECH PASS/FAIL/UNKNOWN strictly separate from scoring
    engine.js              deterministic analysis (pure, reproducible for a given `now`)
    similarity.js          Similarity Search boundary (adapter + demo same-family provider)
    demoData.js            reproducible seed covering the 8 required scenarios
    rfq.js                 RFQ draft + controlled flow (preview/confirm/gate/idempotency; dry-run only today)
    ai.js                  explain_sourcing_analysis + procurement_briefing modes, bounded context, FAIL guard
    config.js              SOURCING_* env gates (demo on, AI off, RFQ writes off)
    service.js             composition root (data + similarity + engine + AI + RFQ)
routes/sourcing.js         /sourcing/{config,items,analysis,ai/explain,ai/briefing,rfq/preview,rfq/create}
routes/landing.js          GET /intelligent-sourcing  (page; no FM login needed, local demo data)
views/apps/intelligent-sourcing.pug + public/javascripts/apps/intelligent-sourcing.js (+ .css)
test/sourcing/*.test.js    engine / ai / rfq / route  (npm test now runs test/**/*.test.js)
```

### Discovery classification (Phase A)

| Component | Class | Decision |
|---|---|---|
| mode-table AI service (schema+validator from one table, cache, provenance) | A domain-neutral | **extracted** to `services/ai/structured.js` |
| Anthropic provider (`ANTHROPIC_API_KEY` only, no tools, no retry) | A domain-neutral | **moved** to `services/ai/providers/` (alias kept) |
| 2-legged bearer, transport, read repo, business-key search | C FM-specific, domain-neutral in shape | left in `services/iot/`; move to `services/fusion/` with the first sourcing FM writer |
| preview -> explicit confirm -> gate -> idempotency -> one write | A pattern | **replicated** in `rfq.js` (same error codes: CONFIRMATION_REQUIRED, WRITE_DISABLED, ALREADY_*) |
| durable link store (caseLinkStore) | A pattern | not yet needed (RFQ store is in-memory until a writer exists) |
| contextBuilder (telemetry allowlist), analytics, bridge, condition events | B IoT-specific | untouched |
| dashboard panels / `cm-*` CSS, `runAi`, preview rendering | D UI-specific | reused by linking the stylesheet; sourcing page follows the same shapes |
| `DEMO_ASSETS` allowlists, 907 pick-list option ids, URGENCY mapping | E unsafe to generalize | untouched |

## 2. Sourcing domain model (`model.js`, shapes in the header comment)

item requirements · supplier (APPROVED/CONDITIONAL/BLOCKED) · capability (processes, materials, toleranceClass,
maxDimensionMm, certifications, leadTimeDays, capacityPerMonth, priceBreaks) · purchase (qty, price, promised/
delivered, rejectedQty) · similarity row · candidate · analysis · RFQ draft.

## 3. Engine rules (`engine.js`)

**Technical (authoritative)** — one check per requirement the item has: supplierStatus (BLOCKED => FAIL), process,
material, toleranceClass (ordinal coarse<medium<fine<precision), maxDimensionMm, certifications, capacity vs quantity.
No capability data => UNKNOWN (never PASS, never FAIL). Any FAIL => `technicalStatus = FAIL`.

**Scores 0-100 (only meaningful for PASS/UNKNOWN; FAIL gets `overallScore = null`)**
- commercial = 100 × cheapest price among *technically not failed* candidates / own price. Price source: quote break
  for the quantity → own latest purchase → similar-item purchase (`priceSource` says which).
- delivery: lead time (capability → history average) vs days available; lead > available => 0 + `deliveryRisk: LATE`;
  ≤50 % of the window = 100, linear in between; blended 70/30 with the on-time rate when history exists.
- quality: defect rate over own purchases (10 % rejects = 0); newest two vs earlier => `qualityTrend WORSENING` (−20).
- history: 40 + 20 × own purchases + 15 × Σ similarityScore of similar-item purchases; none => `null`.
- overall = weighted average (commercial .35, delivery .30, quality .20, history .15) **over the scores that exist**;
  missing scores are excluded, never guessed. `dataCompleteness` = weight sum; `confidence` low/medium/high from it.

**Ranking**: PASS → UNKNOWN → FAIL; within a group overall desc, then data completeness, then price, then id.
`recommendedSupplierId` = first PASS with an overall score.

**Conflicts** (surfaced, never resolved): `CAPABILITY_HISTORY_CONFLICT` (capability FAIL but past purchases of the
item exist — FAIL stays authoritative), `PRICE_CONFLICT` (quote vs last purchase differ > 40 %).

## 4. Demo data scenarios (`demoData.js`, asserted in `test/sourcing/engine.test.js`)

ITM-1001 qty 100, required +60 d: **SUP-A** best (PASS, 3 clean POs) · **SUP-B/SUP-G** cheapest but FAIL · **SUP-C**
PASS, no history, wins when required in 18 d · **SUP-D** worsening rejects · **SUP-E** capability FAIL + 2 past POs
=> conflict · **SUP-F** no capability record => UNKNOWN · **ITM-1001-STD** standard-profile alternative.
ITM-2002: similar item ITM-2001 bought from SUP-C (similarity evidence); qty 50 => SUP-C, qty 500 => SUP-A.

## 5. AI boundary (`ai.js`)

- Claude sees only `buildSourcingContext(analysis)`: `verifiedFacts` / `calculatedResults` / `missingInformation` /
  `limitations`, ≤8 candidates, allowlisted fields (no price breaks, no capability objects, no credentials).
- Modes `explain_sourcing_analysis` and `procurement_briefing`; schema + validator from one table; bounded sizes.
- Prompt rules: technical FAIL is final; never invent capability/history/price/lead time/feasibility; null is
  "not available"; conflicts are for humans; mark interpretation separately.
- **Guard**: `recommendedSupplierId` must be the engine recommendation or `none`; a FAIL or unknown supplier =>
  `AI_OVERRIDE_BLOCKED` (HTTP 409). The analysis returned next to the insight is the unchanged engine result.
- AI off / no credential / provider failure => analysis still works (503 / 502 on the AI route only).

## 6. Controlled-write boundary (`rfq.js`, `routes/sourcing.js`)

`GET /sourcing/rfq/preview` (non-mutating, `dryRun: true`, blockers) → operator checkbox → `POST /sourcing/rfq/create`
with exact body + `confirm: 'CREATE_RFQ_DRAFT'` → gate `SOURCING_RFQ_WRITES` (default **off**) → writer (none exists)
→ idempotency key `sha256(item|qty|date|suppliers)`. Today every create ends in `503 WRITE_DISABLED` with **zero**
side effects. FAIL suppliers cannot be part of a draft (`409 SUPPLIER_TECHNICALLY_FAILED`).

## 7. Tests (`test/sourcing/`, 28 tests)

1 valid supplier ranks first · 2 cheap FAIL stays FAIL (no overall, ranked last, never recommended) · 3 no history =>
null scores + missing data, no high confidence · 4 conflict surfaced, FAIL authoritative · 5 urgent date flips
ranking, LATE flag · 6 quantity flips ranking via price breaks · 7 similar procurement adds evidence; no provider
still works · 8 AI recommending a FAIL supplier rejected, analysis unchanged · 9 AI unavailable/disabled/failing
does not break the engine · 10 write disabled => writer never called; plus confirm token, idempotency, failing writer
not retried, bounded context, prompt contract, route validation, determinism (byte-identical output).

## 8. Gaps and next milestones

1. **FM-backed readers** — implemented for the verified demo mapping; native FM capability/history schemas are
   still represented through existing Manufacturer P/N and Supplier Packages fields, with missing fields preserved.
   When that lands, move `fmAuth.js` / `fmTransport.js` / `fusionManageReadRepository.js` to `services/fusion/`.
2. **RFQ writer** — define the FM target (workspace/section/fields), then a `fusionManageRfqRepository` with the
   case-repository pattern (projection, wire body, dry-run first-class) and a durable JSON idempotency store.
3. **Similarity provider** — VaultVector/geometry adapter implementing `{ name, findSimilar(item) }`; the contract is
   fixed in `similarity.js`.
4. **Per-item-family capabilities** — demo keeps one record per supplier (+ a shaft quote set); real data is per
   supplier × family/commodity.
5. **ERP prices / supplier risk feeds / engineering feedback loop** — out of scope for the MVP.
6. **Live UI check** — the server is user-started; verify `/intelligent-sourcing` after restart.

## 9. FM READ-ONLY integration

**Scope**: Items, Suppliers, Supplier Capabilities, Purchase History as read-only sources for the same engine.
No live FM write, no tenant schema mutation (no field/workspace creation). Credentials never leave the server.

### 9.1 Existing code to reuse (all read paths, proven live)
| Code | What it gives | Reuse |
|---|---|---|
| `services/iot/fmAuth.js` `createBearer(config, http, scope)` | cached 2-legged token (`data:read`) | as-is |
| `services/iot/fusionManageReadRepository.js` `getItem(wsId, dmsId)` | item details via `/api/v3/workspaces/:ws/items/:id` with `X-user-id` impersonation | as-is + add `listItems`/`searchItems` |
| `services/iot/fusionManageCaseSearch.js` | verified v1 search payload (`fieldTypeID 0` for custom fields, comparator 15 = equals, non-empty `sort`, `fields` echo) | generalize the body builder into `searchItems(wsId, { filter, fields, pageSize })` |
| `routes/plm.js` `/search`, `/details`, `/items` | 3-legged (user session) equivalents | only if the page is ever put behind `launch()`; the sourcing page is session-less like Condition Monitoring |
| `routes/iot.js` `findField/fieldValue/stateValue` | section/field extraction from v3 item details | lift into the shared read repo as `fieldValue(details, fieldId)` |
| `tools/fm-mcp` (`fm_workspaces`, `fm_fields`, `fm_get`) | read-only tenant discovery with its own `tenants.json` | discover workspace/field ids of `contelosuxdemo` before coding mappings |
| `config.applyDeployment` pattern (`services/iot/config.js`) | admin creds + tenant link from `environment.js` | copy the 4 lines into `services/sourcing/config.js` |

### 9.2 What moves to `services/fusion/` (with 1-line aliases left at the IoT paths, exactly like the provider move)
```
services/fusion/auth.js            <- services/iot/fmAuth.js
services/fusion/transport.js       <- services/iot/fmTransport.js            (write-capable; sourcing does not use it yet)
services/fusion/readRepository.js  <- services/iot/fusionManageReadRepository.js + searchItems + fieldValue helpers
```
`fusionManageCaseSearch.js` stays IoT-specific (business key CONDITION_EVENT_ID) but is rewritten on top of
`readRepository.searchItems`. IoT tests (`fusionManageReadRepository.test.js`, `fusionManageCaseSearch.test.js`)
must stay green unchanged — the aliases guarantee the require paths.

### 9.3 Repository interface the sourcing service consumes
```js
// services/sourcing/dataSource.js — ONE async contract, two implementations
{
  name,                                   // 'demo' | 'fm'
  listItems()                 -> Item[]                      // id, title, family, requirements{}, standardProfileOf?
  getItem(itemId)             -> Item | null
  listSuppliers()             -> Supplier[]                  // id, name, country, status
  capabilitiesFor(item)       -> Capability[]                // one record per supplier (per family when FM has it)
  purchaseHistory({ itemId })  -> Purchase[]                  // date, quantity, unitPrice, currency, promised/delivered, rejectedQty
}
```
- `createStaticDataSource(demoData)` wraps today's arrays (behaviour identical to now; engine tests keep the fixed seed).
- `createFmDataSource({ readRepository, mapping, cache })` maps FM items via a per-tenant **mapping file**
  (`services/sourcing/fmMapping.js` defaults + overrides from `settings/<tenant>.js`), e.g.
  `{ items: { wsId: 57, fields: { title:'TITLE', family:'CLASS', process:'PROCESS', material:'MATERIAL', ... } },
     suppliers: { wsId: <discover>, fields: {...} }, capabilities: {...}, purchases: {...} }`.
  Field ids are tenant-defined (same rule as every app here); unmapped entity => that entity falls back to demo.
- `service.js` changes only its data access: `data.items` -> `await source.listItems()` etc.; engine untouched.

### 9.4 Coexistence of demo and FM data
- `SOURCING_DATA_SOURCE = demo | fm | hybrid` (default `demo`). `fm` requires the same four read settings as IoT
  (`adminClientId`, `adminClientSecret`, `tenantLink`, `impersonateUser`); if missing => startup log + demo.
- `hybrid` = per entity: FM where a workspace mapping exists, demo for the rest (expected first step: Items +
  Suppliers from FM, Capabilities + Purchase History still local, because those two do not exist as workspaces in
  `contelosuxdemo` today — creating them would be a schema mutation and needs your explicit go).
- Every analysis response carries `dataSources: { items:'fm', suppliers:'fm', capabilities:'demo', purchases:'demo' }`
  and the UI pill shows it, so nobody mistakes seed data for tenant data.
- Read-through cache with a short TTL (5 min) in the FM source, cleared by `POST /sourcing/cache/clear` (local only).

### 9.5 Safety
- GET + v1 search POST (a read query) only; no v3 POST/PATCH/PUT anywhere in `services/sourcing/`.
- A test asserts the FM data source's fake http client records zero non-GET calls except `/items/search`.
- No `tenants.json`, `environment.js` or env values are ever logged or returned by `/sourcing/config`.

### 9.6 Order of work
1. Read-only discovery of `contelosuxdemo` with `tools/fm-mcp` (workspaces named Suppliers / Vendors / AML / Purchase*).
2. Move auth/read repo to `services/fusion/` + aliases; IoT suite green.
3. `dataSource.js` contract + static adapter; sourcing suite green with no behaviour change.
4. FM adapter for Items + Suppliers behind `hybrid`; fake-http tests; one read-only live smoke you trigger.
5. Decide with you whether Capabilities / Purchase History come from an ERP export, a new FM workspace (schema change,
   needs approval) or stay local for the demo.

## 10. Conference UI (2026-10-07)

`/intelligent-sourcing` is a PLM_DEV-native story page for U-HALTER-800 (Bedarf → Empfehlung → Alternativen A–D →
Zulässigkeit → Ranking/Vergleich → Warum → Belege → RFQ **PREVIEW**). Every statement carries a neutral source chip
(Fusion Manage / Prototype / Local / Similarity Prototype / AI Interpretation). No RFQ create button; no FM writes.
HYBRID adds ONE explicit local evidence item (`PROTOTYPE_CAPACITY` in `dataSource.js`, keyed by stable supplier id
`DEMO-SRC-SUP-001`): capacityPerMonth for Blechbieger Meier, tagged `prototype-local`, so Meier becomes PASS and the UI
says the PASS partly rests on prototype evidence. FM mode is unchanged (0 PASS / 3 REVIEW / 9 FAIL). Engine/scoring untouched.
Known data issue: FM supplier names contain `?` (seed encoding), e.g. "Stahlhandel M?ller", "Las ertechnik".
Screenshots: `screenshots/`.

## Operate -> Source link (2026-10-08)

Condition Monitoring (asset context) lists the parts of the asset's `SERVICE_BOM` and deep-links known parts to
`/intelligent-sourcing?item=<id>&asset=<dmsId>&assetName=<text>` (`GET /iot/asset-parts`, read-only, same asset
allowlist as `/iot/asset`; match by part title). Sourcing preselects the item and shows a back link to the asset.

**Tenant writes made on `contelosuxdemo` (explicitly authorised by the user, 2026-10-08):**

| What | Where | Rollback |
|---|---|---|
| U-Halter 800 added as BOM line (qty 2) to the Service BOM of A000019 | WS 57, item 30119 (`10148246-SBOM`), bom-item `32668`; item = 57/34051 | `DELETE /api/v3/workspaces/57/items/30119/bom-items/32668` |
| `SPARE_WEAR` = true on U-Halter 800 | WS 57, item 34051 (was false) | PATCH the checkbox back to `"false"` |

The checkbox PATCH needs the string `"true"`/`"false"` (boolean `true` returns 400).
