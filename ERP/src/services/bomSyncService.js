const logger = require('../logger');
const fusionClient = require('./fusionClient');
const dolibarrClient = require('./dolibarrClient');
const { logTransfer } = require('../db/sqlite');

/**
 * Check if error is a client error (4xx) that should be logged at warn level
 * @param {Error} error - Error object with code and status
 * @returns {boolean} - True if it's a client error
 */
function isClientError(error) {
  return error.status && error.status >= 400 && error.status < 500;
}

/**
 * Extract parent number and label from Fusion Manage item
 * Uses robust fallback strategy to find NUMBER and TITLE fields
 * @param {Object} fusionItem - Fusion Manage item object from getItemById
 * @returns {Object} - { parentNumber: string, parentLabel: string }
 */
function extractParentNumberAndLabel(fusionItem) {
  const itemId = fusionItem.itemId || fusionItem.dmsId || 'unknown';
  
  // Get metaFields array (can be in different structures)
  const meta = fusionItem.raw?.metaFields?.entry || 
               fusionItem.raw?.metaFields || 
               (Array.isArray(fusionItem.raw?.metaFields) ? fusionItem.raw.metaFields : []);
  
  // Helper function to get field value from metaFields
  const getField = (key) => {
    // Try direct access first (old structure)
    if (fusionItem.raw?.metaFields?.[key]?.fieldData?.value) {
      return String(fusionItem.raw.metaFields[key].fieldData.value).trim();
    }
    if (fusionItem.raw?.metaFields?.[key]?.fieldData?.formattedValue) {
      return String(fusionItem.raw.metaFields[key].fieldData.formattedValue).trim();
    }
    
    // Try array structure (new structure)
    if (Array.isArray(meta)) {
      const entry = meta.find(e => e.key === key || e.fieldKey === key || e.name === key);
      if (entry) {
        return entry.fieldData?.value || 
               entry.fieldData?.formattedValue || 
               entry.value || 
               null;
      }
    }
    
    return null;
  };
  
  // Log available metaField keys for debugging
  if (Array.isArray(meta) && meta.length > 0) {
    const keys = meta.map(e => e.key || e.fieldKey || e.name || 'unknown').filter(Boolean);
    logger.debug('Fusion metaField keys', {
      itemId,
      keys: keys,
      totalFields: meta.length
    });
  }
  
  // Extract parent number with multiple fallbacks
  let parentNumber = 
    getField('NUMBER') ||
    getField('DMS_ID') ||
    fusionItem.itemNumber ||
    fusionItem.raw?.details?.dmsID?.toString() ||
    fusionItem.raw?.dmsId?.toString() ||
    fusionItem.dmsId?.toString() ||
    null;
  
  // Additional fallbacks for parent number
  if (!parentNumber && fusionItem.raw?.details?.descriptor) {
    const descriptor = String(fusionItem.raw.details.descriptor);
    // Try to extract number from beginning of descriptor
    const match = descriptor.match(/^([A-Z0-9\-_]+)/);
    if (match && match[1]) {
      parentNumber = match[1].trim();
    }
  }
  
  // Extract parent label with multiple fallbacks
  let parentLabel = 
    getField('TITLE') ||
    getField('DESCRIPTION') ||
    fusionItem.title ||
    fusionItem.description ||
    fusionItem.raw?.details?.descriptor ||
    null;
  
  // Clean label if it contains number prefix
  if (parentLabel && parentNumber) {
    const cleaned = String(parentLabel).replace(new RegExp(`^${parentNumber}\\s*-\\s*`), '').trim();
    if (cleaned) {
      parentLabel = cleaned;
    }
  }
  
  // Final fallbacks
  if (!parentNumber) {
    parentNumber = fusionItem.dmsId?.toString() || itemId;
  }
  
  if (!parentLabel) {
    parentLabel = parentNumber || 'Unknown';
  }
  
  // Ensure both are strings
  parentNumber = String(parentNumber).trim();
  parentLabel = String(parentLabel).trim();
  
  // Validate that we have at least parentNumber
  if (!parentNumber || parentNumber === 'null' || parentNumber === 'undefined') {
    throw new Error('Could not extract parent number from Fusion Manage item');
  }
  
  logger.info('Resolved parent info from Fusion item', {
    itemId,
    parentNumber,
    parentLabel
  });
  
  return { parentNumber, parentLabel };
}

