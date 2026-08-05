# API Documentation

Complete API reference for the Fusion Manage to Dolibarr BOM Integration Service.

## Base URL

```
http://localhost:3000
```

## Authentication

Currently, the API does not require authentication for local use. For production deployment, consider adding API key authentication.

---

## Transfer API

### Transfer Single BOM

Transfer a single Bill of Materials from Fusion Manage to Dolibarr.

**Endpoint:** `POST /api/transfer/bom`

**Request Body:**
```json
{
  "workspaceId": "string",
  "itemDmsId": "string"
}
```

**Response:**
```json
{
  "success": true,
  "message": "BOM transferred successfully",
  "dolibarrBomId": 123,
  "itemsTransferred": 5
}
```

**Error Response:**
```json
{
  "success": false,
  "message": "Error description"
}
```

---

### Batch Transfer

Transfer multiple BOMs in a single request.

**Endpoint:** `POST /api/transfer/batch`

**Request Body:**
```json
{
  "items": [
    {
      "workspaceId": "string",
      "itemDmsId": "string"
    },
    {
      "workspaceId": "string",
      "itemDmsId": "string"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Transferred 2 of 2 BOMs",
  "results": [
    {
      "workspaceId": "string",
      "itemDmsId": "string",
      "success": true,
      "dolibarrBomId": 123,
      "itemsTransferred": 5
    }
  ]
}
```

---

### Get Transfer History

Retrieve transfer history with optional limit.

**Endpoint:** `GET /api/transfer/history`

**Query Parameters:**
- `limit` (optional): Number of records to return (default: 50)

**Response:**
```json
{
  "success": true,
  "count": 10,
  "history": [
    {
      "id": 1,
      "fusion_workspace_id": "string",
      "fusion_item_dms_id": "string",
      "fusion_item_title": "Product Name",
      "dolibarr_bom_id": 123,
      "status": "success",
      "error_message": null,
      "transferred_at": "2025-11-26T14:00:00.000Z",
      "bom_snapshot": "{...}"
    }
  ]
}
```

---

### Get Transfer Status

Get details of a specific transfer by ID.

**Endpoint:** `GET /api/transfer/status/:id`

**Parameters:**
- `id`: Transfer ID

**Response:**
```json
{
  "success": true,
  "transfer": {
    "id": 1,
    "fusion_workspace_id": "string",
    "fusion_item_dms_id": "string",
    "fusion_item_title": "Product Name",
    "dolibarr_bom_id": 123,
    "status": "success",
    "error_message": null,
    "transferred_at": "2025-11-26T14:00:00.000Z",
    "bom_snapshot": "{...}"
  }
}
```

---

### Get Transfer by Fusion Item

Get the most recent transfer for a specific Fusion Manage item.

**Endpoint:** `GET /api/transfer/item/:workspaceId/:itemDmsId`

**Parameters:**
- `workspaceId`: Fusion Manage workspace ID
- `itemDmsId`: Fusion Manage item DMS ID

**Response:**
```json
{
  "success": true,
  "transfer": {
    "id": 1,
    "fusion_workspace_id": "string",
    "fusion_item_dms_id": "string",
    "fusion_item_title": "Product Name",
    "dolibarr_bom_id": 123,
    "status": "success",
    "error_message": null,
    "transferred_at": "2025-11-26T14:00:00.000Z"
  }
}
```

---

## Webhook API

### Webhook Callback

Internal endpoint for receiving webhooks from Fusion Manage. This endpoint is called automatically by Autodesk Platform Services.

**Endpoint:** `POST /webhook/fusion-manage`

**Headers:**
- `x-adsk-signature`: Webhook signature for verification

**Request Body:**
```json
{
  "hook": {
    "event": "item.update"
  },
  "payload": {
    "resourceUrn": "urn:adsk.plm:tenant.workspace.item:...",
    "workspaceId": "string"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook received"
}
```

---

### Webhook Status

Check webhook registration status.

**Endpoint:** `GET /webhook/status`

**Response:**
```json
{
  "success": true,
  "registered": true,
  "webhooks": [
    {
      "hookId": "string",
      "callbackUrl": "https://your-domain.com/webhook/fusion-manage",
      "event": "item.update"
    }
  ]
}
```

---

## Utility Endpoints

### Health Check

Check if the service is running.

**Endpoint:** `GET /health`

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-26T14:00:00.000Z",
  "service": "fusion-dolibarr-integration"
}
```

---

### API Overview

Get an overview of all available endpoints.

**Endpoint:** `GET /`

**Response:**
```json
{
  "service": "Fusion Manage to Dolibarr BOM Integration",
  "version": "1.0.0",
  "endpoints": {
    "health": "/health",
    "transfer": {
      "single": "POST /api/transfer/bom",
      "batch": "POST /api/transfer/batch",
      "history": "GET /api/transfer/history",
      "status": "GET /api/transfer/status/:id",
      "item": "GET /api/transfer/item/:workspaceId/:itemDmsId"
    },
    "webhook": {
      "callback": "POST /webhook/fusion-manage",
      "status": "GET /webhook/status"
    }
  }
}
```

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Missing or invalid parameters |
| 401 | Unauthorized - Invalid webhook signature |
| 404 | Not Found - Resource not found |
| 500 | Internal Server Error - Server-side error |

---

## Examples

### PowerShell Examples

#### Transfer a BOM
```powershell
$body = @{
    workspaceId = "YOUR_WORKSPACE_ID"
    itemDmsId = "YOUR_ITEM_DMS_ID"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/transfer/bom" `
    -Method Post `
    -Body $body `
    -ContentType "application/json"
```

#### Get Transfer History
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/transfer/history?limit=10" `
    -Method Get
```

### JavaScript/Node.js Examples

#### Transfer a BOM
```javascript
const axios = require('axios');

async function transferBOM() {
  const response = await axios.post('http://localhost:3000/api/transfer/bom', {
    workspaceId: 'YOUR_WORKSPACE_ID',
    itemDmsId: 'YOUR_ITEM_DMS_ID'
  });
  
  console.log(response.data);
}
```

#### Batch Transfer
```javascript
async function batchTransfer() {
  const response = await axios.post('http://localhost:3000/api/transfer/batch', {
    items: [
      { workspaceId: 'WS1', itemDmsId: 'ITEM1' },
      { workspaceId: 'WS1', itemDmsId: 'ITEM2' }
    ]
  });
  
  console.log(response.data);
}
```
