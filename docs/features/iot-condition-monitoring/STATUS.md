# STATUS — IoT / Condition Monitoring

_Last updated: 2026-10-05_

## AI Phase 1 — Learned Condition Monitoring added (2026-10-05, `npm test` = 61/61, branch `feature/iot-predictive-ai-phase1`)
- New **`services/iot/analytics.js`**: per-asset learned baseline (rolling **median + MAD** + normal
  band), robust-Z **anomaly score 0..1**, primary driver, hysteresis, trend, update gate. Pure and
  hardware-independent (behind the canonical boundary → simulator + Dragino + future sensors share it).
- **`bridge.js`** folds it in additively: threshold health/condition unchanged; `effectiveHealth =
  min(threshold, anomaly)`, `finalCondition = worst(threshold, stabilized-anomaly)`; update gate stops
  a fault from being learned as normal; **history bootstrap** seeds the model on restart (normal points
  only); OFF machines are not flagged. **Unit fix**: condition reasons use mm/s (Netvox) vs g (Dragino).
- **UI extended in place**: AI-model + Anomaly + Trend tiles, learned-normal **band on the vibration
  chart**, and a **WHY panel** (facts only, no LLM). `/iot/state|tick|config` now carry analytics.
- **12 new tests** (`test/iot/analytics.test.js`) + full simulator arc verified headless
  (`LEARNING→READY→WARNING→CRITICAL→recovery`). No new FM fields created; FM stays business-state.
