# STATUS — IoT / Condition Monitoring

_Last updated: 2026-08-12_

## Implemented & tested (automated, `npm test` = 23/23 green)
- **Canonical model** (`services/iot/canonical.js`) — versioned schema, validation, unknown-metric rejection.
- **bfloat16** (`bfloat16.js`) — decode/encode, verified against the official Netvox example words.
- **Netvox R718E adapter** (`netvoxR718E.js`) — faithful decode of fPort-6 reports (0x01 accel+battery,
  0x02 velocity+temp) + inverse encode; decodes the official example vector exactly; rejects
  malformed/unknown frames. Spec in `netvox-r718e-spec.md`.
- **TTS envelope** (`tts.js`) — build/parse a The Things Stack uplink; four layers kept distinct.
- **Simulator** (`simulator.js`) — deterministic state machine (OFF/HEALTHY/WARMUP/DEGRADING/WARNING/
  CRITICAL/MAINTENANCE_RECOVERY), seeded jitter, time-scale.
- **Health** (`health.js`) — configurable 0-100 weakest-link score + trend nudge.
- **Condition** (`condition.js`) — OFF/NORMAL/OBSERVE/WARNING/CRITICAL from threshold crossings + health.
- **Bridge** (`bridge.js`) — validate → identify → map → merge → dedupe → health → condition → events →
  Tandem + Fusion Manage; structured JSON logs, no secrets.
- **Tandem repo** (`tandemRepository.js`) — in-memory time-series stand-in feeding the UI; gated real
  stream POST (`TANDEM_ENABLED` + `TANDEM_INGESTION_URL`).
- **Fusion Manage repo** (`fusionManageRepository.js`) — dry-run summaries + events; gated live writes.
- **E2E arc** — Healthy→Warning→Critical→Recovery asserted through the runtime.
- **Hardware-swap parity** — a simulator reading and a raw Netvox uplink produce the *same canonical
  structure* (central acceptance criterion), asserted in `test/iot/bridge.test.js`.

## Implemented, smoke-verified headless (server not started — user restarts it)
- **HTTP surface** (`routes/iot.js`, mounted `/iot` in `app.js`): `/config /tick /state /history /reset
  /uplink`. Runtime ticks 155× through the full arc; `/uplink` (real-hardware TTS path) accepted.
- **Dashboard** (`views/apps/condition-monitoring.pug` + `public/javascripts/apps/condition-monitoring.js`
  + CSS) — Pug compiles; status tiles + Health/Vibration/Temperature native-canvas charts, time-range,
  condition coloring, events list. Registered as app `conditionMonitoring`, route `/condition-monitoring`,
  `servicesEnabled['condition-monitoring']=true`.

## Data-driven DevEUI→asset resolution done (2026-08-12, `npm test` = 27/27)
- The bridge no longer depends on the static `IOT_DEVICE_ASSET_MAP` for real devices. `deviceRegistry`
  gained an on-demand `ensure(deviceId)` that consults an **injected resolver**; `bridge.ingest` awaits it
  before resolving. Resolution order: static map > learned directory (cached) > identity. Resolver errors
  never break ingestion (fall back to identity). New `services/iot/sensorDirectory.js` `createFmResolver`
  looks the DevEUI up on Sensors (968) `IOT_DEVICE_ID` and returns that sensor's `ASSET` dmsId.
- **Gated** exactly like Tandem/FM-writes: off unless `IOT_RESOLVE_FROM_FM=true` + admin 2-legged creds
  (`ADMIN_CLIENT_ID/SECRET`) + `IOT_TENANT_LINK` are set (an inbound uplink has no user session → client
  credentials). Default off → static map, behavior unchanged, so the running demo is unaffected.
- Verified: 4 new tests in `test/iot/deviceRegistry.test.js` (resolution order, cache = one resolver call,
  identity fallback, error tolerance, and the bridge routing a real-device uplink to the resolved asset).
  The live FM query itself is not unit-tested (needs live 2-legged creds) — same stance as the FM write path.

## Tenant modeled — step 1 done (2026-08-12): `IOT_DEVICE_ID` field on Sensors (968)
- Created via the admin UI (headed Playwright, logged into `contelosuxdemo`): display "IOT Device ID",
  fieldId `IOT_DEVICE_ID`, Single Line Text, length 32, in the Header section. Dragged out of "unassigned"
  into Header, "Layout speichern", persisted (survives hard reload). Details in `fusion-manage-mapping.md`.
