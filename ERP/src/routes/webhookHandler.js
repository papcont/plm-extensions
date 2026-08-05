const express = require('express');
const transferService = require('../services/transferService');
const webhookManager = require('../webhooks/webhookManager');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /webhook/fusion-manage
 * Handle incoming webhooks from Fusion Manage
 */
router.post('/fusion-manage', async (req, res) => {
    try {
        const payload = req.body;
        const signature = req.headers['x-adsk-signature'];

        logger.info('Received webhook event from Fusion Manage');

        // Verify webhook signature
        if (!webhookManager.verifyWebhookSignature(payload, signature)) {
            logger.warn('Invalid webhook signature');
            return res.status(401).json({
                success: false,
                message: 'Invalid signature'
            });
        }

        // Respond immediately to acknowledge receipt
        res.status(200).json({
            success: true,
            message: 'Webhook received'
        });

        // Process webhook asynchronously
        processWebhookAsync(payload);

    } catch (error) {
        logger.error('Webhook handler error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * Process webhook payload asynchronously
 */
async function processWebhookAsync(payload) {
    try {
        logger.info('Processing webhook payload:', JSON.stringify(payload, null, 2));

        // Extract event information
        const event = payload.hook?.event;
        const resourceUrn = payload.payload?.resourceUrn;
        const workspaceId = payload.payload?.workspaceId;

        if (!event || !resourceUrn) {
            logger.warn('Invalid webhook payload - missing event or resourceUrn');
            return;
        }

        // Only process item.update events
        if (event !== 'item.update') {
            logger.info(`Ignoring event type: ${event}`);
            return;
        }

        // Extract item DMS ID from URN
        // URN format: urn:adsk.plm:tenant.workspace.item:TENANT.WORKSPACE.ITEM_DMS_ID
        const itemDmsId = extractItemDmsIdFromUrn(resourceUrn);

        if (!itemDmsId) {
            logger.warn(`Could not extract item DMS ID from URN: ${resourceUrn}`);
            return;
        }

        logger.info(`Processing item update for workspace: ${workspaceId}, item: ${itemDmsId}`);

        // Check if this item has a BOM (we could add additional filtering here)
        // For now, we'll attempt to transfer any item update

        // Trigger BOM transfer
        const result = await transferService.transferBOM(workspaceId, itemDmsId);

        if (result.success) {
            logger.info(`Webhook-triggered BOM transfer completed: ${itemDmsId}`);
        } else {
            logger.warn(`Webhook-triggered BOM transfer failed: ${result.message}`);
        }

    } catch (error) {
        logger.error('Async webhook processing error:', error);
    }
}

/**
 * Extract item DMS ID from Fusion Manage URN
 */
function extractItemDmsIdFromUrn(urn) {
    try {
        // URN format: urn:adsk.plm:tenant.workspace.item:TENANT.WORKSPACE.ITEM_DMS_ID
        const parts = urn.split(':');
        if (parts.length >= 3) {
            const idParts = parts[parts.length - 1].split('.');
            return idParts[idParts.length - 1];
        }
        return null;
    } catch (error) {
        logger.error('Failed to extract DMS ID from URN:', error);
        return null;
    }
}

/**
 * GET /webhook/status
 * Check webhook registration status
 */
router.get('/status', async (req, res) => {
    try {
        const webhooks = await webhookManager.listWebhooks();

        res.json({
            success: true,
            registered: webhooks.length > 0,
            webhooks
        });
    } catch (error) {
        logger.error('Webhook status error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
