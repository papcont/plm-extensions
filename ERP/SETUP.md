# Fusion Manage to Dolibarr BOM Integration - Setup Guide

## Ihre Fusion Manage Konfiguration

Basierend auf Ihrer Postman Collection und Workspace-Konfiguration:

- **Tenant**: `previewdickmans.autodeskplm360.net`
- **Workspace ID (Items)**: `57` - Hier befinden sich Ihre Produkte und Stücklisten
- **Base URL**: `https://previewdickmans.autodeskplm360.net`

### Weitere verfügbare Workspaces

- Workspace ID `84` - Change Orders
- Workspace ID `82` - Problem Reports
- Workspace ID `86` - Projects

## Schnellstart

### 1. Autodesk Platform Services App erstellen

1. Gehen Sie zu [https://aps.autodesk.com](https://aps.autodesk.com)
2. Klicken Sie auf "Go to my apps"
3. Erstellen Sie eine neue Application (Default Type)
4. Fügen Sie diese Callback URLs hinzu:
   - `https://www.getpostman.com/oauth2/callback`
   - `https://oauth.pstmn.io/v1/browser-callback`
5. Kopieren Sie **Client ID** und **Client Secret**
6. Whitelisten Sie die Client ID in den Fusion Manage General Settings

### 2. Dolibarr API Key generieren

1. Melden Sie sich als Administrator in Dolibarr an
2. Gehen Sie zu **Home → Setup → Modules/Applications**
3. Aktivieren Sie das **REST API** Modul
4. Gehen Sie zu **Benutzer → Ihr Profil → API Key**
5. Generieren Sie einen API-Schlüssel

### 3. Konfiguration erstellen

```powershell
# Kopieren Sie die Beispiel-Konfiguration
cp .env.example .env

# Bearbeiten Sie .env und tragen Sie ein:
# - FUSION_CLIENT_ID (von APS)
# - FUSION_CLIENT_SECRET (von APS)
# - DOLIBARR_API_KEY (von Dolibarr)
```

Die Workspace ID (57) und Tenant-URL sind bereits vorkonfiguriert!

### 4. Service starten

```powershell
npm start
```

### 5. Erste BOM übertragen

```powershell
# Beispiel mit DMS ID 14669 (aus Ihrer Postman Collection)
curl -X POST http://localhost:3000/api/transfer/bom `
  -H "Content-Type: application/json" `
  -d '{"workspaceId": "57", "itemDmsId": "14669"}'
```

## API Endpunkte

Alle Endpunkte sind in der [API.md](docs/API.md) dokumentiert.

### Wichtigste Endpunkte

- `POST /api/transfer/bom` - Einzelne Stückliste übertragen
- `GET /api/transfer/history` - Transfer-Historie anzeigen
- `GET /health` - Service-Status prüfen

## Webhook Setup (Optional)

Für automatische Übertragungen bei Änderungen in Fusion Manage:

### Entwicklung (mit ngrok)

```powershell
# ngrok installieren und starten
ngrok http 3000

# In .env eintragen:
WEBHOOK_CALLBACK_URL=https://your-ngrok-url.ngrok.io/webhook/fusion-manage
```

### Produktion

1. Konfigurieren Sie einen Reverse Proxy (nginx/IIS)
2. Richten Sie ein SSL-Zertifikat ein
3. Tragen Sie die öffentliche URL in `.env` ein

Der Webhook wird automatisch beim Service-Start registriert und hört auf `item.update` Events in Workspace 57.

## Weitere Dokumentation

- [README.md](README.md) - Vollständige Dokumentation
- [docs/API.md](docs/API.md) - API-Referenz
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment-Optionen

## Support

Bei Fragen zur Konfiguration siehe die ausführliche Dokumentation in den oben genannten Dateien.
