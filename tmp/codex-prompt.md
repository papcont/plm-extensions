You are an independent code/UX reviewer. READ ONLY. Do not modify, create or delete any file. Do NOT open or print environment.js, environments/*, tools/fm-mcp/tenants.json, .env*, keys/ or storage/ (they contain secrets/tenant data). Do not run the server or any network call.

Repo: current working directory (Node/Express PLM_DEV app). Relevant files:
- views/apps/intelligent-sourcing.pug, public/javascripts/apps/intelligent-sourcing.js, public/stylesheets/apps/intelligent-sourcing.css
- routes/sourcing.js, services/sourcing/{engine,ai,service,dataSource,fmDataSource,rfq}.js, services/ai/structured.js
- views/apps/condition-monitoring.pug, public/javascripts/apps/condition-monitoring.js, routes/iot.js, services/iot/*
- docs/features/intelligent-sourcing/DESIGN-STATUS.md, test/sourcing/*, test/iot/*
Use `git status` / `git diff` to see the working tree (uncommitted work on branch feature/iot-predictive-ai-phase1).

CONTEXT (conference acceptance findings, 2026-10-07):
Conference talk 08.10.2026 "Engineering Intelligence". The slides show a "Sourcing Assistant": slide 17 "Warum empfiehlst du Option B?" with a visible list "FRAGEN AN DEN ASSISTANT": Gibt es ähnliche Teile? / Welche Lieferanten haben vergleichbare Teile gefertigt? / Welche Revision? / Ist die Alternative technisch zulässig? / Warum ist sie schneller? / Wo wurde dieses Teil bereits verwendet? / Warum empfiehlst du Option B?. The answer pattern on slide 42: Empfehlung -> supporting evidence bullets -> QUELLEN (Vault, ERP, Fusion Manage) -> "Offen: ..." with REVIEW. Slides 16/33 define the four options as: A Standardprofil, B ähnliches Teil, C anderer Lieferant, D Biegeteil statt Frästeil.
Real UI today: ONE fixed button "Warum diese Empfehlung?" (POST /sourcing/ai/explain) producing a long (~40 lines) text block that exposes internal ids like DEMO-SRC-SUP-001. No question list, no input. The real UI options are A new bent part, B existing similar item, C standard U-profile, D alternative supplier/route; the engine recommends Blechbieger Meier (technical PASS, partly based on a labelled local Prototype/Local capacityPerMonth=400 overlay in HYBRID mode only). Data that does NOT exist: where-used, revision from FM/Vault, inventory/stock, Vault similarity. Pure FM mode: 0 PASS / 3 REVIEW / 9 FAIL, no recommendation. Slide 42 recommends "Option B ... REVIEW"; the real system recommends the Meier route (our option A). We must not invent where-used/revision/inventory/supplier evidence.
AI loading: sourcing AI ~21 s, IoT AI 11-13 s; loading UI is only the plain text "Generating…".
IoT: asset 30057 sensor currently stale (95 min); environment ttnMqtt.enabled=false in the (unread) environment file, so uplinks only arrive if something POSTs /iot/uplink. Maintenance Case preview returned UNKNOWN_EVENT until the server was started with IOT_EVENT_PERSISTENCE=true (config default false in services/iot/config.js).
Data: FM supplier items 34016 "Stahlhandel M?ller GmbH" and 34013 "Las ertechnik Nord GmbH" have corrupted names stored in the tenant; similarity purchase-history rows dated 2026-12-15 (after today 2026-10-07).
Hard constraints (must remain): no FM writes, no schema changes, no sourcing-engine semantic/scoring changes, no IoT anomaly/baseline changes, AI never overrides deterministic technical status, no secrets exposed, real app port is 8080 (do not make test ports defaults), RFQ preview-only.

TASKS - review the actual code and answer:
1. ASSISTANT/PRESENTATION MATCH: smallest implementation that makes the real UI recognizable as the slide assistant. Prefer bounded question buttons (fixed question ids, no free-text) over a free-form chatbot. Say exactly which files/functions to touch, whether a new bounded endpoint is needed or the existing /sourcing/ai/explain + a question field is enough, and how unavailable data (where-used, revision, stock) must be answered honestly.
2. OPTION A/B/C/D consistency: smallest coherent fix between slides and UI; do not invent evidence.
3. SOURCING AI UX: concise stage-ready answer, no DEMO-SRC-* ids in visible prose, structure recommendation / evidence / sources / missing evidence. Smallest change (prompt, schema in services/sourcing/ai.js, UI render, or client-side id->name replacement?). Mind the guard that rejects recommending a FAIL supplier and the schema validator in services/ai/structured.js.
4. AI LOADING STATE: is plain "Generating…" enough for stage? Minimal UI improvement only.
5. IOT DEMO READINESS: stale sensor + ttnMqtt false: configuration/demo-ops or code issue? Do not change anomaly logic.
6. MAINTENANCE CASE: verify by reading the code that IOT_EVENT_PERSISTENCE=true is really required for the case preview flow, and where startup docs/config should state it.
7. DATA QUALITY: impact of the two corrupted names and the future dates; confirm nothing in the UI should patch around bad tenant data.
8. REGRESSION/SAFETY: scan the working tree diff for FM writes, schema changes, engine/anomaly semantic changes, secret exposure, hard-coded test ports (3901/3902/4799), XSS (unescaped server/model text in the two apps' JS), or other defects in the new sourcing/CM UI code.

Return ONLY these sections, concise, with file:line references where relevant:
VERDICT
HIGH_PRIORITY_FINDINGS
MEDIUM_PRIORITY_FINDINGS
ASSISTANT_RECOMMENDATION
OPTION_ORDER_RECOMMENDATION
AI_UX_RECOMMENDATION
IOT_DEMO_RECOMMENDATION
CONFIG_FINDINGS
DATA_QUALITY_FINDINGS
SAFE_TO_IMPLEMENT_NOW (YES / NO)
