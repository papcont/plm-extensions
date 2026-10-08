# Phase 2A — Maintenance Feedback Loop (design / analysis)

_Design only. Nothing implemented, no tenant fields created, no ML/RUL/LLM/fleet learning built._
_Follows Phase 1 (merged to main, merge commit `3ea7cd7a`). Physical anomaly test: PENDING_HARDWARE_ACCESS (not a blocker)._

## 1. CURRENT_STATE

What already exists (verified in code + `fusion-manage-mapping.md`, read-only):

- **Learned per-asset analytics** (`services/iot/analytics.js`): baseline (median/MAD/band), anomaly 0..1, primary driver, trend, hysteresis.
- **Condition Event** (`services/iot/bridge.js`): machine-generated on escalation/recovery —
  `{ eventId, assetId, deviceId, type (ESCALATION|RECOVERY), from, severity, timestamp, healthScore, anomalyScore, primaryDriver, reason, status:'OPEN' }`.
  **Gap:** persisted only in-memory (`state.events`, last 50) and **dry-run** in FM (`recordConditionEvent`) — not durable, not reviewable, lost on restart.
- **Condition summary** → written to **Asset (904) "IoT" section `2358`** (6 fields), 2-legged + impersonation, throttled. This is the current FM footprint.
- **Telemetry history** → in-memory ring + optional durable NDJSON (`tandemRepository`), the time-series layer. FM is deliberately NOT time-series.
- **UI** (`condition-monitoring`): status/AI-model/anomaly tiles, learned band, WHY panel, events list.
- **Confirmed tenant workspaces** (contelosuxdemo): Assets 904, Sensors 968, Motors 967, Control Elements 969, Serial Numbers 901, Items 57, **Service 1000**. (Generic template also names problemReports/nonConformances/changeOrders/equipmentServices — IDs NOT confirmed for this tenant.)

Missing for the feedback loop: a durable **Condition Event**, a human **Maintenance Finding / Action / Outcome**, and a derived **Learning Case**.

## 2. TARGET_ARCHITECTURE

```
 Telemetry (canonical)                [exists]
   → learned anomaly (analytics)      [exists]
   → Condition Event (machine fact)   [exists in-mem → make DURABLE]   ── technical history layer
   → [human opens a case]
   → Maintenance Finding (human)      [new]  ─┐
   → Maintenance Action (human)       [new]   ├─ Fusion Manage: Maintenance Case (business state + workflow)
   → Outcome (telemetry-verified)     [new]  ─┘
   → Learning Case (confirmed-only)   [new]  ── curated knowledge store (fleet-reusable, later)
```

Separation of concerns (hard rule):
- **Machine observation** = "vibration deviates from this asset's learned baseline" (from the engine, never a diagnosis).
- **Human confirmation** = "loose coupling confirmed" (entered by a technician, never inferred from the anomaly score).
- The system must **never** synthesize `confirmedCause` from `anomalyScore`. Anomaly ≠ diagnosis.

## 3. DATA_MODEL

### A. Condition Event (machine-generated; enrich the existing object, keep it in the technical layer)
```
eventId            uuid
assetId            '30057'
deviceId           'lht65n-vib-01'
detectedAt         ISO
fromCondition      NORMAL|OBSERVE|WARNING|CRITICAL
toCondition        OBSERVE|WARNING|CRITICAL|NORMAL
type               ESCALATION|RECOVERY
anomalyScore       0..1
healthScore        0..100
primaryDriver      vibration|temperature
reason             text (threshold- or baseline-derived; already produced)
vibration          g (snapshot at detection)         [ADD]
temperature        °C (snapshot)                      [ADD]
baselineRef        { median, mad, lower, upper, n }   [ADD]  snapshot of the learned band at detection
telemetryWindowRef { fromTs, toTs }                   [ADD]  points into the history layer, not copied
status             OPEN|LINKED|CLOSED                 (LINKED once a case references it)
```

