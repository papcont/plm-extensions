# Fusion Manage → Dolibarr BOM Integration

Automatische ERP-Anbindung zur Übertragung von Stücklisten (Bills of Materials) von Autodesk Fusion Manage zu Dolibarr.

## Features

✅ **Webhook-basierte automatische Übertragung** - Automatischer Transfer bei Änderungen in Fusion Manage  
✅ **On-Demand API** - Manuelle Übertragung einzelner oder mehrerer Stücklisten  
✅ **Intelligente Datentransformation** - Automatische Zuordnung zwischen Fusion Manage und Dolibarr  
✅ **Transfer-Historie** - Vollständige Protokollierung aller Übertragungen  
✅ **Fehlerbehandlung** - Robuste Fehlerbehandlung mit detailliertem Logging  

## Architektur

```
┌─────────────────┐         ┌──────────────────────┐         ┌─────────────┐
│ Fusion Manage   │         │  Integration Service │         │  Dolibarr   │
│                 │         │                      │         │             │
│  - Items        │────────▶│  - Webhook Handler   │────────▶│  - Products │
│  - BOMs         │         │  - BOM Transformer   │         │  - BOMs     │
│  - Webhooks     │         │  - Transfer Service  │         │             │
└─────────────────┘         │  - API Clients       │         └─────────────┘
                            │  - SQLite DB         │
                            └──────────────────────┘
```

## Installation

### 1. Voraussetzungen

- Node.js 16+ und npm
- Fusion Manage Account mit API-Zugriff
- Dolibarr Installation mit aktiviertem REST API Modul

### 2. Projekt einrichten

```powershell
cd c:\Antigravity\ERP
npm install
```

### 3. Umgebungsvariablen konfigurieren

Kopieren Sie `.env.example` zu `.env` und tragen Sie Ihre Zugangsdaten ein:

```powershell
cp .env.example .env
```

Bearbeiten Sie `.env` mit Ihren Daten:

```env
# Fusion Manage API
FUSION_CLIENT_ID=your_client_id
FUSION_CLIENT_SECRET=your_client_secret
FUSION_WORKSPACE_ID=your_workspace_id

# Dolibarr API
DOLIBARR_API_URL=http://localhost:9030/dolibarr/api/index.php
DOLIBARR_API_KEY=your_api_key

# Webhook (optional für automatische Übertragung)
WEBHOOK_CALLBACK_URL=https://your-domain.com/webhook/fusion-manage
WEBHOOK_SECRET=your_secret

# Server
PORT=3000
```

### 4. Service starten

```powershell
npm start
```

Für Entwicklung mit Auto-Reload:

```powershell
npm run dev
```

## Konfiguration

### Fusion Manage API-Zugriff einrichten