/**
 * Resolve item ID from parameter (can be DMS-ID or item number)
 * Strategy: First try as item number, then fallback to numeric ID
 * @param {string} param - Either DMS-ID (numeric) or item number (e.g., "ADSK-011001" or "002898")
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @returns {Promise<Object>} - { itemId: string, itemNumber: string|null, resolvedBy: 'id'|'number' }
 */
async function resolveItemIdFromParam(param, accessToken) {
  // 1) Zuerst immer versuchen, per Artikelnummer zu suchen
  try {
    logger.debug('Attempting to resolve param as item number', { param });
    const found = await fusionClient.searchItemByNumber(param, accessToken);
    
    if (found) {
      // Extract item ID from search result
      const itemId = found.itemId || 
                     found.dmsId || 
                     found.raw?.dmsId || 
                     found.raw?.id ||
                     found.raw?.item?.id;
      
      if (itemId) {
        logger.info('Resolved Fusion item from number', {
          param,
          itemId: String(itemId),
          resolvedBy: 'number'
        });
        return {
          itemId: String(itemId),
          itemNumber: param,
          resolvedBy: 'number'
        };
      }
    }
  } catch (err) {
    logger.debug('Search by number failed, will try as ID if numeric', {
      param,
      error: err.message
    });
    // Nicht sofort werfen, sondern als Fallback mit ID probieren
  }
  
  // 2) Wenn param rein numerisch ist, als DMS-ID versuchen
  const isNumeric = /^[0-9]+$/.test(param);
  if (isNumeric) {
    logger.info('Falling back to treating param as numeric Fusion item id', {
      param,
      resolvedBy: 'id'
    });
    return {
      itemId: String(param),
      itemNumber: null,
      resolvedBy: 'id'
    };
  }
  
  // 3) Wenn weder Nummer noch ID sinnvoll aufgelöst werden kann → NOT_FOUND Error
  const error = new Error(`Item not found: ${param}`);
  error.type = 'NOT_FOUND';
  error.code = 'NOT_FOUND';
  error.status = 404;
  throw error;
}

/**
 * Synchronize BOM from Fusion Manage to Dolibarr
 * 
 * Technischer Ablauf:
 * 1. Item-Parameter auflösen (DMS-ID oder Artikelnummer) via resolveItemIdFromParam
 * 2. Fusion-Item mit vollständigen Metadaten holen (getItemById)
 * 3. BOM aus Fusion lesen (getBomForItem): Primär /bom-items Endpoint, Fallback REL_BOM Relation
 * 4. Parent-Produkt in Dolibarr sicherstellen (ensureProductExists)
 * 5. Für jedes BOM-Child: Produkt in Dolibarr sicherstellen und BOM-Line-Objekt aufbauen
 * 6. BOM in Dolibarr erstellen/aktualisieren (ensureBomExistsForProduct + replaceBomLines)
 * 7. Transfer in SQLite loggen (logTransfer)
 * 
 * @param {string} param - Fusion Manage item ID (dmsId) or item number (e.g., "ADSK-011001")
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @param {boolean} [dryRun=false] - If true, perform dry run without writing to Dolibarr
 * @param {Function} [onProgress] - Optional progress callback: (progress) => void, where progress = { step, message, percent, current, total }
 * @returns {Promise<Object>} - Sync result
 */