### B. Maintenance Finding (human assessment — FM)
```
findingId          id
conditionEventId   ref → Condition Event (eventId)
assetId            ref → Asset (904)
assessment         CONFIRMED_ISSUE | FALSE_POSITIVE | OPERATING_STATE_CHANGE | UNKNOWN
confirmedCause     text/picklist (ONLY human-entered; blank unless CONFIRMED_ISSUE)
affectedComponent  ref → Motor/Sensor/Control Element (967/968/969) or text
inspectionNotes    text
severityHuman      LOW|MEDIUM|HIGH
inspectedBy        user
inspectedAt        datetime
```

### C. Maintenance Action (human — FM, child of Finding)
```
actionType         TIGHTEN_MOUNTING | REPLACE_BEARING | REALIGN_COUPLING | RECALIBRATE | NO_ACTION_REQUIRED | OTHER
description        text
performedBy        user
performedAt        datetime
```

### D. Outcome (telemetry-verified — part-machine, part-human)
```
resolved           bool (human)
telemetryImproved  bool (computed: anomalyAfter < anomalyBefore within window)
conditionAfter     NORMAL|OBSERVE|WARNING|CRITICAL
anomalyBefore      0..1 (from the event)
anomalyAfter       0..1 (median over the post-action observation window, from history)
observationWindow  { fromTs, toTs }
closedAt           datetime
```

### E. Learning Case (derived; confirmed cases only)
```
learningCaseId     id
assetType          e.g. 'Motor/Unterbau' (from asset class, not the instance)
sourceAsset        '30057'
signalPattern      { driver:'vibration', deviation:'baseline +N MAD', trend, persistence }
confirmedCause     from Finding (human-confirmed)
action             from Action
outcome            { telemetryImproved, anomalyBefore, anomalyAfter }
confidence         LOW|MEDIUM|HIGH (rule-based: confirmed + telemetryImproved ⇒ higher)
reusableForFleet   bool (gate; default false until reviewed)
```

## 4. FUSION_MANAGE_WORKSPACE_RECOMMENDATION

**Option A — Assets → Condition Events → Maintenance Findings** (every machine event becomes an FM item).
- Traceability: high. UX: noisy (every transient/false-positive escalation is an FM item). Scale: FM fills with machine events (anti-pattern — FM is not time-series). Fleet-fit: ok. Demo: cluttered.

**Option B — Assets → Maintenance Cases** (one case per *investigated* event; events stay technical history).
- Traceability: high (case references the eventId + snapshot). UX: clean (FM holds only human-relevant cases). Scale: excellent (FM holds confirmed/curated work only). Fleet-fit: best (learning cases derive from closed cases). Demo: crisp.

**RECOMMENDATION: Option B (hybrid).**
- Condition Events → **durable technical history** (NDJSON/ring + `/iot/events`), referenced by id. Not an FM item by default.
- **Maintenance Case** → **one Fusion Manage workspace**, created only when a human opens a case on an OPEN event (optionally auto-created on WARNING+ escalation, configurable). Carries Finding + Action + Outcome + workflow.
  - **Reuse the existing Service workspace (1000)** if its layout fits (it already links to Assets as "Asset Services"); otherwise a minimal new "Condition Case" workspace. **Confirm read-only before deciding — do not create fields yet.**
- **Learning Case** → lightweight curated store (JSON-backed `/iot/learning` service first; an FM workspace only if the business wants it governed). Derived from CLOSED+CONFIRMED cases.

Rationale: keeps FM as "confirmed business knowledge + workflow," keeps machine events in the time-series/technical layer, and makes fleet learning a promotion from *confirmed human cases* — exactly the narrative "the AI learns from confirmed maintenance cases, not raw data."

## 5. WORKFLOW (Maintenance Case state machine)

