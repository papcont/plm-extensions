# Handover — Variant BOM Editor (`/variants-bom`) + IoT Pause-Button

**Für den nächsten Chat.** Stand: Phasen 1–8 gebaut & Playwright-verifiziert, dazu Node-Gate, Lazy-Stamping,
UI-Fixes, Row-Dimming, **sprechende Titel + Basis-Verweis** — alles committed (siehe `git log`, ~14 lokale Commits).

**⚠️ PUSH-REGEL (kritisch):** NIE zu `main` pushen — `main` ist Google-gehostet und **deployed sofort auf Produktion**.
Immer nur Feature-Branch: `git push origin main:<branch>`. Lokaler `main` und `origin/main` sind **disjunkt** (keine
gemeinsame History), ein Branch trägt die ganze lokale History. Nichts gepusht — nur auf ausdrückliche Ansage.

**Gotcha:** `settings.js` ist serverseitig (ins `config`-Global injiziert) → Änderungen an `applications.variantsBom`
brauchen **Server-Neustart**; JS/Pug/CSS sind statisch. Nach Neustart ist die APS-Session weg → neu „ERLAUBEN".
Session läuft ~1h → mitten im Multi-Level-Create bricht sie mit `sections is not iterable` ab (kein Bug); Teil-Items
per `IS_VARIANT=true`-Suche finden + `GET /plm/archive?wsId=57&dmsId=…` aufräumen.

**GERADE NACHGERÜSTET (Titel + Basis-Verweis, aus Vergleich mit Variants Manager WS 241):**
- Jede Variante bekommt **`TITLE = "<Basis-Name ohne Nr/Rev> - <Labels>"`** (z.B. „XL200 PART1 - Stahl", „XL200 - Stahl").
  **Verifiziert** (Blatt 00000758, Baugruppe 00000759, danach archiviert). `TITLE` ist hardcoded (FM-Systemfeld).
- **Basis-Verweis-Felder in WS 57 per FM-UI gerade angelegt:** `BASE_ITEM_NUMBER` + `DMS_ID_BASE_ITEM` (beide Einzeiliger
  Text, 200/200, „Layout gespeichert" bestätigt). Code (`vbBaseRefFields`) stempelt sie automatisch, sobald sie in
  `/plm/sections` erscheinen.
- **ERLEDIGT & VERIFIZIERT (Playwright):** Beide Felder einer Sektion zugewiesen (lösen jetzt Section-ID 203 via
  `getFieldSectionId` auf). Material-Variante „Kupfer" von XL200 PART1 erzeugt → **Blatt** (33636: `BASE_ITEM_NUMBER=XL200 PART1`,
  `DMS_ID_BASE_ITEM=17195`) **und Baugruppe** (33637: `BASE_ITEM_NUMBER=XL200`, `DMS_ID_BASE_ITEM=33508`) korrekt gestempelt,
  dazu `IS_VARIANT=true` + `TITLE` + `BOM_FINGERPRINT`. Test-Items 33636/33637 (00000760/761) danach archiviert.
  Merke: `/plm/sections` mit `updateCache=true` abrufen, sonst greift der v3-Cache noch auf den alten Layout-Stand.
- **⚠️ ALTLAST:** Die frühen Titel-Test-Items **00000758** (XL200 PART1 - Stahl) + **00000759** (XL200 - Stahl) sind noch
  **live** (Dedup fand sie als Reuse-Kandidaten) — im Handover als „archiviert" notiert, war es aber nicht. Sie stammen von
  **vor** der Feld-Zuweisung → tragen **keine** Basis-Refs. Bei Bedarf archivieren (`GET /plm/archive?wsId=57&dmsId=…`).

