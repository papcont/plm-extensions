# AI Phase 1 — Learned Condition Monitoring

_Branch: `feature/iot-predictive-ai-phase1`. Added 2026-10-05._

## Goal (this phase only)

Extend the existing, working IoT pipeline with a **learned, explainable** analytics layer:

```
Live Telemetry → Learned Asset Baseline → Explainable Anomaly Detection
              → Stable Condition Evaluation → Fusion Manage Asset UI
```

The system learns **how this one physical asset normally behaves** and detects when it behaves
**significantly differently from its own learned normal** — _before_ an absolute threshold is crossed.

**Not** in this phase: failure-time prediction, Remaining Useful Life, bearing spectral diagnosis,
automatic root cause, fleet learning. Those are later phases (see STATUS.md "NEXT").

## What was added (all additive — existing pipeline untouched)

- **`services/iot/analytics.js`** — the engine. Pure, hardware-independent, sits *behind* the canonical
  boundary so the simulator, the Dragino LHT65N-VIB, and any future sensor share it:
  - `computeBaseline(learnSamples, cfg)` — per-asset **rolling median + MAD** + normal band for
    vibration & temperature; `modelState` = `LEARNING` until `minimumSamples`, then `READY`.
  - `robustZ` / `scoreFromZ` — robust deviation → **anomaly score 0..1** (monotone, documented,
    configurable: 0 at `zLow` MAD, 1 at `zHigh` MAD).
  - `evaluate(current, baseline, cfg)` → `{ score, primaryDriver, drivers{vibration,temperature} }`.
    Vibration is the primary signal; temperature is supplementary (down-weighted, `weights`).
  - `anomalyCondition`, `stabilize` (hysteresis), `trendFrom`, `shouldLearn` (update gate), `worst`,
    `anomalyHealth`.
- **`services/iot/bridge.js`** — `evaluateAnalytics()` folds the engine into each ingest:
  - **threshold `health`/`condition` stay exactly as before** (the proven absolute-band path).
  - `effectiveHealth = min(thresholdHealth, anomalyHealth)` — anomaly can only lower health.
  - `finalCondition = worst(thresholdCondition, stabilizedAnomalyCondition)` — anomaly can only escalate.
  - **Update gate:** readings are learned into the baseline only while genuinely NORMAL and quiet
    (`anomaly < learningThreshold`), so a developing fault never teaches itself as "normal".
  - **History bootstrap:** on cold start the learned window is seeded from persisted Tandem history,
    filtering out any stored non-NORMAL point — a restart does not relearn from sample 0.
  - **OFF guard:** a stopped machine (vibration ≈ 0, far below its running median) is not flagged
    anomalous — analytics is skipped while the threshold path reports OFF.
- **`services/iot/condition.js`** — reason strings now use the **device-correct unit**
  (`canonical.vibrationUnit`: mm/s for Netvox velocity, g for Dragino acceleration) instead of a
  hardcoded `mm/s`.
- **`services/iot/config.js`** — new `analytics` block, env- and `exports.iot.analytics`-overridable.
- **`routes/iot.js`** — `/iot/state` and `/iot/tick` now carry an `analytics` snapshot; `/iot/config`
  exposes the (non-secret) analytics thresholds the UI needs. **No new routes.**
- **UI** (`views/apps/condition-monitoring.pug` + `.js` + `.css`) — extended in place:
  - **AI model** tile (`LEARNING` + `samples n/min` → `READY`), **Anomaly** tile (score + primary
    driver), **Trend** tile; vibration unit label follows the device.
  - **Learned normal band** shaded on the vibration chart (median dashed) — "this is normal for *this*
    asset"; faint/grey while the model is still provisional.
  - **WHY panel** — plain-language explanation built **only** from the computed analytics facts
    (current vs learned median, MAD deviation, normal range, trend). No LLM.

## Algorithm notes / rationale

- **Robust statistics (median/MAD), not mean/σ:** telemetry is spiky and samples are few; MAD is not
  dragged by a single outlier. `MAD·1.4826` is the σ-equivalent for a normal distribution.
