# Implementation Plan — IoT / Condition Monitoring

All new code is **additive and isolated** under `services/iot/` (backend domain), `routes/iot.js`
(HTTP surface), `public/javascripts/apps/condition-monitoring.js` + `views/apps/condition-monitoring.pug`
(UI), and `test/iot/` (tests, run with `npm test` via node's built-in runner). Existing `app.js`,
`routes/*`, tenant logic and Fusion Manage functionality are not modified beyond a one-line route
mount (`app.use('/iot', ...)`) and additive `settings.js` app registration — the same pattern the
ERP app already follows.

## Layer map (this feature)

```
Simulator ─┐                       services/iot/simulator.js
TTS uplink ┤─> Device Adapter ──>  services/iot/netvoxR718E.js + tts.js + bfloat16.js
           │   Canonical Event      services/iot/canonical.js
           ▼
      IoT Bridge                    services/iot/bridge.js
        ├ DeviceRegistry            services/iot/deviceRegistry.js
        ├ Normalizer/dedupe         (bridge.js)
        ├ HealthCalculator          services/iot/health.js
        ├ ConditionEvaluator        services/iot/condition.js
        ├ TandemTelemetryRepo       services/iot/tandemRepository.js  (gated / in-mem stand-in)
        └ FusionManageConditionRepo services/iot/fusionManageRepository.js (gated, dry-run)
                    │
              routes/iot.js  ->  views/apps/condition-monitoring.pug + app JS (charts)
```

## Phases & acceptance

- **P1 Analysis** — DONE. Node v24 (built-in `node:test`), no build step, CommonJS services,
  additive-route pattern (see ERP). Netvox R718E payload verified from the official TTN
  Netvox codec (see `docs/features/iot-condition-monitoring/netvox-r718e-spec.md`).
- **P2 Simulator** — deterministic state machine: OFF, HEALTHY, WARMUP, DEGRADING, WARNING,
  CRITICAL, MAINTENANCE_RECOVERY. Seeded noise (reproducible). Time-scale to compress an hour into
  minutes. *Accept:* `readingAt(scenario, i)` is deterministic; states produce the documented trends.
- **P3 Netvox R718E adapter** — faithful decode of fPort-6 reports (0x01 accel+battery, 0x02
  velocity+temp) + inverse encode for fixtures/simulation. Golden fixtures incl. the official
  example vector. *Accept:* decoder reproduces official example values; truncated/unknown payloads
  error cleanly.
- **P4 TTS envelope** — parse/build a The Things Stack uplink carrying raw `frm_payload` or
  `decoded_payload`. Local replay from `test/iot/fixtures/*.json`. *Accept:* envelope -> canonical
  keeps the 4 layers (raw / envelope / decoded / canonical) distinct.
- **P5 Bridge** — validate, identify, device->asset map, normalize, dedupe, health, condition,
  event gen, call Tandem + FM repos. *Accept:* sim->bridge->mocked repos integration test green.
- **P6 Health/Condition** — transparent, configurable (relative baseline + thresholds + trend +
  multi-metric). Health 0-100; condition OFF/NORMAL/OBSERVE/WARNING/CRITICAL. No fake ML. *Accept:*
  unit tests pin the bands.
- **P7 Tandem** — isolated repo, gated by `TANDEM_ENABLED`. MVP stand-in: in-memory time-series
  store that also feeds UI charts. Real Tandem stream-ingestion wiring documented, config-driven,
  default off (no invented endpoints/secrets).
- **P8 Fusion Manage** — isolated repo, gated by `FUSION_MANAGE_IOT_WRITES` (default off). Records
  intended asset condition-summary + condition-event writes; v3 REST shape prepared. Required
  tenant workspace/fields documented (`fusion-manage-mapping.md`), not invented.
- **P9 UI** — one new landing app: status tile row + Health / Vibration / Temperature trend charts,
  time-range selector, Normal/Warning/Critical coloring, existing design system, no new UI lib
  (charts drawn on canvas). Detail view may add XYZ channels.
- **P10 E2E (no hardware)** — Healthy -> Degrading -> Warning -> Critical -> Recovery drives the
  bridge and is asserted end to end.
- **P11 Hardware-swap test** — a simulator reading encoded as Netvox bytes -> TTS -> decoder yields
  the **same canonical structure** as the simulator's direct canonical event (values within
  bfloat16/int16 quantization). Central acceptance criterion.

## Feature flags (env, `environment.js`-style)

`IOT_SOURCE=simulator|tts`, `TANDEM_ENABLED=true|false`, `FUSION_MANAGE_IOT_WRITES=true|false`,
`IOT_RESOLVE_FROM_FM=true|false` (+ `ADMIN_CLIENT_ID/SECRET`, `IOT_TENANT_LINK`, `IOT_SENSOR_WS_ID`,
`IOT_DEVICE_ID_FIELD`). Dev default: simulator source, Tandem stand-in, **no** live Fusion Manage
writes, **no** live FM resolution (static `IOT_DEVICE_ASSET_MAP`).

## Known blockers / open questions

- **Tandem live ingestion**: real `TANDEM_INGESTION_URL` / facility / stream mapping + credentials
  not available. Adapter is gated off; MVP uses the in-memory time-series store. No endpoint invented.
- **Fusion Manage asset/condition workspace**: target workspace + field IDs for the condition-summary +
  condition-event writes are not defined yet (Workspaces A/B in `fusion-manage-mapping.md`). Writes gated
  off; required structure documented for later creation.

## Post-MVP — done 2026-08-12 (beyond P1–P11, verified on tenant `contelosuxdemo`)

- **P12 Asset anchor (UI).** The Condition-Monitoring app binds to a Fusion Manage Asset when launched
  with `?wsId=904&dmsId=<asset>`: reads `/plm/details`, shows the asset descriptor, resolves
  `SENSORS_LIST` → the linked Sensors (968) record, and lists that sensor with its `IOT_DEVICE_ID`.
  No asset context → standalone simulator demo, unchanged. Additive; no new app, no backend change.
- **P13 Tenant modeling — device id field.** `IOT_DEVICE_ID` (Single Line Text, 32) created on Sensors
  (968) via the admin UI and persisted; demo value `70B3D57ED0056789` on record 30225. Model confirmed
  with the tenant owner: **one 968 record = one sensor** bound to its asset (not a BOM-row container).
  See `fusion-manage-mapping.md` → "Tenant reality".
- **P14 Data-driven DevEUI→asset resolution.** `deviceRegistry.ensure()` + injected resolver
  (`sensorDirectory.createFmResolver`) look the DevEUI up on Sensors (968) and route telemetry to that
  sensor's asset; static map is the fallback. Gated (`IOT_RESOLVE_FROM_FM` + 2-legged admin creds).
  Resolution logic unit-tested (`test/iot/deviceRegistry.test.js`); the live FM query still needs a run
  against real 2-legged creds. This is what reduces the hardware-day step 3 to "enter the DevEUI in PLM".

## Still open for a full real-hardware run
1. Deploy behind a public HTTPS URL so The Things Stack can POST to `/iot/uplink`.
2. `IOT_SOURCE=tts`; onboard the R718E in TTS; enable FM resolution (or fill the static map).
3. Optional/gated: live Tandem ingestion, live FM condition-writes (need the blockers above resolved).
</content>
