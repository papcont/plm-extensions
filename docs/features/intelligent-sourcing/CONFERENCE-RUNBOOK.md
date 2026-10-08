# Conference runbook (Sourcing + Condition Monitoring)

Real app port is **8080** (`redirectUri` in `environment.js`). Temporary test ports are never defaults.

## Start (PowerShell, no secrets on the command line)

```powershell
$env:PORT='8080'
$env:SOURCING_DATA_SOURCE='hybrid'          # fm = pure Fusion Manage (0 PASS / 3 REVIEW / 9 FAIL, no recommendation)
$env:SOURCING_AI_ENABLED='true'
$env:IOT_AI_ENABLED='true'
$env:IOT_EVENT_PERSISTENCE='true'           # REQUIRED: durable Condition Events; without it the Maintenance Case preview
                                            # answers UNKNOWN_EVENT after every restart (services/iot/config.js default: false)
$env:FUSION_MANAGE_IOT_WRITES='false'       # safety gates stay OFF
$env:FUSION_MANAGE_CASE_WRITES='false'
$env:SOURCING_RFQ_WRITES='false'
$env:IOT_REBASELINE_ENABLED='false'
npm start
```
`ANTHROPIC_API_KEY`, TTN and FM credentials come from the existing environment / `environment.js`; do not paste them anywhere.

## Before the session
1. Start with the environment above, open both pages:
   `http://127.0.0.1:8080/intelligent-sourcing` and `http://127.0.0.1:8080/condition-monitoring?wsId=904&dmsId=30057`.
2. Sourcing opens and analyses U-HALTER-800 automatically (first load ~7 s, then ~50 ms).
3. Run each assistant question you plan to show once (cached answers return instantly; live ~20 s).
   Also run **Explain asset state** and **Technician briefing** once (live 11–13 s).
4. Check telemetry freshness on the Condition Monitoring page ("last update"). A stale sensor shows
   `stale · N min old` and anomaly `N/A` on purpose.
5. Leave both pages scrolled to the top.

## Known demo-ops facts
- Live sensor data only arrives if something feeds the server: `exports.iot.ttnMqtt.enabled` in `environment.js` is `false`
  by default, so uplinks must be POSTed to `/iot/uplink` (or enable TTN MQTT deliberately and restart).
- Bad tenant data is shown as-is (never patched in the UI): supplier items 34016 ("Stahlhandel M?ller GmbH") and
  34013 ("Las ertechnik Nord GmbH"); similarity purchase rows dated 2026-12-15 (after today). Fix them in the tenant.
- Revision C is conference configuration (`settings.js` → `intelligentSourcing.primaryRevision`), not a Fusion Manage revision.
- `capacityPerMonth = 400` for Blechbieger Meier is a labelled Prototype / Local overlay (HYBRID only).
- The assistant answers a fixed question list. "Welche Revision?" and "Wo wurde dieses Teil bereits verwendet?" get a fixed
  honest "not available" answer: no Vault / ERP / where-used connection exists.