```
NEW ──▶ REVIEW_REQUIRED ──▶ INVESTIGATING ──▶ CONFIRMED ──▶ ACTION_TAKEN ──▶ MONITORING ──▶ CLOSED
                   │                 │
                   │                 ├──▶ FALSE_POSITIVE ─────────────────────────────────▶ CLOSED
                   │                 ├──▶ OPERATING_CHANGE ───────────────────────────────▶ CLOSED
                   └─────────────────┴──▶ NO_FAULT_FOUND ─────────────────────────────────▶ CLOSED
```
- NEW: case created from a Condition Event (auto or manual).
- REVIEW_REQUIRED: awaiting a technician.
- INVESTIGATING: technician inspecting.
- CONFIRMED / FALSE_POSITIVE / OPERATING_CHANGE / NO_FAULT_FOUND: the Finding's assessment.
- ACTION_TAKEN: a Maintenance Action recorded (CONFIRMED path).
- MONITORING: post-action telemetry window being observed for Outcome.
- CLOSED: Outcome recorded; eligible for Learning-Case promotion only if CONFIRMED + telemetryImproved.
Keep it this flat — no sub-states until a real need appears.

## 6. FIELD_LIST (proposed; NOT created — confirm/choose workspace first)

Maintenance Case (FM):
`CASE_NUMBER` (auto), `ASSET` (ref→904), `CONDITION_EVENT_ID` (text), `DETECTED_AT` (datetime),
`ANOMALY_AT_DETECTION` (float), `PRIMARY_DRIVER` (picklist), `CASE_STATUS` (workflow/picklist),
`ASSESSMENT` (picklist), `CONFIRMED_CAUSE` (text/picklist), `AFFECTED_COMPONENT` (ref/text),
`ACTION_TYPE` (picklist), `ACTION_DESCRIPTION` (text), `PERFORMED_BY` (user), `PERFORMED_AT` (datetime),
`TELEMETRY_IMPROVED` (bool), `ANOMALY_AFTER` (float), `CLOSED_AT` (datetime), `LEARNING_CASE_ID` (text, optional).

All IDs are **tenant-specific and must be created via `.claude/skills/fm-admin-fields`** (v3 REST returns 405 for field creation) only at step 2A-5, after the workspace choice is confirmed. Float fields need precision and must be sent as strings (see mapping doc gotchas).

## 7. RELATIONSHIPS

```
Asset (904) 1───* Condition Event (technical history)         [reference by assetId]
Asset (904) 1───* Maintenance Case (FM)                       [ref field ASSET]
Maintenance Case 1───1 Condition Event                        [CONDITION_EVENT_ID]
Maintenance Case *───1 Affected Component (Motor 967 / Sensor 968 / Control 969)  [optional ref]
Maintenance Case 1───0..1 Learning Case                       [LEARNING_CASE_ID, confirmed only]
Learning Case *───* Asset population (same assetType)         [for Similar Cases — later]
```

## 8. EVENT → FINDING → LEARNING CASE lifecycle

1. Engine escalates → **Condition Event** persisted (durable history), status OPEN.
2. (auto on WARNING+, or manual) → **Maintenance Case** NEW, links the event (status LINKED).
3. Technician investigates → records **Finding** (assessment + cause + component). → CONFIRMED / FALSE_POSITIVE / OPERATING_CHANGE / NO_FAULT_FOUND.
4. If CONFIRMED → records **Action** → ACTION_TAKEN → MONITORING.
5. System observes the post-action telemetry window → computes **Outcome** (anomalyAfter, telemetryImproved).
6. Case CLOSED.
7. If CONFIRMED + telemetryImproved → promote to a **Learning Case** (signalPattern + confirmedCause + action + outcome + confidence). `reusableForFleet` starts false (review-gated).
8. Learning Cases accumulate → later enable "similar confirmed case found" (fleet, Phase 2B+).

## 9. DEMO STORY

