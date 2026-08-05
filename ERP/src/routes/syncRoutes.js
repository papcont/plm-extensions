/**
 * Sync Routes
 * 
 * These routes handle BOM synchronization between Fusion Manage and Dolibarr.
 * All routes that interact with Fusion Manage require authentication via 3-legged OAuth.
 * 
 * Testing Guide:
 * ==============
 * 1. Start the server: npm start
 * 2. Open browser and navigate to: http://localhost:3000/auth/login
 *    - This will redirect you to Autodesk Platform Services for authentication
 *    - After successful login, you'll be redirected back with a session token
 * 3. Test Fusion Manage API access:
 *    - GET http://localhost:3000/api/sync/test/fusion/:itemId
 *    - Example: GET http://localhost:3000/api/sync/test/fusion/12345
 * 4. Trigger BOM synchronization:
 *    - POST http://localhost:3000/api/sync/bom/:itemId
 *    - Example: POST http://localhost:3000/api/sync/bom/12345
 *    - Optional: Add ?dryRun=true for dry run mode
 * 
 * Note: If you receive 401 errors, make sure you've logged in via /auth/login first.
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { config } = require('../config');
const { 
  getTransferHistoryByItem,
  getAllScheduledItems,
  addScheduledItem,
  deleteScheduledItem,
  updateScheduledItem
} = require('../db/sqlite');
const { syncBomFromFusionToDolibarr } = require('../services/bomSyncService');
const fusionClient = require('../services/fusionClient');

/**
 * Helper function to check and validate access token from session
 * @param {Object} req - Express request object
 * @returns {Object} - { valid: boolean, token: string|null, error: string|null }
 */
function validateAccessToken(req) {
  const accessToken = req.session?.fusionAccessToken;
  const expiresAt = req.session?.fusionTokenExpiresAt;
  
  // Check if token exists
  if (!accessToken) {
    logger.warn('Access token not found in session', {
      hasSession: !!req.session,
      sessionKeys: req.session ? Object.keys(req.session) : []
    });
    return {
      valid: false,
      token: null,
      error: 'Not authenticated. Please log in via /auth/login first.'
    };
  }
  
  // Check if token is expired
  if (expiresAt && Date.now() >= expiresAt) {
    logger.warn('Access token expired', {
      expiresAt: new Date(expiresAt).toISOString(),
      now: new Date().toISOString()
    });
    return {
      valid: false,
      token: null,
      error: 'Token expired, please log in again.'
    };
  }
  
  return {
    valid: true,
    token: accessToken,
    error: null
  };
}

/**
 * GET /api/sync/bom/:param/progress
 * Server-Sent Events (SSE) endpoint for BOM sync progress
 * Requires authentication via 3-legged OAuth (session token)
 * 
 * @route GET /api/sync/bom/:param/progress
 * @param {string} param - Fusion Manage item ID (dmsId) or item number
 * @query {boolean} [dryRun] - If true, perform dry run
 */
