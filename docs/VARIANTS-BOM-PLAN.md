# Varianten-Management `/variants-bom` — Plan & Todo

Neue App zum variantengetriebenen BOM-Editieren mit **Aufwärts-Propagation** und
**exakter Dedup-Prüfung**. Der bestehende option-basierte `dev/configurator`
bleibt unverändert erhalten.

- **Tenant (zuerst):** `contelosuxdemo` — items-Workspace `57`.
- **App-Route:** `/variants-bom` (eigene App, nicht der Configurator).
- **Propagation bei nicht-variantenfähigem Parent:** stoppen + warnen.
- **„Exakt"** = rekursiv jeder Knoten inkl. jeder Schraube identisch (vom User vorgegeben).

---

## Konzept in einem Satz

Tauscht ein User in einer variantenfähigen Baugruppe einen Kindknoten
(z.B. Rohr Alu → Rohr Stahl), erzeugt das System beim Speichern **bottom-up**
für die geänderte Baugruppe und jeden variantenfähigen Parent eine neue Variante —
prüft aber vorher per **BOM-Fingerprint**, ob genau diese Zusammensetzung schon
existiert, und schlägt in dem Fall den vorhandenen Knoten zur Wiederverwendung vor.

## Datenmodell — 2 neue Felder im items-Workspace (57)

> Felder werden **per Admin-UI** angelegt (FM v3-REST kann keine Felder erzeugen).
> Ablauf siehe Skill `fm-admin-fields`.

| Feld-ID | Typ | Zweck |
|---|---|---|
| `VARIANT_ALLOWED` | Checkbox (Boolean) | Item ist variantenfähig — **Baugruppe ODER Einzelteil** (ein Rohr als Blatt kann selbst die Variante sein). Nur geflaggte Items propagieren nach oben / erscheinen im Filter. |
| `BOM_FINGERPRINT` | Text (suchbar/indexiert) | Kanonischer Hash der aufgelösten BOM-Zusammensetzung. Dedup = eine `/plm/search`-Abfrage. |

## Fingerprint-Definition (rekursiv, bottom-up)

- **Blatt** (kein BOM / nicht variantenfähig): `fp = NUMBER` (identitätsstiftende Teilenummer).
- **Baugruppe:** `fp = hash( sort( [ (child.fp + "×" + qty) für jedes Kind ] ) )`.
- Sortiert → Reihenfolge/Position egal. Menge zählt. Rekursiv → eine Schraube tief
  unten anders ⇒ deren Blatt-`fp` ändert sich ⇒ jeder Eltern-`fp` ändert sich.
  Genau das gewünschte „ein Teil anders ⇒ kein Vorschlag".