1. Gehen Sie zu [Autodesk Platform Services](https://aps.autodesk.com/)
2. Erstellen Sie eine neue App
3. Notieren Sie Client ID und Client Secret
4. Aktivieren Sie die Scopes: `data:read`, `data:write`

### Dolibarr API aktivieren

1. Melden Sie sich als Administrator in Dolibarr an
2. Gehen Sie zu **Home → Setup → Modules/Applications**
3. Aktivieren Sie das **REST API** Modul
4. Gehen Sie zu **Benutzer → Ihr Profil → API Key**
5. Generieren Sie einen API-Schlüssel

### Webhook einrichten (optional)

Für automatische Übertragungen bei Änderungen:

1. **Entwicklung**: Verwenden Sie [ngrok](https://ngrok.com/) für eine öffentliche URL:
   ```powershell
   ngrok http 3000
   ```
   Tragen Sie die ngrok-URL in `WEBHOOK_CALLBACK_URL` ein

2. **Produktion**: Verwenden Sie Ihre öffentliche Domain

Der Webhook wird automatisch beim Start registriert.

## Verwendung

### Manuelle Übertragung (On-Demand)

#### Einzelne Stückliste übertragen

```powershell
curl -X POST http://localhost:3000/api/transfer/bom `
  -H "Content-Type: application/json" `
  -d '{
    "workspaceId": "YOUR_WORKSPACE_ID",
    "itemDmsId": "YOUR_ITEM_DMS_ID"
  }'
```

#### Batch-Übertragung

```powershell
curl -X POST http://localhost:3000/api/transfer/batch `
  -H "Content-Type: application/json" `
  -d '{
    "items": [
      {"workspaceId": "WS1", "itemDmsId": "ITEM1"},
      {"workspaceId": "WS1", "itemDmsId": "ITEM2"}
    ]
  }'
```

### Transfer-Historie abfragen

```powershell
# Letzte 50 Übertragungen
curl http://localhost:3000/api/transfer/history

# Spezifische Übertragung
curl http://localhost:3000/api/transfer/status/1

# Übertragung für bestimmtes Item
curl http://localhost:3000/api/transfer/item/WORKSPACE_ID/ITEM_DMS_ID
```

### Automatische Übertragung via Webhook

Wenn der Webhook konfiguriert ist, werden Stücklisten automatisch übertragen wenn:
- Ein Item in Fusion Manage aktualisiert wird
- Die Stückliste eines Items geändert wird

## API-Endpunkte

| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/` | API-Übersicht |
| GET | `/health` | Health Check |
| POST | `/api/transfer/bom` | Einzelne Stückliste übertragen |
| POST | `/api/transfer/batch` | Mehrere Stücklisten übertragen |
| GET | `/api/transfer/history` | Transfer-Historie abrufen |
| GET | `/api/transfer/status/:id` | Transfer-Status abrufen |
| GET | `/api/transfer/item/:workspaceId/:itemDmsId` | Transfer für Item abrufen |
| POST | `/webhook/fusion-manage` | Webhook-Callback (intern) |
| GET | `/webhook/status` | Webhook-Status prüfen |

Detaillierte API-Dokumentation: siehe [docs/API.md](docs/API.md)

## Datenstruktur-Mapping

### Fusion Manage → Dolibarr

| Fusion Manage | Dolibarr | Beschreibung |
|---------------|----------|--------------|
| Item | Product | Hauptprodukt |
| Item Number | Product Ref | Produktreferenz |
| Item Title | Product Label | Produktbezeichnung |
| BOM Items | BOM Lines | Stücklistenpositionen |
| Quantity | Qty | Menge |
| Custom Fields | Custom Fields | Benutzerdefinierte Felder |

## Logging

Logs werden gespeichert in:
- `logs/integration.log` - Alle Logs
- `logs/error.log` - Nur Fehler

Log-Level konfigurieren via `LOG_LEVEL` in `.env`:
- `error` - Nur Fehler
- `warn` - Warnungen und Fehler
- `info` - Informationen (Standard)
- `debug` - Detaillierte Debug-Informationen

## Datenbank

Transfer-Historie wird in SQLite gespeichert:
- Pfad: `data/transfers.db`
- Schema: siehe `src/database/schema.sql`

Die Datenbank enthält:
- Transfer-Status (success/failed/pending)
- Fusion Manage Item-Informationen
- Dolibarr BOM-IDs
- Fehlermeldungen
- BOM-Snapshots

## Fehlerbehandlung

Der Service ist robust gegen Fehler:

- **Authentifizierungsfehler**: Automatische Token-Erneuerung
- **Netzwerkfehler**: Detailliertes Logging, keine Abstürze
- **Fehlende Produkte**: Automatische Erstellung in Dolibarr
- **Webhook-Fehler**: Service läuft weiter im manuellen Modus

## Entwicklung

### Projektstruktur

```
c:\Antigravity\ERP\
├── config/
│   └── default.js          # Konfiguration
├── src/
│   ├── clients/
│   │   ├── fusionManageClient.js
│   │   └── dolibarrClient.js
│   ├── services/
│   │   ├── bomTransformer.js
│   │   └── transferService.js
│   ├── routes/
│   │   ├── transferApi.js
│   │   └── webhookHandler.js
│   ├── webhooks/
│   │   └── webhookManager.js
│   ├── database/
│   │   ├── schema.sql
│   │   └── db.js
│   ├── utils/
│   │   └── logger.js
│   ├── app.js
│   └── server.js
├── data/                   # SQLite Datenbank
├── logs/                   # Log-Dateien
├── .env                    # Umgebungsvariablen
└── package.json
```

## Troubleshooting

### Service startet nicht

1. Prüfen Sie die Konfiguration: `npm start` zeigt fehlende Variablen
2. Prüfen Sie die Logs in `logs/integration.log`
3. Stellen Sie sicher, dass Port 3000 frei ist

### Webhook wird nicht registriert

- Service läuft trotzdem im manuellen Modus
- Prüfen Sie `WEBHOOK_CALLBACK_URL` (muss öffentlich erreichbar sein)
- Prüfen Sie Fusion Manage API-Berechtigungen

### Übertragung schlägt fehl

1. Prüfen Sie Logs für Details
2. Prüfen Sie Transfer-Historie: `GET /api/transfer/history`
3. Stellen Sie sicher, dass Dolibarr API erreichbar ist
4. Prüfen Sie API-Schlüssel in beiden Systemen

### Produkte werden nicht gefunden

- Der Service erstellt automatisch fehlende Produkte in Dolibarr
- Prüfen Sie die Produktreferenzen (Item Numbers) in Fusion Manage

## Support & Weiterentwicklung

Mögliche Erweiterungen:
- Bidirektionale Synchronisation
- Geplante Synchronisation (Cron-Jobs)
- Web-UI für Monitoring
- Erweiterte Feldmappings
- Multi-Workspace-Support

## Lizenz

MIT