**Konzept-Fazit (warum WS 57 richtig):** WS 241 (Variants Manager) hat nur 12 Felder und seine „Varianten" haben **keine
eigene BOM** (leichte Attribut-Definition + Rückverweis). variants-bom erzeugt vollwertige, strukturell getauschte
Baugruppen → gehören in WS 57. Wir übernehmen nur die **WS-241-Konventionen** (TITLE-Ableitung, BASE_ITEM_NUMBER,
DMS_ID_BASE_ITEM als Textfelder), damit beide Tools konsistent sind.

## Umgebung / Fakten
- Tenant **contelosuxdemo**, Port **8080**, Items-Workspace **57**, BOM-View **"Tree Navigator"**.
- **Server-Neustart** nötig nur für IoT (service.js/routes/iot.js). Client (js/pug/css) ist statisch — kein Neustart.
- **APS-Session läuft ~1h ab** → 401. Re-Auth: App-URL navigieren, auf der Autodesk-Seite **"ERLAUBEN"** klicken (Playwright). Immer **Playwright MCP** für Browser-Checks.
- **Felder in WS 57** (alle vom User per FM-UI angelegt):
  - `VARIANT_ALLOWED` (Check Box) — **neu: markiert das variierbare TEIL** (Variationspunkt), nicht die Baugruppe.
  - `BOM_FINGERPRINT` (Single Line Text, suchbar) — kanonischer Hash.
  - `IS_VARIANT` (Check Box) — Varianten-Kennzeichnung. **Angelegt, aber noch NICHT im Code verdrahtet** (Phase 8).
  - `MATERIAL`, `MATERIALART` (beide Single Line Text / Freitext).
- **Material-Picklist übernehmen:** `CUSTOM_LOOKUP_MATERIAL` = [PVC, Stahl, Kupfer, Edelstahl, Aluminium], live via
  `GET /plm/picklist-setup?id=CUSTOM_LOOKUP_MATERIAL` → `data.picklist.values[].label`. (Farben: `CUSTOM_LOOKUP_FARBEN`.)

