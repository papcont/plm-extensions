# Mechatronic BOM Editor (`/mebom`) — Fusion Manage Setup

Was der Tenant braucht, damit `dev/mebom` sinnvoll läuft. Stand 2026-08-28, verifiziert
gegen `contelosuxdemo` (Test-Asset `A000019 - Unterbau`, WS 904/30057).

Der Editor sitzt auf dem **Asset-Management-Modell**: Kontext = ein Asset, das per Link-Feldern
auf die Mechanik-BOM und auf typisierte Instanz-Listen (Serial Numbers, Motors, Sensors,
Control Elements) zeigt. Config-Block: `settings.js → exports.applications.mebom`.

## Zwei Nutzungsstufen

- **Betrachten + 3D-Isolation** (Mechanik-BOM + Viewer + Instanz-Listen, Klick isoliert die
  Instanz im 3D) — **läuft bereits**, kein weiterer Tenant-Eingriff nötig.
- **Sync / Save-back** (Instanz-Listen aus dem 3D-Modell befüllen/abgleichen und nach PLM
  schreiben) — braucht die Punkte unten.

## Bereits vorhanden (Basis — nicht anfassen)

| Baustein | contelosuxdemo |
|---|---|
| Asset-Workspace mit Link-Feldern `ENGINEERING_BOM`, `SERIAL_NUMBERS_LIST`, `MOTORS_LIST`, `SENSORS_LIST`, `CONTROL_ELEMENTS_LIST` | WS 904 |
| Instanz-Listen-Workspaces mit `INSTANCE_ID, NUMBER, ITEM_TITLE, ITEM_REV, LOCATION, INSTANCE_PATH, BOUNDING_BOX, SERIAL_NUMBER` + Grid-Views | 901 / 967 / 968 / 969 |
| Mechanik-BOM-Root mit viewbarer Datei | ENGINEERING_BOM → WS 57 |

## Offene Tenant-Aufgaben für den vollen Sync (Admin/Daten, kein Code)

### A. Hierarchisches 3D-Viewable  — *wichtigster Punkt*
Das aktuell hinterlegte Derivat ist **flach**: alle Viewer-Instanzen ohne Eltern-Pfad
(`instancePath`/`pathNumbers` leer). Folgen:
- Klick-Isolation läuft nur über einen Name-Fallback (Blatt-Name), kann **dasselbe Teil unter
  zwei Unterbaugruppen nicht unterscheiden**.
- `matchMCADViewerInstances` (Grundlage des Sync) matcht über `pathNumbers` → findet nichts.

→ Die 3D-Datei muss die **Baugruppen-Instanzstruktur** erhalten (Inventor `.iam` mit Struktur,
korrekt übersetzt/publiziert — nicht als geflachtes Modell). CAD-/APS-Aufbereitung, kein Code.

### B. Teil-Typ an den Mechanik-BOM-Teilen  — Klassifizierer für die Tabs
Der Sync sortiert 3D-Teile per `config.tabs[].filter` in Motor/Sensor/Control. Dafür braucht
jedes Teil im Mechanik-BOM ein befülltes Typ-Feld. Befund:
- `COMPONENT_TYPE` (Single Selection, semantisch richtig) — **praktisch leer** (0/62 im
  Test-BOM, 1/1500 tenant-weit).
- `TYPE` (Radio Button) — voll befüllt, aber **zu grob**: nur Mechanical / Electric Motor /
  Electrical, kein Sensor/Control-Wert; die serialisierten Motor-Instanzen sind im BOM nicht
  als Motor typisiert.

→ `COMPONENT_TYPE` pro Teil mit Motor/Sensor/Control-Wert befüllen (Picklist-Werte prüfen/
anlegen), **dann** pro Tab in `settings.js` setzen:
```js
tabs: [ { label:'Motors', /*…*/ filter:{ fieldId:'COMPONENT_TYPE', value:'Motor' } }, … ]
```
Sobald das Feld befüllt ist, ist der Rest reine Config.

### C. Editierbare Instanz-Grids + Schreibrechte
Die Listen-Grids (901/967/968/969) rendern **readonly**. „Save New & Updated Entries" kann so
nichts schreiben. → Grid-Tab der Listen-Workspaces editierbar konfigurieren + Edit-Permission
für die Nutzer.

### D. CAD→PLM-Instanzdatenquelle
`INSTANCE_ID / INSTANCE_PATH / BOUNDING_BOX` müssen aus dem 3D-Modell kommen. Im Demo sind sie
vorbefüllt (Quelle existiert). Für den Echtbetrieb: die Vault/Inventor-Anbindung bzw.
Datenpipeline, die 3D-Instanzen erfasst und in die Listen schreibt. Der Sync-Flow legt dann
„New Instances" an — aber erst mit A + B.

## Kurzfazit

| Ziel | Fehlt |
|---|---|
| Betrachten / Eindeutigkeit über Serial Numbers / 3D-Isolation | nichts |
| Voller Sync / Save-back | A (hierarchisches Viewable), B (Typ-Feld + Filter), C (Grids editierbar + Rechte), D (Instanzdatenquelle) |

A und D sind CAD-/Integrations-Themen, B und C sind FM-Admin-/Datenpflege. Kein weiterer
Code am Editor nötig — die App ist fertig, sobald die Daten stimmen.