- **Anomaly ≠ Health:** anomaly is a statistical 0..1 deviation; health is the familiar 0–100 asset
  score. They are reported separately and combined conservatively (`min`).
- **Hysteresis:** a change (either direction) commits only after `escalationSamples`/`recoverySamples`
  consecutive agreeing readings — a single spike cannot escalate, a single quiet sample cannot recover.
- **Threshold escalation stays immediate** (unchanged, intuitive); only the *learned-anomaly*
  escalation is debounced. This preserves the proven behavior and the existing test suite verbatim.

## Config (`config.analytics`, all overridable)

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch (`IOT_ANALYTICS_ENABLED`) |
| `minimumSamples` | `20` | LEARNING → READY threshold (`IOT_ANALYTICS_MIN_SAMPLES`) |
| `historyWindow` | `200` | learned samples kept per asset (bounds memory + cost) |
| `bandFactor` | `3` | normal band = median ± bandFactor·σ |
| `zLow` / `zHigh` | `2` / `8` | robustZ → score ramp endpoints |
| `epsilonVibration` / `epsilonTemperature` | `0.01` / `0.5` | deviation-scale floor (near-zero MAD) |
| `learningThreshold` | `0.35` | after READY, keep learning only below this anomaly |
| `observe/warning/criticalThreshold` | `0.40/0.60/0.85` | anomaly → condition band |
| `escalationSamples` / `recoverySamples` | `3` / `3` | hysteresis persistence |
| `trendWindow` / `trendDelta` | `12` / `0.08` | STABLE/IMPROVING/DEGRADING |
| `weights` | `{vibration:1, temperature:0.6}` | temperature is supplementary |

## Verification

- `npm test` → **61/61 green** (49 pre-existing + 12 new in `test/iot/analytics.test.js`): baseline
  learning/ready/median/MAD/bounds/missing-metrics, anomaly gradient + primary driver +
  temperature-only, update gate / baseline protection, hysteresis (spike vs persistence vs recovery),
  trend, units (g vs mm/s), the learned-anomaly **below-threshold** escalation + recovery through the
  bridge, and history bootstrap to READY (with a stored CRITICAL point correctly *not* learned).
- **Full simulator arc through the real runtime** (headless): `LEARNING → READY@tick20 → WARNING →
  CRITICAL → NORMAL recovery`, graded (WARNING before CRITICAL), both recovery events fire, max
  anomaly 1.00. Simulator + live share the identical pipeline (same bridge path).
- Pug compiles; all changed JS passes `node --check`.

## Known limitations (honest)

- **No failure prediction, no RUL, no bearing spectral diagnosis, no fleet learning** — by design.
- The Dragino LHT65N-VIB gives peak-g amplitude + counts, **not** an ISO-10816 velocity spectrum, so
  the valid claim is "abnormal / deviates from learned baseline", not a bearing diagnosis.
- The learned baseline is single-operating-point: a **sustained genuine operating-point change**
  (e.g. the simulator's WARMUP temperature ramp 35→48 °C) is flagged as a deviation. This is correct
  "differs from learned normal" behavior for Phase 1 — distinguishing "new normal" from "fault"
  needs labels (future fleet/learning-case phase). Temperature's influence is tunable via
  `weights.temperature`.
- Live FM writes / live Tandem ingestion remain gated exactly as before; analytics works on the
  existing in-memory / durable history.

## Not verified here

- Live browser UI against a running server (server is user-started; not launched autonomously).
  Code + tests complete; **server restart required for live UI validation** at
  `/condition-monitoring?wsId=904&dmsId=30057`.
- Live FM field writes for anomaly (no new FM fields created — see below).

## Fusion Manage fields

**No new FM fields were created.** FM stays business-state, not time-series. `IOT_ANOMALY_SCORE` /
`IOT_AI_STATE` are *candidates* for a later step, to be created via the `fm-admin-fields` workflow
**only** once the business value is confirmed — not invented here.
