const express = require('express');
const transferService = require('../services/transferService');
const logger = require('../utils/logger');
const database = require('../database/db');

const router = express.Router();

/**
 * POST /api/transfer/bom
 * Transfer a single BOM from Fusion Manage to Dolibarr
 */
router.post('/bom', async (req, res) => {
    try {
        const { workspaceId, itemDmsId } = req.body;

        if (!workspaceId || !itemDmsId) {
            return res.status(400).json({
                success: false,
                message: 'workspaceId and itemDmsId are required'
            });
        }

        logger.info(`Manual BOM transfer requested: ${workspaceId}/${itemDmsId}`);

        const result = await transferService.transferBOM(workspaceId, itemDmsId);

        res.json(result);
    } catch (error) {
        logger.error('Transfer API error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * POST /api/transfer/batch
 * Transfer multiple BOMs in batch
 */
router.post('/batch', async (req, res) => {
    try {
        const { items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'items array is required'
            });
        }

        logger.info(`Batch transfer requested for ${items.length} items`);

        const results = await transferService.batchTransfer(items);

        const successCount = results.filter(r => r.success).length;

        res.json({
            success: true,
            message: `Transferred ${successCount} of ${items.length} BOMs`,
            results
        });
    } catch (error) {
        logger.error('Batch transfer API error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/transfer/history
 * Get transfer history
 */
router.get('/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const history = await database.getTransferHistory(limit);

        res.json({
            success: true,
            count: history.length,
            history
        });
    } catch (error) {
        logger.error('History API error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/transfer/status/:id
 * Get transfer status by ID
 */
router.get('/status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const transfer = await database.getTransferById(id);

        if (!transfer) {
            return res.status(404).json({
                success: false,
                message: 'Transfer not found'
            });
        }

        res.json({
            success: true,
            transfer
        });
    } catch (error) {
        logger.error('Status API error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

/**
 * GET /api/transfer/item/:workspaceId/:itemDmsId
 * Get transfer history for a specific Fusion item
 */
router.get('/item/:workspaceId/:itemDmsId', async (req, res) => {
    try {
        const { workspaceId, itemDmsId } = req.params;
        const transfer = await database.getTransferByFusionItem(workspaceId, itemDmsId);

        if (!transfer) {
            return res.status(404).json({
                success: false,
                message: 'No transfer found for this item'
            });
        }

        res.json({
            success: true,
            transfer
        });
    } catch (error) {
        logger.error('Item transfer lookup error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