> **Asset A000019 - Unterbau** — the learned baseline flags *this* motor as behaving unusually
> (anomaly ↑, primaryDriver vibration), **even below the fixed 2 g threshold**. A **Condition Event**
> is raised. A technician opens the **Maintenance Case**, inspects, and confirms **"loose mounting"**
> (human confirmation — not an AI guess), records the action **"tightened mounting"**. After the fix,
> telemetry returns into the learned band, anomaly drops — the **Outcome** auto-verifies
> *telemetryImproved=true*, the case **CLOSES**, and it becomes a reusable **Learning Case**.

Takeaway for the audience: **"The AI doesn't just learn from raw data — it learns from *confirmed maintenance cases*."**

## 10. FLEET LEARNING — target picture only (NOT implemented)

```
Motor A (30057): unusual vibration → CONFIRMED loose mounting → tightened → recovered   ⇒ Learning Case
Motor B (same assetType): similar signalPattern appears
   → "Similar confirmed case found: loose mounting (Motor A). Suggested check: mounting bolts."
```
Strictly: suggest *comparable confirmed cases*, never "the bearing will fail in X days." Fleet learning is a lookup over **human-confirmed** Learning Cases, confidence rule-based, review-gated — no trained model, no RUL in this track.

## PHASE_2A_IMPLEMENTATION_PLAN (small steps, each independently acceptable)

- **2A-1 — Durable, enriched Condition Events (backend only).** Persist the event object in the technical
  layer (append to the existing NDJSON/history or a sibling `events` store); enrich with
  vibration/temperature snapshot + `baselineRef` + `telemetryWindowRef`. Add `GET /iot/events?assetId=`.
  _AC:_ events survive a restart; `/iot/events` returns them; `npm test` green + new unit tests; no FM change, no tenant mutation.
- **2A-2 — Confirm the FM home (read-only).** Inspect Service (1000) / candidate workspaces via `/plm` (read-only);
  decide reuse-vs-new; produce the confirmed field-ID gap list. _AC:_ a written decision + exact existing field IDs; **no fields created**.
- **2A-3 — Maintenance Case model + state machine (code/config, dry-run).** Implement the Case object + workflow
  transitions + a `/iot/cases` service (in-memory/JSON, dry-run) that opens a case from an event. _AC:_ open-from-event works; all transitions + guards unit-tested; false-positive/operating-change paths covered.
- **2A-4 — UI: open case + record finding.** Add an "Open maintenance case" action on a Condition Event and a
  case/finding panel (assessment, cause, component, action, notes) in the existing dashboard (no new app, no framework). Dry-run persistence. _AC:_ a technician can open a case and record a finding end-to-end in the browser; no console errors.
- **2A-5 — FM wiring (gated).** Create the confirmed workspace/fields via `fm-admin-fields`, map IDs into
  `settings/<tenant>.js` + a guarded writer; enable gated Case writes to FM. _AC:_ a case writes to FM and reads back; gated OFF by default; no secrets committed.
- **2A-6 — Outcome capture.** After ACTION_TAKEN, bind the post-action telemetry window, compute
  `anomalyBefore/After` + `telemetryImproved`, drive MONITORING→CLOSED. _AC:_ outcome auto-populates from real history; verified on a recovery arc (sim or live).
- **2A-7 — Learning Case promotion (store only, no inference).** On CLOSED+CONFIRMED+telemetryImproved, emit a
  Learning Case record to a curated store; list via `/iot/learning`. _AC:_ learning case generated + listable; `reusableForFleet` defaults false; **no fleet inference, no prediction**.

## RECOMMENDED_NEXT_IMPLEMENTATION_STEP

**2A-1 — Make Condition Events durable and enriched (backend only).** It is the foundation every later step
references, is purely additive to the existing bridge/history layer, needs **no tenant mutation and no new
FM fields**, is fully unit-testable, and immediately improves Phase 1 (events currently vanish on restart).
Everything else (case, finding, outcome, learning) builds on a durable, referenceable event.
