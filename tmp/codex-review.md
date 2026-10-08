VERDICT

Not stage-ready as-is. The deterministic sourcing core is mostly safe, but the UI does not yet look like the slide “assistant”, option A/B/C/D semantics conflict with the slides, and the AI guard has one real override hole. I could not use `git diff` because safe-directory/policy handling was blocked; this review is from direct read-only inspection of the checked-out files.

HIGH_PRIORITY_FINDINGS

- `services/sourcing/ai.js:80-87`: `guardInsight()` claims it blocks FAIL “or unknown”, but it only blocks unknown supplier IDs and `TECH.FAIL`. A model could recommend a known `UNKNOWN` / REVIEW supplier. Fix to allow only `analysis.recommendedSupplierId` or `none`.
- `public/javascripts/apps/intelligent-sourcing.js:280-293`: one fixed “Warum diese Empfehlung?” button does not match the slide assistant question list.
- `public/javascripts/apps/intelligent-sourcing.js:150-162`: current option order is A new bent part, B similar item, C standard U-profile, D alternative supplier/route; slides define A Standardprofil, B ähnliches Teil, C anderer Lieferant, D Biegeteil statt Frästeil.
- `public/javascripts/apps/intelligent-sourcing.js:290-291`: AI output can expose supplier IDs, and the footer explicitly prints `recommendedSupplierId`. This is why `DEMO-SRC-*` can leak into visible prose.

MEDIUM_PRIORITY_FINDINGS

- `routes/sourcing.js:90-100`: existing `/sourcing/ai/explain` accepts only `{ itemId, quantity?, requiredDate? }`; adding a bounded `questionId` here is enough. No new endpoint needed.
- `services/sourcing/ai.js:33-40`: schema encourages broad prose (`summary`, `rankingRationale`, multiple long lists). It should be narrowed for stage output.
- `public/javascripts/apps/intelligent-sourcing.js:286` and `public/javascripts/apps/condition-monitoring.js:560`: plain `Generating…` is weak for 11-21s waits.
- `services/iot/config.js:41`, `services/iot/eventRepository.js:42-45`, `services/iot/maintenanceCaseFlow.js:17-20`: maintenance-case preview depends on the event repository. Without persistence, events survive only in the current process.

ASSISTANT_RECOMMENDATION

Touch only:
- `views/apps/intelligent-sourcing.pug:97-99`: add a compact “FRAGEN AN DEN ASSISTANT” question area.
- `public/javascripts/apps/intelligent-sourcing.js:280-293`: render fixed question buttons and call AI with `questionId`.
- `routes/sourcing.js:90-100`: allow and validate `questionId` on the existing `/sourcing/ai/explain`.
- `services/sourcing/ai.js:29-41,48-77,81-87`: add bounded question handling, stage schema, and stricter guard.

Use fixed IDs, no free text. Where-used, Vault revision/similarity, and stock/inventory must answer “not available in the current evidence”; do not imply Vault/ERP/FM evidence that is not in context.

OPTION_ORDER_RECOMMENDATION

Smallest honest fix: align the UI labels/order in `renderAlternatives()` (`public/javascripts/apps/intelligent-sourcing.js:150-162`) to the slide taxonomy, but keep the real statuses/evidence. The current engine recommendation maps to “D Biegeteil statt Frästeil”, not slide “B”. Do not make the app say “Option B recommended” unless the slides are changed to match the real engine result.

AI_UX_RECOMMENDATION

Use a stage schema like: `recommendation`, `evidenceBullets`, `sources`, `openItems`, `recommendedSupplierId`, `confidence`. Render it as Empfehlung / Belege / QUELLEN / Offen. Add `displayName` to AI context and prompt “never use internal IDs in visible prose”; also replace known supplier IDs client-side before rendering. Keep `services/ai/structured.js` unchanged; its validator already supports schema-table changes (`services/ai/structured.js:45-67`).

AI_LOADING_STATE

Plain `Generating…` is not enough. Minimal change: disable the question buttons and show “Assistant prüft deterministische Analyse, Quellen und offene Punkte… ca. 20s” for sourcing; equivalent “AI Insight wird erzeugt… ca. 15s” for IoT. No progress simulation needed.

IOT_DEMO_RECOMMENDATION

Stale sensor + `ttnMqtt.enabled=false` is demo configuration/ops, not anomaly logic. Live mode does not call `/iot/tick` (`public/javascripts/apps/condition-monitoring.js:85-91`); it waits for `/iot/uplink` or TTN MQTT. MQTT is explicitly gated off by default (`services/iot/config.js:78-82`) and starts only if enabled after deployment config (`app.js:110-114`).

CONFIG_FINDINGS

`IOT_EVENT_PERSISTENCE=true` is required for restart-safe case preview. Within one process, preview can use in-memory events; after restart it needs durable reload (`services/iot/eventRepository.js:42-45,67-69,121-124`). Document this in `docs/features/iot-condition-monitoring/STATUS.md` near the maintenance-case/current demo section and in `fusion-manage-mapping.md` startup config block, alongside `ttnMqtt.enabled`, `deviceAssetMap`, and `serverTickMs:0`.

DATA_QUALITY_FINDINGS

Do not patch bad tenant data in the UI. `fmDataSource` passes supplier names and purchase dates through from FM (`services/sourcing/fmDataSource.js:54,58`), and the UI escapes/displays them (`public/javascripts/apps/intelligent-sourcing.js:302-307`). Corrupted names and future rows dated `2026-12-15` should be fixed in tenant/demo data or disclosed; UI-side rewriting would hide evidence quality problems.

SAFE_TO_IMPLEMENT_NOW

YES, if the first change is the AI guard fix in `services/sourcing/ai.js:81-87`. The rest is scoped UI/API/prompt work and does not require FM writes, schema changes, sourcing-engine scoring changes, or IoT anomaly changes.