- **Model resolved (user-confirmed): one Sensors (968) record = one sensor**, bound to its asset via
  `ASSET` and carrying `IOT_DEVICE_ID` directly (not a container of BOM-row sensors). The asset-anchor
  extension was updated to read the referenced 968 record's own descriptor + `IOT_DEVICE_ID`.
- **Demo value set:** `IOT_DEVICE_ID = 70B3D57ED0056789` on record 30225 (A000022 - Cheops-Pyramide), via
  the localhost `/plm/edit` proxy (section 2227). End-to-end verified: `/condition-monitoring?wsId=904&dmsId=30223`
  shows "Sensors on this asset → A000022 - Cheops-Pyramide · 70B3D57ED0056789", 0 console errors.
  (Direct v3 PATCH with a hand-built body failed with "Abschnitt null" — use the `/plm/edit` proxy, which
  builds the correct sections payload, not a raw PATCH.)

## Asset-anchored (2026-08-12) — the live monitor now binds to a Fusion Manage Asset
- `condition-monitoring.js` gained an asset context: launched as `/condition-monitoring?wsId=904&dmsId=<asset>`
  it reads `/plm/details`, shows the Asset descriptor, resolves the `SENSORS_LIST` reference → the linked
  Sensors (WS 968) record, and lists that sensor with its `IOT_DEVICE_ID`. Without an asset context it is a
  no-op and the standalone simulator demo runs exactly as before. Additive to the existing app (new
  `#cm-asset` panel in the pug, `initAssetContext()` + `findField*` helpers in the app JS, a few CSS rules)
  — no new app, no backend change. The live stream stays the `/iot` simulator; the real sensor→telemetry
  binding (key on `IOT_DEVICE_ID`) is the remaining wiring once hardware arrives.
- Browser-verified (headed Playwright, running server): asset `904/30223` shows
  "A000022 - Cheops-Pyramide" + honest empty sensor state (tenant sensors not modeled yet); no-context
  standalone still shows `source: simulator` + the full arc; 0 console errors on either path.

## Browser-verified (2026-08-12, headed Playwright against the running server)
- `/condition-monitoring` loads post-APS-login (user `Philipp Poort @ contelosuxdemo`, `source: simulator`).
- Full condition arc confirmed via the live `/iot/tick` endpoint (220 ticks): NORMAL (health 100→63) →
  OBSERVE (i25) → WARNING (i29, vib 4.6→7) → CRITICAL (i51, vib 10.6→11.7) → WARNING (i75) → OBSERVE (i82)
  → NORMAL recovery (i83), then the cycle repeats. Thresholds (warn 4.5 / critical 7.1) fire exactly.
- UI live-mirrors it: 3 canvas charts paint (~4k px each), status tile ticks, events list populates
  (e.g. `NORMAL · RECOVERY · health 67`) — no longer "No events yet".
- Regression: `/abom` still loads (title + 5 tabs + 4 panels). Its one console error
  (`projectItems is not iterable`, abom.js:212) is PRE-EXISTING — fires when abom is opened without a
  selected asset (no wsId/dmsId); unrelated to this feature (diff is 17 additive lines, none in abom's path).

## Blocked (documented, not invented)
- **Live Tandem ingestion** — no facility/stream/credentials. Adapter gated off; in-memory store is the
  MVP time-series layer. Enable via `TANDEM_ENABLED=true` + `TANDEM_INGESTION_URL` when available.
- **Live Fusion Manage writes** — target workspace/field IDs undefined. Required structure in
  `fusion-manage-mapping.md`; enable via `FUSION_MANAGE_IOT_WRITES=true` after IDs are filled in.

## After R718E + SenseCAP M2 are delivered (DoD #14 — the only remaining steps)
1. Onboard the R718E in The Things Stack; point the SenseCAP M2 at it.
2. Add a TTS webhook/integration that POSTs uplinks to `POST /iot/uplink` (raw `frm_payload`) — the
   endpoint and decoder already exist and are tested.
3. Set `IOT_SOURCE=tts` (stop simulator ticking) and map the real `deviceId` → asset in
   `IOT_DEVICE_ASSET_MAP`.
That's it: canonical model, bridge, health/condition, Tandem, Fusion Manage, and the UI are unchanged.