async function syncBomFromFusionToDolibarr({ param, accessToken, dryRun = false, onProgress }) {
  logger.info('BOM sync requested', {
    service: 'fusion-dolibarr-integration',
    source: 'bomSync',
    param,
    dryRun
  });

  // Helper function to send progress updates
  // ProgressEvent model: { step, message?, percent?, current?, total?, syncResult? }
  // syncResult is ONLY included in the final 'complete' event
  const sendProgress = (step, message, percent = null, current = null, total = null, additionalData = {}) => {
    if (onProgress && typeof onProgress === 'function') {
      const progressEvent = { 
        step, 
        message, 
        percent, 
        current, 
        total
      };
      
      // Only include syncResult if explicitly provided (for final event)
      if (additionalData.syncResult !== undefined) {
        progressEvent.syncResult = additionalData.syncResult;
      }
      
      // Include other additional data (but not syncResult if not explicitly set)
      Object.keys(additionalData).forEach(key => {
        if (key !== 'syncResult' || additionalData.syncResult !== undefined) {
          progressEvent[key] = additionalData[key];
        }
      });
      
      onProgress(progressEvent);
    }
  };

  // Validate access token
  if (!accessToken) {
    const error = new Error('No access token provided for Fusion Manage request');
    logger.error('syncBomFromFusionToDolibarr called without access token', {
      param,
      dryRun
    });
    throw error;
  }

  try {
    // Step 1: Resolve param to itemId
    sendProgress('resolve', 'Item-Parameter auflösen...', 5);
    const { itemId, itemNumber, resolvedBy } = await resolveItemIdFromParam(param, accessToken);
    
    logger.debug('Item parameter resolved', {
      param,
      itemId,
      itemNumber,
      resolvedBy
    });
    
    // Step 2: Fusion-Item holen (für Nummer und Titel)
    sendProgress('fetch_item', 'Fusion Manage Item laden...', 15);
    logger.debug('Fetching Fusion Manage item', { itemId });
    const fusionItem = await fusionClient.getItemById(itemId, accessToken);
    
    // Extract parent number and label using robust extraction
    sendProgress('extract_meta', 'Metadaten extrahieren...', 20);
    const { parentNumber, parentLabel } = extractParentNumberAndLabel(fusionItem);
    
    logger.info('Fusion Manage item retrieved', {
      itemId,
      param,
      resolvedBy,
      parentNumber,
      parentLabel
    });

    // Step 3: BOM von Fusion holen
    sendProgress('fetch_bom', 'BOM aus Fusion Manage laden...', 30);
    logger.debug('Fetching BOM from Fusion Manage', { itemId });
    let bomLines = [];
    try {
      bomLines = await fusionClient.getBomForItem(itemId, accessToken);
      // getBomForItem gibt jetzt direkt FusionBomLine[] zurück
      if (!Array.isArray(bomLines)) {
        logger.warn('getBomForItem returned unexpected format, treating as empty', {
          itemId,
          resultType: typeof bomLines
        });
        bomLines = [];
      }
      sendProgress('fetch_bom', `BOM geladen: ${bomLines.length} Zeilen gefunden`, 35);
    } catch (bomError) {
      // If BOM fetch fails with NOT_FOUND, treat as no BOM
      if (bomError.code === 'NOT_FOUND' || bomError.status === 404) {
        logger.warn('No BOM items found for item', { itemId });
        bomLines = [];
        sendProgress('fetch_bom', 'Keine BOM-Zeilen gefunden', 35);
      } else {
        throw bomError;
      }
    }

    // Handle case where no BOM items found
    if (!bomLines || bomLines.length === 0) {
      logger.warn('No BOM items found - only creating parent product', { itemId, parentNumber });
      
      sendProgress('create_parent', 'Parent-Produkt in Dolibarr erstellen...', 50);
      // Still create parent product in Dolibarr (unless dryRun)
      let parentProduct;
      if (!dryRun) {
        parentProduct = await dolibarrClient.ensureProductExists({
          ref: parentNumber,
          label: parentLabel,
          description: parentLabel
        });
        sendProgress('create_parent', 'Parent-Produkt erstellt', 60);
      } else {
        // Mock product for dry run
        parentProduct = { id: null, ref: parentNumber };
        sendProgress('create_parent', 'Parent-Produkt (Dry-Run)', 60);
      }

      // Log transfer
      sendProgress('log', 'Transfer protokollieren...', 90);
      await logTransfer({
        fusionItemId: itemId,
        dolibarrProductRef: parentNumber,
        dolibarrBomId: null,
        direction: 'FM->Dolibarr',
        status: dryRun ? 'DRY_RUN' : 'SUCCESS',
        message: 'Parent product created, no BOM items found',
        dryRun: dryRun,
        diffSummary: `1 product created, 0 BOM lines (bomLinesPlanned: 0, bomLinesWritten: 0)`
      });

      // Final event with syncResult
      const result = {
        status: 'ok',
        fusionItemId: String(itemId),
        parentNumber: parentNumber,
        dolibarrProductId: parentProduct.id,
        bomLinesPlanned: 0,
        bomLinesWritten: 0,
        bom: {
          linesPlanned: 0,
          linesWritten: 0,
          lines: []
        }
      };
    }

    logger.info('BOM lines retrieved from Fusion Manage', {
      itemId,
      bomLineCount: bomLines.length,
      sampleLines: bomLines.slice(0, 3).map(line => ({
        childNumber: line.childNumber,
        childDescription: line.childDescription,
        quantity: line.qty,
        position: line.position
      }))
    });

    // Step 4: Parent-Produkt in Dolibarr sicherstellen
    sendProgress('create_parent', 'Parent-Produkt in Dolibarr erstellen...', 40);
    logger.debug('Ensuring parent product exists in Dolibarr', { parentNumber, parentLabel });
    let parentProduct;
    if (!dryRun) {
      parentProduct = await dolibarrClient.ensureProductExists({
        ref: parentNumber,
        label: parentLabel,
        description: parentLabel
      });
      sendProgress('create_parent', `Parent-Produkt erstellt (ID: ${parentProduct.id})`, 45);
    } else {
      // Mock product for dry run
      parentProduct = { id: null, ref: parentNumber };
      sendProgress('create_parent', 'Parent-Produkt (Dry-Run)', 45);
    }

    logger.info('Parent product ensured in Dolibarr', {
      productId: parentProduct.id,
      ref: parentProduct.ref,
      dryRun: dryRun
    });

    // Step 5: Sync BOM lines
    sendProgress('ensure_products', `Produkte prüfen/erstellen (0/${bomLines.length})...`, 50, 0, bomLines.length);
    let bomSyncResult;
    try {
      // Create progress wrapper for BOM line sync
      const bomProgressCallback = (progressData) => {
        // Handle both old format (current, total) and new format (object)
        let current, total, message, step, phase;
        
        if (typeof progressData === 'object' && progressData !== null) {
          current = progressData.current || 0;
          total = progressData.total || bomLines.length;
          message = progressData.message || 'BOM-Zeilen synchronisieren...';
          step = progressData.step || progressData.phase || 'sync_bom_lines';
          phase = progressData.phase;
        } else {
          // Old format: (current, total)
          current = progressData;
          total = arguments[1] || bomLines.length;
          message = `BOM-Zeile erstellen (${current}/${total})...`;
          step = 'create_bom_lines';
          phase = 'creating';
        }
        
        // Map step to unified progress events
        if (step === 'ensure_products' || phase === 'product') {
          // Product creation phase: 50-70%
          const productPercent = Math.floor((current / total) * 100);
          const overallPercent = 50 + Math.floor((productPercent / 100) * 20);
          sendProgress('ensure_products', message || `Produkt prüfen/erstellen: ${current}/${total}`, overallPercent, current, total);
        } else if (step === 'create_bom_lines' || step === 'bom_lines' || phase === 'creating') {
          // BOM line creation phase: 70-90%
          const bomPercent = Math.floor((current / total) * 100);
          const overallPercent = 70 + Math.floor((bomPercent / 100) * 20);
          sendProgress('create_bom_lines', message || `BOM-Zeile ${current}/${total} erstellen`, overallPercent, current, total);
        } else {
          // Other phases: pass through
          const percent = 50 + Math.floor((current / total) * 40);
          sendProgress(step, message, percent, current, total);
        }
      };

      bomSyncResult = await dolibarrClient.syncBomLinesForProduct({
        parentProductId: parentProduct.id,
        parentRef: parentNumber,
        bomLines: bomLines,
        dryRun: dryRun,
        onProgress: bomProgressCallback
      });
      
      sendProgress('create_bom_lines', `BOM-Zeilen synchronisiert: ${bomSyncResult.linesWritten} geschrieben`, 90, bomSyncResult.linesWritten, bomLines.length);
      
      // If BOM line sync is unsupported, log but don't throw error
      if (bomSyncResult.bomLineSyncUnsupported === true) {
        logger.warn('BOM line sync not supported on this Dolibarr instance; BOM header synchronized successfully', {
          service: 'fusion-dolibarr-integration',
          source: 'bomSync',
          itemId,
          parentProductId: parentProduct.id,
          parentNumber,
          bomId: bomSyncResult.bomId,
          totalLines: bomLines.length,
          writtenLines: bomSyncResult.linesWritten
        });
      }
    } catch (syncError) {
      // Only throw if it's not a "bomLinesUnsupported" case
      // (which should already be handled in syncBomLinesForProduct, but just in case)
      if (syncError.bomLinesUnsupported !== true) {
        logger.error('Failed to sync BOM lines', {
          service: 'fusion-dolibarr-integration',
          source: 'bomSync',
          itemId,
          parentProductId: parentProduct.id,
          parentNumber,
          error: syncError.message,
          code: syncError.code,
          status: syncError.status,
          dolibarrResponse: syncError.response?.data
        });
        
        // Log error
        await logTransfer({
          fusionItemId: itemId,
          dolibarrProductRef: parentNumber,
          dolibarrBomId: null,
          direction: 'FM->Dolibarr',
          status: 'ERROR',
          message: `BOM sync failed: ${syncError.message}`,
          dryRun: dryRun,
          diffSummary: null
        });
        
        throw syncError;
      }
    }

    // 5) Build response with BOM line details
    const bomLineDetails = bomLines.map(line => ({
      fusionItemId: line.childId,
      childNumber: line.childNumber,
      childDescription: line.childDescription,
      dolibarrProductId: null, // Will be resolved during sync
      quantity: line.qty,
      position: line.position
    }));

    // Step 6: Transfer in SQLite loggen
    sendProgress('log', 'Transfer protokollieren...', 95);
    await logTransfer({
      fusionItemId: itemId,
      dolibarrProductRef: parentNumber,
      dolibarrBomId: bomSyncResult.bomId,
      direction: 'FM->Dolibarr',
      status: dryRun ? 'DRY_RUN' : (bomSyncResult.bomLineSyncUnsupported === true ? 'PARTIAL' : 'SUCCESS'),
      message: bomSyncResult.bomLineSyncUnsupported === true
        ? `BOM header synced successfully, but BOM lines are not supported on this Dolibarr instance`
        : (dryRun 
          ? `Dry run: ${bomLines.length} BOM lines would be created`
          : `BOM synced successfully: ${bomSyncResult.linesWritten} lines`),
      dryRun: dryRun,
      diffSummary: `1 product, ${bomSyncResult.linesWritten} BOM lines (bomLinesPlanned: ${bomLines.length}, bomLinesWritten: ${bomSyncResult.linesWritten})`
    });

    // 7) Strukturierte Response zurückgeben
    const result = {
      status: 'ok',
      fusionItemId: String(itemId),
      parentNumber: parentNumber,
      parentProductId: parentProduct.id,
      bomId: bomSyncResult.bomId,
      bomLinesPlanned: bomLines.length,
      bomLinesWritten: bomSyncResult.linesWritten,
      skippedCount: bomSyncResult.skippedCount || 0,
      bomLineSyncUnsupported: bomSyncResult.bomLineSyncUnsupported === true,
      bom: {
        linesPlanned: bomLines.length,
        linesWritten: bomSyncResult.linesWritten,
        lines: bomLineDetails
      }
    };

    // Add errors array if there are any
    if (bomSyncResult.errors && bomSyncResult.errors.length > 0) {
      result.errors = bomSyncResult.errors;
    }

    logger.info('BOM sync completed successfully', {
      service: 'fusion-dolibarr-integration',
      source: 'bomSync',
      itemId,
      parentNumber,
      parentProductId: parentProduct.id,
      bomId: bomSyncResult.bomId,
      bomLinesPlanned: bomLines.length,
      bomLinesWritten: bomSyncResult.linesWritten,
      skippedCount: bomSyncResult.skippedCount || 0
    });

    // Send final event with syncResult
    sendProgress('complete', 'Synchronisierung abgeschlossen', 100, null, null, { syncResult: result });
    return result;

  } catch (error) {
    // Error logging in SQLite
    // Try to get itemId and parentNumber from error context or use param as fallback
    const errorItemId = error.itemId || (typeof param === 'string' ? param : 'unknown');
    const errorParentNumber = error.parentNumber || 'unknown';
    
    try {
      await logTransfer({
        fusionItemId: errorItemId,
        dolibarrProductRef: errorParentNumber,
        dolibarrBomId: null,
        direction: 'FM->Dolibarr',
        status: 'ERROR',
        message: `Sync failed: ${error.message}`,
        dryRun: dryRun,
        diffSummary: null
      });
    } catch (logError) {
      logger.error('Failed to log transfer error', {
        error: logError.message
      });
    }

    logger.error('BOM sync failed', {
      service: 'fusion-dolibarr-integration',
      source: 'bomSync',
      param,
      itemId: errorItemId,
      error: error.message,
      code: error.code,
      status: error.status,
      type: error.type,
      dolibarrResponse: error.response?.data
    });

    throw error;
  }
}

module.exports = {
  syncBomFromFusionToDolibarr
};