- Full design, config, algorithm, limitations & verification: **`AI-PHASE1.md`**.
- **Review fixes (PR #1, `npm test` = 66/66):** independent review found two restart defects, now fixed —
  (1) analytics hysteresis no longer restored from the combined stored condition (a threshold-driven
  WARNING/CRITICAL no longer holds a healthy-again asset for `recoverySamples` after restart); (2) history
  bootstrap now trusts **only explicitly `NORMAL`** points (unlabelled history excluded). +5 regression tests.
- **Not verified**: live browser UI (server is user-started) — restart required for
  `/condition-monitoring?wsId=904&dmsId=30057`.

---

_Earlier history below (last updated 2026-08-12):_

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

## Live asset condition writes implemented (2026-08-17, `npm test` = 30/30)
- User chose condition fields **directly on the Asset (904)** in a dedicated **"IoT" section** (id `2358`),
  not a separate workspace. 6 fields created + persisted via the admin UI: `IOT_CONDITION`,
  `IOT_HEALTH_SCORE`, `IOT_VIBRATION`, `IOT_TEMPERATURE`, `IOT_LAST_TELEMETRY`, `IOT_LAST_ALERT`.
- `fusionManageRepository.upsertConditionSummary` now does the real v3 PATCH (nested sections/fields shape,
  like `/plm/edit`; raw PATCH → "Abschnitt null"), **2-legged** with the deployment admin app, throttled to
  `writeMinIntervalMs` (default 30 s). Gated OFF by default; events stay dry-run.
- Optional gated server ticker (`config.serverTickMs`, default off) drives the pipeline unattended — this
  reverses the earlier "no server-side timers" note **on purpose**, hence gated.
- `config.applyDeployment(environment)` (called in `app.js`) folds admin creds + an `exports.iot` block from
  `environment.js` into the IoT config singleton (works despite config.js being required before environment.js).
- Target asset for the demo: **A000019 - Unterbau, dmsId `30057`** (has real motors; replaces the Cheops demo).
- Tested: 3 new gating tests in `test/iot/fusionManage.test.js` (dry-run when off; blocked when creds/section
  missing — never PATCHes an unconfigured target).
- **Live write VERIFIED end-to-end (2026-08-17):** the wired repository (`config.applyDeployment(environment)`
  → `createFusionManageRepository` → `upsertConditionSummary`) returned `written:true, mode:'live'` and the
  values (OBSERVE/72/4.9/58.4 + timestamps) read back on asset 30057.
- **Key finding — impersonation is mandatory.** 2-legged client-credentials writes are rejected
  ("no user in header"); the app must send `X-user-id` = the impersonated user's **email**
  (`philipp.poort@contelos.de`, not the PLM userId `Qb3Na`). Config `impersonateUser`, default
  `erpServiceAccountEmail`. See `fusion-manage-mapping.md`.
- Enable block is in `environment.js` (`exports.iot`, gitignored). **Server restart** picks up the ticker;
  then the asset updates every 30 s unattended.

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

## Dragino LHT65N-VIB over SenseCAP M2 → ChirpStack path added (2026-08-19, `npm test` = 37/37)
- **Decisive finding (from the user's setup video):** the SenseCAP M2 gateway routes third-party
  devices through its **internal ChirpStack**, NOT the `sensecap.seeed.cc` consumer portal (Seeed
  sensors only) and NOT The Things Stack. Onboarding in ChirpStack: Device Profile (region + JS codec =
  the official Dragino `LHT65N-VIB_v1.4.0_Chirpstack_Decoder`) → Application → Device (DevEUI/AppKey,
  OTAA) → physically activate the sensor (hold button >3 s, green LED blinks 5× → status "active") →
  ChirpStack decodes → an **HTTP integration** POSTs uplinks to our `/iot/uplink`.
- Because ChirpStack decodes with the pasted codec, we do **not** port the decoder. New code maps
  ChirpStack's decoded `object` → canonical:
  - `services/iot/chirpstack.js` — v4 event envelope parser (`deviceInfo.devEui` upper-cased, base64
    `data` → bytes, `object` passed through). Analogue of `tts.js`.
  - `services/iot/draginoLHT65VIB.js` — `objectToCanonical`: `TempC_SHT→temperature`, `Hum_SHT→humidity`,
    `vib_count→vibrationCount`, `BatV→battery`, `max_acc_{x,y,z}_g` (peak g) → `accelerationX/Y/Z` +
    `vibrationG` = 3-axis magnitude (the amplitude health scores). Vendor keys dropped.
  - `canonical.js` — `vibrationG`/`vibrationCount` added as core metrics, `humidity` as detail;
    `vibrationMagnitude` now prefers velocity, falls back to `vibrationG`, then accel magnitude.
  - `service.js ingestUplink` — auto-detects envelope: `deviceInfo` → ChirpStack/Dragino path;
    `uplink_message` → existing TTS/Netvox path. Same bridge downstream (unchanged).
  - `config.js` — deployment can override `thresholds` (Dragino MUST set **g-scale** vibration bands,
    e.g. `{ baseline:0.5, warn:2, critical:4 }`); `source` may be `chirpstack`.
- **Vibration reality:** the LHT65N-VIB gives peak-g amplitude + event counts, NOT ISO-10816 velocity
  mm/s or a spectrum. Good for trend/threshold ("running / vibrating more than normal"), not bearing
  spectral diagnostics. Velocity sensor (R718E) still the path for that.
- Tests: `test/iot/chirpstack.test.js` — envelope parse, both fPort mappings, vibrationMagnitude
  fallback, hardware-swap parity (ChirpStack uplink == direct canonical), bridge escalation on high g.
- **Still needs the user:** ChirpStack URL + login (gateway-local or Seeed-hosted), the physical pairing,
  the ChirpStack HTTP integration pointed at a public `/iot/uplink`, and DevEUI→asset mapping
  (`IOT_DEVICE_ID` on Sensors 968, or static `deviceAssetMap`). No hardware decode needed on our side.

## LIVE hardware wired via The Things Stack + MQTT (2026-08-19, `npm test` = 44/44)
- **The SenseCAP portal cannot onboard the third-party Dragino** (Seeed devices only, paid per-device
  service). Confirmed in-portal. So the M2 gateway was repointed off the SenseCAP cloud onto **The Things
  Stack (Community, eu1)** — a hosted, vendor-neutral LNS. Decisive over the gateway's internal ChirpStack
  (single point of failure) for "cloud + future-proof + any sensor".
- **Gateway**: reached via the SenseCAP portal's **Tunnel Connection** → the M2's OpenWrt LuCI (`…luci.sensecap-fleet.seeed.cc`).
  LoRa → LoRa Network → Mode **`Packet Forwarder`** → `eu1.cloud.thethings.network:1700` (UDP). Registered in
  TTN as gateway `contelos-sensecap-m2` (EUI `2CF7F1108010032E`, EU868). **Verified online in TTN** (uplinks
  forwarding, UDP).
- **Device**: TTN app `contelos-iot`, device `lht65n-vib-01` (manual, LoRaWAN 1.0.3 / RP001 1.0.3-A, OTAA).
  Keys from the box label: DevEUI `A8404198D65F3D36`, JoinEUI `A840410000000100`, AppKey on label.
  **Paired + joined + first uplink VERIFIED** in TTN Live data (fPort 2, `0CAE06…`, battery 3.246 V, VIBMOD=1).
- **No public URL needed** — chose **MQTT pull**: new `services/iot/ttnMqtt.js` connects OUT to TTN's broker
  (`eu1.cloud.thethings.network:8883`, user `contelos-iot@ttn`, app API key w/ uplink-read), subscribes
  `v3/+/devices/+/up`, feeds each message to `service.getShared().ingestUplink()` (same JSON as the webhook).
  Wired in `app.js` after `applyDeployment`; gated via `environment.iot.ttnMqtt.enabled`. Dependency `mqtt` added.
  **MQTT connect + subscribe VERIFIED live** with the real key (headless conn test).
- **No TTN payload formatter needed**: the backend now also decodes raw Dragino bytes itself
  (`dragino.decode` for fPort 2/9/10), so the pipeline works with or without a TTS formatter. Routing:
  decoded_payload(Dragino) → map; else raw bytes on a Dragino data port → decode → map; else Netvox.
- **environment.js** (gitignored) `exports.iot` updated: `deviceAssetMap {'lht65n-vib-01':'30057'}`,
  **`serverTickMs:0`** (simulator OFF so the real sensor owns asset 30057), g-scale vibration thresholds
  `{baseline:0.5,warn:2,critical:4}`, and the `ttnMqtt` block. **Server restart required** to start MQTT.
- **Open**: (1) restart the server → MQTT connects → next uplink (~20 min cadence) writes condition to
  asset 30057. (2) Sensor currently VIBMOD=1 (vib_count only, no amplitude) — send a downlink/AT
  `AT+VIBMOD` to enable **fPort-9 peak-acceleration (g)** reports for real vibration amplitude.

## After R718E + SenseCAP M2 are delivered (DoD #14 — the only remaining steps)
1. Onboard the R718E in The Things Stack; point the SenseCAP M2 at it.
2. Add a TTS webhook/integration that POSTs uplinks to `POST /iot/uplink` (raw `frm_payload`) — the
   endpoint and decoder already exist and are tested.
3. Set `IOT_SOURCE=tts` (stop simulator ticking) and map the real `deviceId` → asset in
   `IOT_DEVICE_ASSET_MAP`.
That's it: canonical model, bridge, health/condition, Tandem, Fusion Manage, and the UI are unchanged.