- **Annahmen (ponytail — anpassbar):** Positions-/Find-Nummern zählen *nicht* mit
  (nur „was verbaut ist" + Menge). Nicht-strukturelle Felder (Beschreibung, Notizen)
  zählen *nicht* mit. Hash = stabiler String-Hash über die sortierte Kinderliste.

## Ablauf

1. User öffnet variantenfähige Baugruppe (`VARIANT_ALLOWED = Ja`) in `/variants-bom`.
2. BOM-Baum wird gezeigt (`insertBOM`, Tree-Navigator-View). User tauscht einen
   Kindknoten (wählt Ersatzteil aus Suche).
3. **Betroffener Pfad bottom-up** = geänderte Baugruppe + alle variantenfähigen
   Eltern bis Wurzel. Am ersten **nicht-geflaggten** Parent → Stopp + Warnung
   („Baugruppe X ist nicht variantenfähig — Änderung kann nicht nach oben
   propagiert werden").
4. Auf **Speichern/Erzeugen**, pro Ebene von unten nach oben:
   1. Fingerprint der neuen Zusammensetzung berechnen.
   2. `POST /plm/search` auf `BOM_FINGERPRINT = <hash>` (gleicher Workspace).
   3. **Treffer** → Dialog „Diese Kombination existiert bereits als `<Nummer>`.
      Vorhandenen Knoten verwenden?" → bei Ja vorhandenen Item-Link als Kind einsetzen.
   4. **Kein Treffer** → `POST /plm/clone` (Deep-Clone) → getauschten Knoten via
      `bom-remove` + `bom-add` (bzw. `replaceBOMItems`) ersetzen → `BOM_FINGERPRINT`
      am Klon setzen.
   5. Ergebnis-Link (neu **oder** wiederverwendet) ist das neue Kind der
      nächsthöheren Ebene → 4.1–4.4 wiederholen.

**Warum bottom-up:** Der Parent-Fingerprint hängt vom (evtl. wiederverwendeten)
Kind-Fingerprint ab — erst unten auflösen, dann hoch.

## Vorhandene Bausteine (wiederverwenden, nichts Neues am Server nötig)

- `POST /plm/clone` (`routes/plm.js:1401`) — Deep-Clone inkl. BOM.
- `POST /plm/bom-add` (`:4627`), `POST /plm/bom-remove` (`:4760`).
- `POST /plm/search` (`:5326`) — Suche nach `BOM_FINGERPRINT`.
- `GET /plm/bom` — BOM-Baum.
- Client-Helper (`framework/utils.js`): `cloneItems` (`:6799`),
  `replaceBOMItems` (`:6873`), `getSectionFieldValue`, `insertBOM`, `insertDetails`,
  `insertSearch`/`insertResults`.

---

## Todo (abarbeitbar)

### Phase 0 — Setup & Felder
- [x] `VARIANT_ALLOWED` im items-Workspace (57, `contelosuxdemo`) per Admin-UI anlegen (Checkbox). Verifiziert: per Feld-ID lesbar (`= false` an Testitem).
- [x] `BOM_FINGERPRINT` (Single Line Text, suchbar) im items-Workspace anlegen.
- [x] Testdaten geflaggt: XL200-Kinder PART1 (17195), FITTING (17191), DIN 933 Schraube (17036) = `VARIANT_ALLOWED true`. (Alu/Stahl-Rohr-Paar für Dedup folgt in Phase 4.)

### Phase 1 — App-Gerüst `/variants-bom`  ✅ verifiziert (Playwright)
- [x] Route-Zeile in `routes/landing.js` (`launch('apps/variants-bom', 'variantsBom', ...)`).
- [x] `views/apps/variants-bom.pug` (extends `framework/layout.pug`).
- [x] `public/javascripts/apps/variants-bom.js` (Grundgerüst + `getFeatureSettings`).
- [x] `exports.applications.variantsBom` in `settings.js` + `servicesEnabled`-Flag.
- [x] Feld-IDs (`VARIANT_ALLOWED`, `BOM_FINGERPRINT`, `NUMBER`) in die App-Config.
- [x] `custom/`-Stubs (js+css) + `apps/variants-bom.css` (absolute Panel-Layout, Framework-Muster).

### Phase 2 — BOM anzeigen & Knoten tauschen
- [x] Baugruppe öffnen, BOM-Baum via `insertBOM` rendern. ✅ verifiziert (XL200, 8 Knoten).
- [x] Klick auf Knoten → Details im `#item`-Panel (`insertDetails`). ✅ verifiziert.
- [x] Toggle Details (Panel ein/aus). ✅ verifiziert.
- [x] Kindknoten selektierbar; Ersatzteil-Auswahl via `insertWorkspaceSearch` (WS 57) im `#item`-Panel. ✅ verifiziert.
- [x] Getauschter Knoten markiert (durchgestrichen + „→ Ersatz"-Badge), Save aktiviert, `vb.swaps[edgeId]` erfasst. ✅ verifiziert (PART2 → NUT1).
- [x] **Toggle „Variant Items Only"**: filtert BOM auf `VARIANT_ALLOWED = true` — Baugruppen
      **und** Einzelteile. ✅ verifiziert (3/8 Zeilen bleiben). Per-Knoten-Flag-Read (ponytail-Ceiling
      im Code notiert). Viewer-Filter offen bis Viewer eingebaut wird.

### Phase 3 — Fingerprint-Engine (Kern)  ✅ verifiziert (Playwright)
- [x] `computeFingerprint(node)` rekursiv bottom-up (FNV-1a → 16 hex; leaf=NUMBER, assembly=hash(sort(child×qty))).
- [x] `variantsBomSelfTest()`: Reihenfolge egal, Teil/Menge anders → anderer Hash, 1.0==1, verschachtelte Änderung blubbert hoch. ✅ alle Asserts grün.
- [x] `buildTreeFromDOM()` (Struktur/qty/NUMBER aus DOM, Flag aus `.variant-allowed`) + `affectedChain(tree,edgeId)`: Stopp+Warnung am ersten nicht-geflaggten Parent. ✅ beide Pfade verifiziert (XL200 ungeflaggt → Warnung; geflaggt → `["XL200"]`).

### Phase 4 — Dedup + Erzeugung  ✅ verifiziert (Playwright, echte Items in contelosuxdemo)
- [x] Plan-Pass (lesend): Fingerprints bottom-up + `POST /plm/search` (comparator 15) pro Ebene.
- [x] Treffer → Reuse; Kein Treffer → JSON-`clone` + `replaceBOMItems` (behält Menge) + `BOM_FINGERPRINT` stempeln.
- [x] Bottom-up `vbExecutePlan`: Ergebnis-Link nach oben durchgereicht (`resolved{}`).
- [x] Plan-Panel + **grüne** Erfolgsmeldung; Wurzel-Variante via `openItemByLink` geöffnet.
- **Create verifiziert:** Swap PART2→Nord-Lock → neues Item `00000741` (Auto-Nummer, Kind getauscht, Fingerprint `0f4ffea993907faa`).
- **Dedup verifiziert:** identischer Swap → „Reuse existing 00000741", 0 erzeugt.
- **Fix:** `/plm/clone` als JSON posten (nicht form-encoded) — qs `arrayLimit:20` macht sonst aus Sections mit >20 Feldern Objekte → 500. Geteilter `cloneItems` unangetastet.
- **Erkenntnis:** BOM speichert die Master-/Root-Version des getauschten Teils (28540→26226); Fingerprint nutzt **NUMBER** (revisionsunabhängig) → bleibt konsistent.

### Phase 5 — Absicherung  ✅ verifiziert (Playwright)
- [x] Mehrstufiger End-to-End-Test: Trancheur (18437) → Mainframe (17069) → 4030-1135 (16789), Blatt tief unten getauscht.
      **Create:** 3 verschachtelte Varianten bottom-up (00000742 → 00000743 → 00000744), jede korrekt verdrahtet, Blatt getauscht, Fingerprints gestempelt.
      **Dedup:** identischer Swap → „Reuse 00000742/743/744", 0 erzeugt.
- [x] **Performance-Fix:** `ensureVariantFlags` nutzt **eine** indizierte Suche (`VARIANT_ALLOWED=true`, comparator 13) statt N Detail-Calls — skaliert auf den 2385-Zeilen-Trancheur.
- [x] Session-Ablauf (401) erkannt: erneute APS-Autorisierung nötig, danach lädt die volle 6-stufige BOM.
- [x] Regressionscheck: `variants.js`/`utils.js`/`configurator.js` git-bestätigt unangetastet; `/variants?wsId=57&dmsId=33508` lädt fehlerfrei. `/configurator` 404 = Normalzustand (dev, nie in servicesEnabled).
- [x] Doku-Zeile in `CLAUDE.md` ergänzt (Abschnitt „Adding a new standard app").

### Propagations-Regel — ~~alt~~ **überholt durch Phase 7 (Modell-Flip)**
~~Der Flag gilt pro Baugruppe … Kette lückenlos geflaggt … Stopp+Blockade.~~
Siehe **Phase 7**: `VARIANT_ALLOWED` markiert jetzt die variierbaren **Teile**, Baugruppen werden
automatisch mitgenommen. Kein Baugruppen-Flag, keine Blockade mehr.

## Phase 7 — Modell-Flip + Viewer  ✅ verifiziert (Playwright)
- [x] **Flag-Bedeutung gedreht:** `VARIANT_ALLOWED` markiert **variierbare Teile** (das Rohr), nicht Baugruppen.
- [x] **Propagation automatisch:** jede Baugruppe vom geänderten Teil bis zur geöffneten Wurzel wird
      mitgenommen (neue Nummer). Block-Check in `saveVariant` + Gate in `affectedChain` entfernt.
- [x] **3D-Viewer** ergänzt (`insertViewer`, Layout Viewer oben / BOM unten / Details rechts). ✅ XL200-Modell rendert.
- [ ] **`IS_VARIANT`-Marker** (Checkbox, FM-UI anzulegen): beim Erzeugen auf jede Variante stempeln
      (Teil **und** mitgenommene Baugruppen) = die „Kenntlichmachung" der Ober-Baugruppe.
- [ ] Migration: die 3 test-geflaggten Baugruppen (18437/17069/16789) entflaggen; stattdessen die
      variierbaren Teile flaggen. (Propagation ignoriert die Assembly-Flags jetzt ohnehin.)

## Phase 8 — Material-Variation (Picker **oder** neu per Material)  ✅ verifiziert (Playwright, contelosuxdemo)
- WS 57 `MATERIAL`/`MATERIALART` = Single Line Text (Freitext). **Aber** WS 241 nutzt `MATERIAL` als
  Single-Selection auf die Shared-Picklist **`CUSTOM_LOOKUP_MATERIAL`** (Werte: PVC, Stahl, Kupfer,
  Edelstahl, Aluminium; Farben: `CUSTOM_LOOKUP_FARBEN`).
- [x] **Material-Wähler** im Detail-Panel: Werte **live** aus `/plm/picklist-setup?id=CUSTOM_LOOKUP_MATERIAL`
      (Shape `data.picklist.values[].label`, keine hartkodierten Presets); gewählter Wert wird als Text in WS-57-`MATERIAL` geschrieben. `loadMaterials` cacht Labels; Fehlschlag lässt `null` → Retry.
- [x] **(a) Bestehendes Teil wählen** — Ersatzteil-Picker, jetzt in Sub-Div `#vb-replace` neben dem Material-Wähler (koexistieren). `recordSwap` → `mode:'replace'`.
- [x] **(b) Neu per Material** — Blatt klonen (`vbCloneAssembly`), `MATERIAL` setzen, Auto-Nummer
      (`materialVariantNumbering:'new'` primär; `'keep'` = NUMBER zurücksetzen, dokumentierte O(n)-Ceiling, deferred); **Leaf-Dedup** per Fingerprint-Suche vor dem Klonen.
- [x] **Fingerprint-Leaf erweitert:** Material-Swap trägt `'MAT:'+fpHash(NUMBER|MATERIAL|MATERIALART)` zum
      Assembly-Fingerprint bei (`vbSwapIdentity`); reguläre Blätter weiterhin NUMBER → kein O(n).
- [x] **`BOM_FINGERPRINT` auf Blättern** gestempelt (= `fpHash(NUMBER|MATERIAL|MATERIALART)`) → Leaf-Dedup = dieselbe eine Suche wie bei Baugruppen.
- [x] **`IS_VARIANT=true`** auf jede erzeugte Variante (Blatt **und** Baugruppe) via `vbStampFingerprint`.
- **Verifiziert:** config nach Neustart geladen; Material-Picklist live (5 Werte); Doppel-Wähler koexistieren;
      **Create (Mode b):** PART1→Stahl → Blatt `00000745` (MATERIAL=Stahl, IS_VARIANT=true, leafFp `e7922ddbcea8a7fd`) +
      propagierte Baugruppe `00000746` (IS_VARIANT=true, fp `221b5ab2df475a45`), altes PART1 (17195) ersetzt;
      **Reuse:** identischer Swap → „Reuse 00000745" + „Reuse 00000746", 0 erzeugt; **Mode a** Picker rendert nach Layout-Umzug.
      Selbsttest um Material-Identitäts-Vertrag erweitert (grün). Test-Items `00000745`/`00000746` zum Archivieren.
- [x] **Node-Selektion auf `VARIANT_ALLOWED` beschränkt** (verifiziert): `ensureVariantFlags` läuft bei jedem
      BOM-Load (eine indizierte Suche → `vb.flagged`); Klick auf ungeflaggten Knoten zeigt Hinweis statt Picker,
      fail-open solange die Flag-Suche noch läuft.
- **Offen:** `'keep'`-Nummerierung (O(n), deferred); cross-session Re-Derivation der Baugruppen-Fingerprints
      aus echter BOM (Tool bleibt über Swap-Flow konsistent).

## Phase 6 — Backlog (aus `knowledge/Contelos.Vault.CopyItem` abgeleitet)
Referenz-Tool (Vault C#-Add-in) löst dasselbe Problem im Desktop; **Code nicht übernehmbar** (Vault ≠ FM),
aber bestätigt unseren bottom-up + Aufwärts-Propagations-Ansatz 1:1. Verwertbare Ideen, nur bauen wenn gebraucht:
- [ ] **(a) Attribut-Variation als Trigger** — Material/Oberfläche am Knoten ändern (nicht nur ganzen Knoten
      tauschen). Deckt „Rohr Stahl statt Alu" ab, wenn die Stahl-Variante als Teil noch **nicht** existiert:
      Blatt klonen → Attribut setzen → umnummerieren. Braucht Tenant-Config (welches Feld = Material).
- [ ] **(b) Leaf-Dedup per Attribut** — vor dem Klonen eines Blatts per Suche (Stammnummer+Material+Oberfläche)
      prüfen, ob es das Teil schon gibt (CopyItem: `CheckDuplicateItems`). Komplementär zu unserem Assembly-Fingerprint.
- [ ] Nummernschema (`Stammnummer`/Generator) statt roher Auto-Nummer; gleiches Kind an mehreren Positionen.

## Offene Punkte (später entscheiden)
- ~~Basis-Assemblies fingerprinten (Backfill)~~ **deferred (YAGNI).** Dedup läuft gegen tool-erzeugte Varianten;
  ein Backfill deckt nur den Randfall „gewünschte Variante existiert schon als handgebautes Original" ab und
  kein echter Auslöser ist bekannt. Falls es je klemmt: **Lazy-Stamping** — Fingerprint einer Baugruppe erst beim
  Öffnen berechnen+speichern (füllt sich über normale Nutzung, kein Massen-Write). Kein proaktiver Batch nötig.
- Swap-Picker filtern (aktuell ganzer Workspace, keine Klassen-/Typ-Einschränkung).
- Zählen Positions-/Find-Nummern zum Fingerprint? (Default: nein.)
- Teil-Propagation statt Blockade zulassen? (aktuell Blockade am ungeflaggten Parent.)