router.get('/bom/:param/progress', async (req, res, next) => {
  try {
    const { param } = req.params;
    const dryRun = req.query.dryRun === 'true';
    
    // Validate access token from session
    const tokenValidation = validateAccessToken(req);
    if (!tokenValidation.valid) {
      logger.warn(`BOM sync progress requested without valid access token for param: ${param}`, {
        error: tokenValidation.error
      });
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`data: ${JSON.stringify({ 
        step: 'error', 
        message: tokenValidation.error, 
        percent: null,
        error: {
          message: tokenValidation.error,
          status: 401
        }
      })}\n\n`);
      res.end();
      return;
    }
    
    const accessToken = tokenValidation.token;
    
    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ step: 'init', message: 'Verbindung hergestellt...', percent: 0 })}\n\n`);
    
    // Progress callback function
    const onProgress = (progress) => {
      try {
        // Ensure progress object has required fields
        const progressPayload = {
          step: progress.step || progress.phase || 'progress',
          message: progress.message || 'Verarbeite...',
          percent: progress.percent !== undefined ? progress.percent : (progress.phasePercent !== undefined ? progress.phasePercent : null),
          current: progress.current !== undefined ? progress.current : null,
          total: progress.total !== undefined ? progress.total : null,
          ...progress // Include all other fields
        };
        
        const data = JSON.stringify(progressPayload);
        res.write(`data: ${data}\n\n`);
        logger.debug('Sent SSE progress update', { 
          step: progressPayload.step, 
          percent: progressPayload.percent,
          current: progressPayload.current,
          total: progressPayload.total
        });
      } catch (err) {
        logger.error('Error sending progress update', { error: err.message, progress });
      }
    };
    
    // Run sync in background and send progress updates
    syncBomFromFusionToDolibarr({ 
      param, 
      accessToken,
      dryRun: dryRun,
      onProgress: onProgress
    })
      .then((result) => {
        try {
          // Send final success message with syncResult
          // Note: bomSyncService already sends a 'complete' event with syncResult,
          // but we send one here as well in case the service doesn't send it
          const completePayload = {
            step: 'complete',
            message: 'Synchronisierung erfolgreich abgeschlossen',
            percent: 100
          };
          
          // Include syncResult if it exists and is valid
          if (result && typeof result === 'object') {
            completePayload.syncResult = result;
          }
          
          res.write(`data: ${JSON.stringify(completePayload)}\n\n`);
          logger.debug('Sent SSE complete event', { hasSyncResult: !!result });
          res.end();
        } catch (writeError) {
          logger.error('Error writing SSE complete event', { error: writeError.message });
          if (!res.headersSent) {
            res.end();
          }
        }
      })
      .catch((error) => {
        try {
          // Send error message
          logger.error(`BOM sync failed in SSE endpoint for param: ${param}`, {
            source: error.source || 'unknown',
            operation: error.operation || 'syncBomFromFusionToDolibarr',
            code: error.code,
            status: error.status,
            type: error.type,
            message: error.message
          });
          
          const errorPayload = {
            step: 'error',
            message: error.message || 'Synchronisierung fehlgeschlagen',
            percent: null,
            error: {
              message: error.message,
              code: error.code,
              status: error.status
            }
          };
          
          res.write(`data: ${JSON.stringify(errorPayload)}\n\n`);
          res.end();
        } catch (writeError) {
          logger.error('Error writing SSE error event', { error: writeError.message });
          if (!res.headersSent) {
            res.end();
          }
        }
      });
    
    // Handle client disconnect
    req.on('close', () => {
      logger.debug('Client disconnected from progress stream', { param });
      res.end();
    });
    
  } catch (error) {
    logger.error(`Error in BOM sync progress endpoint for param: ${req.params.param}`, {
      error: error.message
    });
    
    if (!res.headersSent) {
      res.writeHead(500, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
    }
    
    res.write(`data: ${JSON.stringify({ 
      step: 'error', 
      message: error.message || 'Interner Fehler', 
      percent: null
    })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/sync/bom/:param
 * Synchronize BOM from Fusion Manage to Dolibarr
 * Requires authentication via 3-legged OAuth (session token)
 * 
 * Supports both DMS-ID (numeric) and item number (e.g., "ADSK-011001")
 * 
 * @route POST /api/sync/bom/:param
 * @param {string} param - Fusion Manage item ID (dmsId) or item number
 * @body {boolean} [dryRun] - If true, perform dry run
 */
router.post('/bom/:param', async (req, res, next) => {
  try {
    const { param } = req.params;
    const dryRun = req.query.dryRun === 'true' || req.body?.dryRun === true;
    
    // Validate access token from session
    const tokenValidation = validateAccessToken(req);
    if (!tokenValidation.valid) {
      logger.warn(`BOM sync requested without valid access token for param: ${param}`, {
        error: tokenValidation.error
      });
      return res.status(401).json({
        status: 'error',
        error: tokenValidation.error
      });
    }
    
    const accessToken = tokenValidation.token;
    
    logger.info(`BOM sync requested`, { 
      param,
      dryRun: dryRun,
      hasAccessToken: !!accessToken
    });
    
    // Call sync service with param (can be ID or item number)
    const result = await syncBomFromFusionToDolibarr({ 
      param, 
      accessToken,
      dryRun: dryRun
    });
    
    // Ensure result is defined
    if (!result) {
      logger.error('Sync service returned undefined result', { param });
      return res.status(500).json({
        status: 'error',
        error: 'Internal server error: sync service returned no result'
      });
    }
    
    logger.info(`BOM sync completed successfully`, {
      param,
      status: result.status,
      fusionItemId: result.fusionItemId,
      parentNumber: result.parentNumber || result.parent?.fusionNumber,
      bomLinesPlanned: result.bomLinesPlanned || result.bom?.linesPlanned || 0,
      bomLinesWritten: result.bomLinesWritten || result.bom?.linesWritten || 0,
      dolibarrBomId: result.bom?.dolibarrBomId
    });
    
    // Return result wrapped in standard response format
    res.status(200).json({
      status: 'ok',
      result: result
    });
  } catch (error) {
    // Log error details
    logger.error(`BOM sync failed for param: ${req.params.param}`, {
      source: error.source || 'unknown',
      operation: error.operation || 'syncBomFromFusionToDolibarr',
      code: error.code,
      status: error.status,
      type: error.type,
      message: error.message
    });
    
    // Handle NOT_FOUND errors with 404 status
    if (error.type === 'NOT_FOUND' || error.code === 'NOT_FOUND') {
      return res.status(404).json({
        status: 'error',
        message: `Item not found: ${req.params.param}`,
        code: 'NOT_FOUND'
      });
    }
    
    // Return structured error response with readable message
    const statusCode = error.status && error.status >= 400 && error.status < 600 
      ? error.status 
      : 500;
    
    return res.status(statusCode).json({
      status: 'error',
      message: error.message || 'BOM sync failed',
      code: error.code || null,
      details: error.details || null
    });
  }
});

/**
 * GET /api/sync/history/:itemId
 * Get transfer history for a specific Fusion Manage item
 * 
 * @route GET /api/sync/history/:itemId
 * @param {string} itemId - Fusion Manage item ID (dmsId)
 */
router.get('/history/:itemId', async (req, res, next) => {
  try {
    const { itemId } = req.params;
    
    logger.debug(`Fetching transfer history for item: ${itemId}`);
    
    const history = await getTransferHistoryByItem(itemId);
    
    res.json({
      itemId: itemId,
      count: history.length,
      history: history
    });
  } catch (error) {
    // Error will be handled by errorHandler middleware
    next(error);
  }
});

/**
 * GET /api/sync/scheduled
 * Get all scheduled items
 * 
 * @route GET /api/sync/scheduled
 */
router.get('/scheduled', async (req, res, next) => {
  try {
    logger.debug('Fetching all scheduled items');
    
    const scheduledItems = await getAllScheduledItems();
    
    res.json({
      count: scheduledItems.length,
      items: scheduledItems
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/sync/scheduled
 * Add a new scheduled item
 * 
 * @route POST /api/sync/scheduled
 * @body {Object} - { itemId, enabled? }
 */
router.post('/scheduled', async (req, res, next) => {
  try {
    const { itemId, enabled = true } = req.body;
    
    if (!itemId) {
      return res.status(400).json({
        status: 'error',
        message: 'itemId is required'
      });
    }
    
    logger.info(`Adding scheduled item: ${itemId}`, { enabled });
    
    const id = await addScheduledItem({ fusionItemId: itemId, enabled });
    
    res.status(201).json({
      status: 'ok',
      message: 'Scheduled item added',
      data: {
        id,
        fusionItemId: itemId,
        enabled
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/sync/scheduled/:id
 * Delete a scheduled item
 * 
 * @route DELETE /api/sync/scheduled/:id
 * @param {number} id - Scheduled item ID
 */
router.delete('/scheduled/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const itemId = parseInt(id, 10);
    
    if (isNaN(itemId)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid scheduled item ID'
      });
    }
    
    logger.info(`Deleting scheduled item: ${itemId}`);
    
    const deleted = await deleteScheduledItem(itemId);
    
    if (!deleted) {
      return res.status(404).json({
        status: 'error',
        message: 'Scheduled item not found'
      });
    }
    
    res.json({
      status: 'ok',
      message: 'Scheduled item deleted'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/test/fusion/:itemId
 * Test endpoint to verify Fusion Manage API access
 * Requires authentication via 3-legged OAuth (session token)
 * Returns raw item data and BOM preview from Fusion Manage
 * 
 * @route GET /api/test/fusion/:itemId
 * @param {string} itemId - Fusion Manage item ID (dmsId)
 */
router.get('/test/fusion/:itemId', async (req, res, next) => {
  try {
    const { itemId } = req.params;
    
    // Validate access token from session
    const tokenValidation = validateAccessToken(req);
    if (!tokenValidation.valid) {
      logger.warn(`Test endpoint: Access token validation failed for item: ${itemId}`, {
        error: tokenValidation.error
      });
      return res.status(401).json({
        status: 'error',
        error: tokenValidation.error
      });
    }
    
    const accessToken = tokenValidation.token;
    
    logger.info(`Test endpoint: Fetching Fusion Manage item ${itemId}`, {
      hasAccessToken: !!accessToken
    });
    
    // Call fusionClient to get item with access token
    const item = await fusionClient.getItemById(itemId, accessToken);
    
    logger.info(`Test endpoint: Successfully retrieved item ${itemId}`, {
      itemNumber: item.itemNumber,
      description: item.description
    });
    
    // Try to get BOM preview
    let bomPreview = null;
    try {
      const bomLines = await fusionClient.getBomForItem(itemId, accessToken);
      // getBomForItem returns FusionBomLine[] directly
      const bomLinesArray = Array.isArray(bomLines) ? bomLines : [];
      bomPreview = {
        lineCount: bomLinesArray.length,
        items: bomLinesArray.slice(0, 3) // First 3 entries for preview
      };
      logger.info(`Test endpoint: BOM preview retrieved`, {
        itemId,
        bomLineCount: bomLinesArray.length
      });
    } catch (bomError) {
      // Log but don't fail the request if BOM fetch fails
      logger.warn(`Test endpoint: Could not retrieve BOM preview`, {
        itemId,
        error: bomError.message,
        code: bomError.code
      });
      bomPreview = {
        error: bomError.message,
        code: bomError.code
      };
    }
    
    // Return raw item data with BOM preview
    res.json({
      status: 'ok',
      message: 'Fusion Manage API access successful',
      itemId: itemId,
      data: item,
      bom: bomPreview
    });
  } catch (error) {
    // Log error details
    logger.error(`Test endpoint: Failed to retrieve item ${req.params.itemId}`, {
      source: error.source || 'unknown',
      operation: error.operation || 'getItemById',
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details
    });
    
    // Error will be handled by errorHandler middleware
    next(error);
  }
});

/**
 * GET /api/debug/fusion/bom/:id
 * Debug endpoint to test BOM extraction from Fusion Manage
 * Returns raw BOM data from getBomForItem for inspection
 * 
 * @route GET /api/debug/fusion/bom/:id
 * @param {string} id - Fusion Manage item ID (dmsId) or item number
 */
router.get('/debug/fusion/bom/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Validate access token from session
    const tokenValidation = validateAccessToken(req);
    if (!tokenValidation.valid) {
      logger.warn(`Debug endpoint: Access token validation failed for item: ${id}`, {
        error: tokenValidation.error
      });
      return res.status(401).json({
        status: 'error',
        error: tokenValidation.error
      });
    }
    
    const accessToken = tokenValidation.token;
    
    logger.info(`Debug endpoint: Fetching BOM for Fusion Manage item ${id}`, {
      hasAccessToken: !!accessToken
    });
    
    // Resolve id (can be DMS-ID or item number) using fusionClient
    // First try as item number, then as ID
    let itemId = id;
    try {
      const found = await fusionClient.searchItemByNumber(id, accessToken);
      if (found) {
        itemId = found.itemId || found.dmsId || id;
        logger.debug('Debug endpoint: Resolved item number to ID', {
          itemNumber: id,
          itemId: itemId
        });
      }
    } catch (searchError) {
      // If search fails, treat id as numeric ID
      logger.debug('Debug endpoint: Treating param as item ID', {
        param: id
      });
    }
    
    // Call getBomForItem to get BOM data
    const bomLines = await fusionClient.getBomForItem(itemId, accessToken);
    
    logger.info(`Debug endpoint: Successfully retrieved BOM for item ${id}`, {
      bomLineCount: Array.isArray(bomLines) ? bomLines.length : 0
    });
    
    // Return BOM data as JSON
    res.json({
      status: 'ok',
      message: 'BOM data retrieved successfully',
      itemId: id,
      bomLineCount: Array.isArray(bomLines) ? bomLines.length : 0,
      bomLines: bomLines
    });
  } catch (error) {
    // Log error details
    logger.error(`Debug endpoint: Failed to retrieve BOM for item ${req.params.id}`, {
      source: error.source || 'unknown',
      operation: error.operation || 'getBomForItem',
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details
    });
    
    // Return error response
    if (error.type === 'NOT_FOUND' || error.code === 'NOT_FOUND') {
      return res.status(404).json({
        status: 'error',
        error: `Item not found: ${req.params.id}`,
        code: 'NOT_FOUND'
      });
    }
    
    // Error will be handled by errorHandler middleware
    next(error);
  }
});

/**
 * GET /api/sync/config/dolibarr-url
 * Get Dolibarr base URL for frontend (extracted from DOLIBARR_API_URL)
 * 
 * @route GET /api/sync/config/dolibarr-url
 */
router.get('/config/dolibarr-url', (req, res) => {
  try {
    const apiUrl = config.dolibarr.apiUrl;
    if (!apiUrl) {
      return res.status(500).json({
        status: 'error',
        message: 'DOLIBARR_API_URL not configured'
      });
    }
    
    // Extract base URL by removing /api/index.php or /api/
    // Example: http://localhost:3030/dolibarr/api/index.php -> http://localhost:3030/dolibarr
    let baseUrl = apiUrl;
    if (baseUrl.includes('/api/')) {
      baseUrl = baseUrl.split('/api/')[0];
    }
    
    res.json({
      status: 'ok',
      baseUrl: baseUrl
    });
  } catch (error) {
    logger.error('Error getting Dolibarr base URL', { error: error.message });
    res.status(500).json({
      status: 'error',
      message: 'Failed to get Dolibarr base URL'
    });
  }
});

module.exports = router;
