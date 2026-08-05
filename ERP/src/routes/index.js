const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const logger = require('./../logger');
const { config } = require('./../config');
const syncRoutes = require('./syncRoutes');
const authRoutes = require('./authRoutes');
const { syncBomFromFusionToDolibarr } = require('./../services/bomSyncService');
const rawBodyParser = require('./../middleware/rawBodyParser');

// Mount auth routes
router.use('/auth', authRoutes);

// Mount sync routes
router.use('/sync', syncRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'fusion-dolibarr-integration'
  });
});

/**
 * POST /webhook/fusion-manage
 * Webhook endpoint for Fusion Manage to trigger BOM synchronization
 * 
 * @route POST /webhook/fusion-manage
 * @body {Object} - Webhook payload with event, itemId, signature, etc.
 */
router.post('/webhook/fusion-manage', rawBodyParser, async (req, res, next) => {
  try {
    logger.info('Webhook received from Fusion Manage');

    // Parse JSON body (rawBody is already captured by middleware)
    let payload;
    try {
      payload = JSON.parse(req.rawBody.toString('utf8'));
    } catch (parseError) {
      logger.error('Failed to parse webhook payload', { error: parseError.message });
      return res.status(400).json({
        status: 'error',
        message: 'Invalid JSON payload'
      });
    }

    const { event, itemId, workspaceId, timestamp, signature } = payload;

    logger.debug('Webhook payload received', {
      event,
      itemId,
      workspaceId,
      timestamp
    });

    // Validate required fields
    if (!event || !itemId) {
      logger.warn('Webhook payload missing required fields', { event, itemId });
      return res.status(400).json({
        status: 'error',
        message: 'Missing required fields: event and itemId'
      });
    }

    // Validate event type
    const validEvents = ['ITEM_UPDATED', 'BOM_UPDATED'];
    if (!validEvents.includes(event)) {
      logger.warn('Webhook received invalid event type', { event });
      return res.status(400).json({
        status: 'error',
        message: `Invalid event type. Expected one of: ${validEvents.join(', ')}`
      });
    }

    // Verify signature if webhook secret is configured
    if (config.webhook.secret) {
      if (!signature) {
        logger.warn('Webhook signature missing but secret is configured');
        return res.status(401).json({
          status: 'error',
          message: 'Signature required'
        });
      }

      // Calculate HMAC-SHA256 signature
      const calculatedSignature = crypto
        .createHmac('sha256', config.webhook.secret)
        .update(req.rawBody)
        .digest('hex');

      // Compare signatures (constant-time comparison to prevent timing attacks)
      const signatureValid = crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(calculatedSignature, 'hex')
      );

      if (!signatureValid) {
        logger.warn('Webhook signature validation failed', {
          received: signature,
          calculated: calculatedSignature
        });
        return res.status(401).json({
          status: 'error',
          message: 'Invalid signature'
        });
      }

      logger.debug('Webhook signature validated successfully');
    } else {
      logger.warn('Webhook secret not configured - skipping signature validation');
    }

    // Trigger BOM synchronization
    logger.info(`Triggering BOM sync for item ${itemId} via webhook`, {
      event,
      itemId
    });

    try {
      const result = await syncBomFromFusionToDolibarr({ itemId });

      logger.info('Webhook-triggered BOM sync completed successfully', {
        itemId,
        dolibarrProductRef: result.dolibarrProductRef,
        dolibarrBomId: result.dolibarrBomId
      });

      return res.status(200).json({
        status: 'ok',
        message: 'BOM sync triggered successfully',
        data: {
          fusionItemId: result.fusionItemId,
          dolibarrProductRef: result.dolibarrProductRef,
          dolibarrBomId: result.dolibarrBomId
        }
      });
    } catch (syncError) {
      // Error is already logged in syncBomFromFusionToDolibarr
      logger.error('Webhook-triggered BOM sync failed', {
        itemId,
        error: syncError.message
      });

      // Return error but don't expose internal details
      return res.status(500).json({
        status: 'error',
        message: 'BOM sync failed',
        itemId: itemId
      });
    }
  } catch (error) {
    logger.error('Webhook processing error', {
      error: error.message,
      stack: config.server.env !== 'production' ? error.stack : undefined
    });
    
    // Error will be handled by errorHandler middleware
    next(error);
  }
});

module.exports = router;

