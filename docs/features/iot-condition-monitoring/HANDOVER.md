# HANDOVER — IoT / Condition Monitoring (für nächsten Chat)

_Stand: 2026-08-12 (Feierabend). Nichts committet, nichts gepusht._

## Wo stehen wir
MVP-Kern fertig **und darüber hinaus**: Browser-Check erledigt, Extension an den **Asset-Anker**
gebunden, im Tenant das Feld **`IOT_DEVICE_ID`** angelegt (Sensors 968) + Demo-Wert gesetzt, und die
**datengetriebene DevEUI→Asset-Auflösung** gebaut. `npm test` → **27/27 grün**. Genauer Stand:
`STATUS.md` (oben stehen die neuesten Blöcke).

**Heute erledigt (chronologisch):**
1. Browser-Check (headed Playwright): voller Arc NORMAL→OBSERVE→WARNING→CRITICAL→NORMAL, 3 Charts,
   Events; `/abom`-Regression sauber (einziger Console-Error vorbestehend).
2. Tenant erkundet: Assets(904) ↔ Sensors(968); Modell geklärt (**1 Record = 1 Sensor**).
3. Extension asset-gebunden: `/condition-monitoring?wsId=904&dmsId=<asset>` zeigt Asset + Sensor +
   `IOT_DEVICE_ID`; ohne Kontext unverändert Standalone-Demo.
4. Tenant modelliert: Feld `IOT_DEVICE_ID` (Single Line Text, 32) an Sensors(968) angelegt & persistiert;
   Demo-Wert `70B3D57ED0056789` auf Record 30225 (A000022 - Cheops-Pyramide).
5. Datengetriebener Resolver (gated): Bridge löst DevEUI→Asset über Sensors(968) auf; 4 neue Tests.

## Als ALLERERSTES im nächsten Chat lesen (Source of Truth)
- `docs/features/iot-condition-monitoring/GOAL.md` — unveränderliches Zielbild
- `docs/features/iot-condition-monitoring/STATUS.md` — genauer Stand (done / getestet / offen / blockiert / DoD #14)
- `docs/features/iot-condition-monitoring/IMPLEMENTATION_PLAN.md` — Phasen
- `docs/features/iot-condition-monitoring/netvox-r718e-spec.md` — verifizierte Netvox-Payload (Primärquelle)
- `docs/features/iot-condition-monitoring/fusion-manage-mapping.md` — was der Tenant für Live-Writes braucht

## Morgen — offene Entscheidungen (deine)
1. **Committen?** Rein additiver Stand, Commit-Stil `[NEW : IoT] …`, Push nur nach expliziter Freigabe.
   (Achtung: `git status` zeigt auch unrelated vorbestehende Änderungen — vor Commit gezielt stagen.)
2. **Live-FM-Resolver scharf verifizieren:** Auflösung `70B3D57ED0056789 → 30223` echt testen. Braucht
   2-legged-Admin-Creds für `contelosuxdemo` (`ADMIN_CLIENT_ID/SECRET`) + `IOT_TENANT_LINK` +
   `IOT_RESOLVE_FROM_FM=true`. Bis dahin ist nur die Resolver-**Logik** unit-getestet, nicht der Live-Query.
3. Optional: zweiten Sensor-Record (30060, A000019) mit Demo-`IOT_DEVICE_ID` versehen.
4. Größer/später: FM-Condition-Writes real machen — dazu die Workspaces A/B (Condition-Summary + Events)
   im Tenant anlegen (Struktur in `fusion-manage-mapping.md`), dann `FUSION_MANAGE_IOT_WRITES=true`.

## Hinweis zum laufenden Server
Der Server (falls noch an) hat den **alten** Backend-Code. Die heutigen `services/iot/`-Änderungen (Resolver)
greifen erst nach **Neustart** — sind aber default gated OFF, also bleibt das Demo identisch. Die UI-/CSS-/
Pug-Änderungen (Asset-Anker) werden pro Request ausgeliefert und sind schon live getestet.

## Was neu ist (alles additiv)
- `services/iot/*.js` — canonical, bfloat16, netvoxR718E, tts, simulator, health, condition,
  deviceRegistry (**+ `ensure`/Directory**), **`sensorDirectory` (neu, gated FM-Resolver)**,
  tandemRepository, fusionManageRepository, bridge, service, config
- `routes/iot.js` — `/iot/config|tick|state|history|reset|uplink` (keine PLM-Auth, keine Secrets)
- `views/apps/condition-monitoring.pug` + `public/javascripts/apps/condition-monitoring.js`
  (**+ Asset-Anker: `initAssetContext`/`findField*`**) + `.../condition-monitoring.css`
- `test/iot/*.test.js` (+ **`deviceRegistry.test.js`**, `npm test` Script in package.json)
- Geteilter Code, minimal: `app.js` (require + `app.use('/iot',…)`), `routes/landing.js` (1 Zeile),
  `settings.js` (`conditionMonitoring`-Block + `servicesEnabled['condition-monitoring']=true`)

## Verifikations-Kommandos
- `npm test` — **27/27** (canonical, netvox decode vs. Primärquelle, tts, simulator, health, condition,
  bridge-Integration, E2E-Arc, Hardware-Swap-Parität, **DevEUI→Asset-Resolver**)
- Asset-Anker live: `http://localhost:8080/condition-monitoring?wsId=904&dmsId=30223` → Sensor
  „A000022 - Cheops-Pyramide · 70B3D57ED0056789", 0 Console-Errors (headed Playwright).

## Blockiert — dokumentiert, NICHT erfinden
- Live-Tandem: keine Facility/Stream/Credentials → `TANDEM_ENABLED=false`, In-Memory-Zeitreihe als MVP
- Live-FM-Writes: Ziel-Workspace/Feld-IDs undefiniert → `FUSION_MANAGE_IOT_WRITES=false`
  (benötigte Struktur in `fusion-manage-mapping.md`)

## Nach Hardware-Lieferung (R718E + SenseCAP M2) — nur diese Schritte
1. Server deployen (öffentliche HTTPS-URL) → TTS-Webhook auf `POST /iot/uplink` (rohes `frm_payload`) —
   Endpoint + Decoder existieren & getestet
2. `IOT_SOURCE=tts` setzen
3. DevEUI → Asset zuordnen. **Datengetrieben (empfohlen):** DevEUI ins Feld `IOT_DEVICE_ID` am
   PLM-Sensor (968) eintragen und `IOT_RESOLVE_FROM_FM=true` + `ADMIN_CLIENT_ID/SECRET` +
   `IOT_TENANT_LINK` setzen — dann löst die Bridge automatisch auf. **Statisch (Fallback):**
   `IOT_DEVICE_ASSET_MAP`.
Tandem/FM-Writes/Health/Condition/Datenmodell/UI bleiben unverändert.

## Wichtige Regeln (Projekt)
- Server startet der User selbst; niemals autonom starten.
- Kein Push/Commit ohne explizite Freigabe (dann Commit-Stil `[NEW : IoT] …`).
- settings.js nur additiv (neue App), Tenant-Werte gehören in `settings/<tenant>.js`.
