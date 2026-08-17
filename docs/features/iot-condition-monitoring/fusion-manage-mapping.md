# Fusion Manage mapping — what the tenant needs for live IoT writes

Fusion Manage is **not** a time-series store. It holds only the business-relevant condition state and
discrete condition events. Writes stay gated (`FUSION_MANAGE_IOT_WRITES=false`) until the structures
below exist in the target tenant and their **field IDs** are filled into `settings/<tenant>.js`
(`applications.conditionMonitoring.assetWorkspaceId` / `conditionEventsWsId`). Do not invent IDs —
they are tenant-specific (see AGENTS.md: field IDs are the #1 cause of "field is undefined" bugs).

Field creation is UI-only in Fusion Manage (the v3 REST API returns 405 for `POST .../fields`) — use
the `.claude/skills/fm-admin-fields` workflow, or reuse an existing Assets/Equipment workspace.

## Workspace A — Asset condition summary (one item per monitored asset)

Latest state, upserted on every reading (the repository writes here, not per raw sample):

| Purpose            | Suggested field ID     | Type            |
|--------------------|------------------------|-----------------|
| Asset number       | `ASSET_NUMBER`         | text (existing) |
| Health score       | `IOT_HEALTH_SCORE`     | number (0-100)  |
| Condition          | `IOT_CONDITION`        | picklist: OFF / NORMAL / OBSERVE / WARNING / CRITICAL |
| Vibration (mm/s)   | `IOT_VIBRATION`        | number          |
| Temperature (°C)   | `IOT_TEMPERATURE`      | number          |
| Last telemetry     | `IOT_LAST_TELEMETRY`   | datetime        |
| Last alert         | `IOT_LAST_ALERT`       | datetime        |
| Tandem reference   | `IOT_TANDEM_REF`       | text            |

## Workspace B — Condition events (one item per escalation/recovery)

| Purpose        | Suggested field ID   | Type      |
|----------------|----------------------|-----------|
| Asset          | `ASSET`              | reference/text |
| Event type     | `EVENT_TYPE`         | picklist: ESCALATION / RECOVERY |
| Severity       | `SEVERITY`           | picklist: OBSERVE / WARNING / CRITICAL |
| Timestamp      | `EVENT_TIMESTAMP`    | datetime  |
| Health score   | `HEALTH_SCORE`       | number    |
| Reason         | `REASON`             | text      |
| Status         | `STATUS`             | picklist: OPEN / ACKNOWLEDGED / CLOSED |

## Wiring once the workspaces exist

1. Create the workspaces/fields above (or map existing ones) and note the workspace IDs + field IDs.
2. Put the workspace IDs in `settings/<tenant>.js` under `applications.conditionMonitoring`.
3. Fill the field-ID map in `services/iot/fusionManageRepository.js` (the guarded write section).
4. Set `FUSION_MANAGE_IOT_WRITES=true`. The repository already produces the summary + event objects;
   only the v3 REST `POST/PATCH` body assembly (flat field map) needs the confirmed IDs.

Fusion Manage REST is v3 (`https://<tenant>.autodeskplm360.net/api/v3/...`), same base the rest of
this server proxies through `routes/plm.js`.

---

## Tenant reality — `contelosuxdemo` (explored 2026-08-12, read-only via `/plm/*`)

The demo tenant already ships the **Asset Lifecycle & Projects** template. Relevant workspace IDs:

| wsId | Workspace          | Role for the monitor                                   |
|------|--------------------|--------------------------------------------------------|
| 904  | **Assets**         | the *instance* anchor — one item = one delivered machine |
| 968  | **Sensors**        | per-asset sensor container (category "Instance Management") |
| 967  | Motors             | sibling of Sensors                                     |
| 969  | Control Elements   | sibling                                                |
| 901  | Serial Numbers     | sibling                                                |
| 57   | Items              | holds the Engineering/Manufacturing/Service BOMs        |
| 1000 | Service            | Asset Services                                          |

**How an Asset instance links its sensors.** Asset (904) Header carries single-reference "list" fields:
`SENSORS_LIST` → a Sensors (968) record, `MOTORS_LIST` → (968), `CONTROL_ELEMENTS_LIST` → (969),
`SERIAL_NUMBERS_LIST` → (901), `SERVICE_LIST` → (1000). Separately `ENGINEERING_BOM` /
`MANUFACTURING_BOM` / `SERVICE_BOM` point into Items (57); `ASSET_BOM` was null on the sample.
→ **This is the "Instance BOM editor" anchor the customer means — the Asset item + its `SENSORS_LIST`,
   NOT `/abom` (that edits the engineering/mfg BOM in ws 57).**

**Sensors workspace (968) fields (all 5):** `ASSET`, `ASSET_SN`, `ASSET_BOM`, `CUSTOMER`,
`CUSTOMER_PROJECT` — i.e. only "which asset do I belong to". Each 968 record has its own BOM capability
(`/items/<id>/bom`) intended to list the individual sensors as rows.

**Gaps (demo data is sparse):**
1. **No individual-sensor items and no BOM rows.** Sample: asset `30223` (A000022 - Cheops-Pyramide) →
   `SENSORS_LIST` = Sensors `30225`, whose BOM is empty. Only 2 Sensors records exist tenant-wide, both
   empty. A Sensors (968) record has one real field (`ASSET`, single-selection) + asset-derived display
   fields, so in this template **a 968 record models one sensor bound to one asset** (not a container of
   BOM rows). Populate `IOT_DEVICE_ID` on the 968 records to give the monitor real data.
2. **~~No hardware identifier field~~ — DONE (2026-08-12).** `IOT_DEVICE_ID` (display "IOT Device ID",
   Single Line Text, length 32) created on Sensors (968), Header section, via the admin UI
   (`.claude/skills/fm-admin-fields` flow — the new React Workspace Manager embeds the classic dojo/jQuery
   layout editor in an `iframe`; new fields land in "Nicht zugewiesene Felder" and must be dragged into a
   section, then "Layout speichern"). Persisted (survives hard reload). Note: the v3 metadata API lags the
   admin write by a few minutes (documented cache). This field feeds `IOT_DEVICE_ASSET_MAP` / the bridge's
   device→asset map.

**Anchor decision for the live-monitor extension (own app, per GOAL).** Launch it with an Asset context
(`wsId=904, dmsId=<asset>`), read `SENSORS_LIST` → the 968 container → its sensor rows, and map each
sensor (by its `DevEUI` field, once it exists) to a telemetry stream. The canonical model / bridge /
health / condition / UI from the MVP stay unchanged; only the device→asset resolution swaps from the
static map to "derived from the selected Asset's sensor list".
