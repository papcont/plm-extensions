const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const logger = require('./utils/logger');

// Import routes
const transferApi = require('./routes/transferApi');
const webhookHandler = require('./routes/webhookHandler');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'fusion-dolibarr-integration'
    });
});

// Mount routes
app.use('/api/transfer', transferApi);
app.use('/webhook', webhookHandler);

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        service: 'Fusion Manage to Dolibarr BOM Integration',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            transfer: {
                single: 'POST /api/transfer/bom',
                batch: 'POST /api/transfer/batch',
                history: 'GET /api/transfer/history',
                status: 'GET /api/transfer/status/:id',
                item: 'GET /api/transfer/item/:workspaceId/:itemDmsId'
            },
            webhook: {
                callback: 'POST /webhook/fusion-manage',
                status: 'GET /webhook/status'
            }
        }
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error'
    });
});

module.exports = app;