## Gotchas (gelernt — nicht neu reinlaufen)
- **`/plm/clone` MUSS als JSON gepostet werden** (nicht form-encoded): qs `arrayLimit:20` macht aus Sections mit >20 Feldern Objekte → `for...of` im Handler → HTML-500. `vbCloneAssembly` macht das schon per `$.ajax contentType:'application/json'`.
- **Boolean-Suche:** `/plm/search` filter comparator **13**, value `'true'`. **Text-equals:** comparator **15**.
- **`/plm/edit`:** `$.post('/plm/edit', {link, sections})` (jQuery-Bracket-Serialisierung ok). Sections bauen mit `addFieldToPayload(payload.sections, wsSections, null, FIELD, value)`, `wsSections = (GET /plm/sections?wsId=57).data`.
- **BOM-Add nimmt Master/Root-Version** des Teils (z.B. 28540→26226). Fingerprint nutzt **NUMBER** (revisionsunabhängig) → konsistent.
- **Panel-Mount:** `insertBOM/insertDetails/insertWorkspaceSearch/insertViewer` rendern in ein DOM-Element mit `id == params.id`. Container: `#bom`, `#item`, `#viewer`.
- **Session-Ablauf mitten im Create:** läuft die APS-Session (~1h) während eines mehrstufigen Creates ab, geben die
  `/plm/details`-Reads **401** zurück → `vbCloneAssembly` wirft `d.data.sections is not iterable` und der Create bricht
  ab ("Creation failed"). Kein App-Bug, globales Framework-Verhalten (XHR kann nicht re-authen). Kann **Teil-Items**
  hinterlassen → per Suche `IS_VARIANT=true` (comparator 13) finden und via `GET /plm/archive?wsId=57&dmsId=…` (204,
  reversibel) aufräumen. Vor langen Läufen ggf. frisch re-authen (App-URL öffnen → „ERLAUBEN").

## Dateien (uncommitted)
- **Neu:** `views/apps/variants-bom.pug`, `public/javascripts/apps/variants-bom.js`, `public/javascripts/custom/variants-bom.js`, `public/stylesheets/apps/variants-bom.css`, `public/stylesheets/custom/variants-bom.css`, `docs/VARIANTS-BOM-PLAN.md`, `docs/VARIANTS-BOM-HANDOVER.md`.
- **Additiv:** `routes/landing.js` (+Route), `settings.js` (+`applications.variantsBom`, +servicesEnabled `'variants-bom'`, +`variantAllowedOnly`), `CLAUDE.md` (App-Doku-Absatz).
- **IoT:** `services/iot/service.js` (`stopServerTicker`/`isServerTickerRunning` + Handle), `routes/iot.js` (`GET/POST /iot/ticker`), `views/apps/condition-monitoring.pug` (beschrifteter `#cm-pause`), `public/javascripts/apps/condition-monitoring.js` (`setPaused` + Ticker-Toggle + Sync beim Laden).
- **Screenshots** im Repo-Root: `variants-bom-*.png` (behalten oder löschen — egal).

## Verifiziert (Playwright)
App-Load · VARIANT_ALLOWED-Read · BOM-Baum · Klick→Details · Toggle Details · **Viewer** (Modell rendert) ·
Filter "Variant Items Only" (1 indizierte Suche) · Swap (Picker→Badge→Save) · Fingerprint-Engine (`variantsBomSelfTest()` grün) ·
**Phase-7 Flag-Flip:** Propagation automatisch bis Wurzel, kein Baugruppen-Flag/Block · Create+Dedup **einstufig (XL200)** und **mehrstufig (Trancheur, 3 Ebenen)**; Testvarianten 00000741–744 erzeugt & wieder archiviert.

## Testdaten im Tenant
- **XL200** dmsId **33508** (klein, hat Modell). Kind PART2 = 17196 (edge in XL200). Externes Tauschteil: **28540** "Ø20 Sicherungsscheibe Nord Lock" (Master 26226).
- **Rock Trencher** dmsId **18437** (riesige 6-Ebenen-BOM). Geflaggte Kette: **18437 → 17069 (Mainframe assembly) → 16789 (4030-1135)**; tiefes Blatt **16821** "4030-1135 main rhs" (edge **13402**) unter 16789.
- Aktuell `VARIANT_ALLOWED=true`: 17036,17191,17195,17688,18049,33508,18437,17069,16789. **Migration offen:** unter Phase-7-Modell gehört das Flag auf TEILE, nicht Baugruppen (Propagation ignoriert Assembly-Flags aber ohnehin).

---

## PHASE 8 — Material-Variation (baubar, alle Entscheidungen fix)

**Ziel:** ein geflaggtes TEIL variieren, entweder **(a)** bestehendes Ersatzteil wählen (haben wir) **oder**
**(b)** dessen `MATERIAL` ändern → Material-Varianten-Blatt erzeugen/wiederverwenden; Baugruppen propagieren automatisch (Phase 7).

**Config (in `settings.js` → `applications.variantsBom`):**
```js
fieldIds : { number:'NUMBER', variantAllowed:'VARIANT_ALLOWED', bomFingerprint:'BOM_FINGERPRINT',
             material:'MATERIAL', materialart:'MATERIALART', isVariant:'IS_VARIANT' },
materialPicklistId       : 'CUSTOM_LOOKUP_MATERIAL',
materialVariantNumbering : 'new'   // 'new'=Klon bekommt Auto-Nummer; 'keep'=gleiche Nummer, nur MATERIAL (dann Material in ALLE Blatt-Identitäten → O(n); deferred)
```

**Fixe Design-Entscheidungen:**
- **Blatt-Identität einer Material-Variante** = `fpHash(baseNumber + '|' + material + '|' + materialart)`.
  Wird BEIDES: (1) als `BOM_FINGERPRINT` auf dem Blatt gespeichert (Leaf-Dedup) und (2) als Beitrag zum
  Baugruppen-Fingerprint verwendet. Reguläre/unveränderte Blätter tragen weiterhin ihre **NUMBER** bei;
  Mode-a-Swap trägt die NUMBER des Zielteils bei. → **kein O(n) Material-Read**, innerhalb des Tools konsistent.
- **'new'-Nummerierung ist primär.** 'keep' bräuchte Material in allen Blatt-Identitäten (O(n)) → dokumentiert, deferred.
- **Jede erzeugte Variante (Blatt + Baugruppen) bekommt `IS_VARIANT=true`** gestempelt (+ `BOM_FINGERPRINT`).

**Bauschritte:**
1. Config oben; `vb` liest neue `fieldIds` + `materialPicklistId`.
2. Material-Picklist einmal laden (`/plm/picklist-setup?id=CUSTOM_LOOKUP_MATERIAL`) → `vb.materials` (Labels) cachen.
3. `selectNodeForSwap`: `#item` neu aufbauen mit **beidem** — Material-Dropdown + "Apply material" **und** dem bestehenden
   `insertWorkspaceSearch` (in Sub-Div, z.B. `#vb-replace` mounten).
4. `recordMaterialSwap(material)`: `vb.swaps[edgeId] = { mode:'material', fromLink, fromNumber, materialart, material, row }`;
   Zeile markieren, Badge "→ Material: <x>", Save aktiv. Bestehendes `recordSwap` → `mode:'replace'`.
5. Helper `vbSwapIdentity(swap)`: replace → `swap.toNumber`; material → `'MAT:'+fpHash(fromNumber+'|'+material+'|'+materialart)`.
6. `vbPlanFingerprints`: für geswappte Edges `vbSwapIdentity(swap)` statt `toNumber`.
7. Plan-Pass: für Material-Swaps Leaf-Dedup-Suche `BOM_FINGERPRINT = fpHash(fromNumber+'|'+material+'|'+materialart)`
   → `swap._leafExisting {link,number}`. Im Plan-Panel zeigen ("Create material variant <mat> of <part>" / "Reuse <number>").
8. Execute: **zuerst** Material-Swaps zu konkretem `toLink` auflösen: wenn `_leafExisting` → nutzen; sonst
   `vbCloneAssembly(fromLink)` (funktioniert auch für Blätter), `MATERIAL=material` per `/plm/edit` setzen
   ('keep' → zusätzlich NUMBER zurücksetzen auf fromNumber), `BOM_FINGERPRINT=leafFp` + `IS_VARIANT=true` stempeln,
   `swap.toLink = clone`. **Dann** läuft die bestehende Baugruppen-Schleife (`replaceBOMItems`) mit `swap.toLink`.
9. `vbStampFingerprint`: zusätzlich `IS_VARIANT=true` mit ins Payload (für Blätter **und** Baugruppen).
10. Playwright-Test: ein Rohr-Teil flaggen, Material ändern (Mode b), Save → Blatt-Stahlvariante + propagierte
    Baugruppen; Wiederholen → Reuse; Mode a weiterhin ok.

**Ceilings/offen:** cross-session Re-Derivation der Baugruppen-Fingerprints aus echter BOM bräuchte O(n) Material-Reads
(nicht gemacht; Tool berechnet Kandidaten immer über den Swap-Flow → konsistent). Node-Selektion aktuell auf allen Knoten
erlaubt (nicht auf VARIANT_ALLOWED-Teile beschränkt). Flag-Migration Baugruppe→Teil.

## Ebenfalls offen
- **IoT:** Server neu starten, dann `/condition-monitoring` Pause/Resume verifizieren (Button toggelt Client-Poll **+**
  Server-Ticker via `GET/POST /iot/ticker`, synct Zustand beim Laden).
- **Commit/Push** nur auf ausdrückliche Ansage. Regression ist sauber (variants.js/utils.js/configurator.js unangetastet; `/variants` mit Item lädt fehlerfrei).
