const axios = require('axios');
const logger = require('../logger');
const { config } = require('../config');

/**
 * @typedef {Object} BomItem
 * @property {number} level            - Hierarchieebene (0 = Root, 1 = erste Ebene, ...)
 * @property {string} parentNumber     - FM-Item-Nummer des Parents (z.B. NUMBER)
 * @property {string} childNumber      - FM-Item-Nummer des Childs
 * @property {string} childLabel       - Titel/Beschreibung des Childs (z.B. TITLE oder DESCRIPTION)
 * @property {number} qty              - Menge des Childs im Parent
 * @property {number|string|null} [position] - Positionsnummer in der Stückliste (optional)
 */

/**
 * @typedef {Object} FusionBomLine
 * @property {string} parentId - Fusion Manage parent item ID (dmsId)
 * @property {string} parentNumber - Fusion Manage parent item number (NUMBER field)
 * @property {string} childId - Fusion Manage child item ID (dmsId)
 * @property {string} childNumber - Fusion Manage child item number (NUMBER field)
 * @property {string} [childDescription] - Child item description/title
 * @property {number} qty - Quantity of child in parent BOM
 * @property {string|number} [position] - Optional position/line number in BOM
 * @property {any} [raw] - Original Fusion Manage data for debugging
 */

/**
 * Classify error type from axios error
 * @param {Error} error - Axios error object
 * @returns {Object} - Error classification { type, code, retryable }
 */
function classifyError(error) {
  // Network errors (timeout, connection refused, etc.)
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return { type: 'TIMEOUT', code: 'TIMEOUT', retryable: true };
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { type: 'NETWORK', code: 'NETWORK_ERROR', retryable: true };
    }
    return { type: 'NETWORK', code: 'NETWORK_ERROR', retryable: true };
  }

  const status = error.response.status;

  // 4xx errors (client errors - usually not retryable)
  if (status >= 400 && status < 500) {
    if (status === 401) {
      return { type: 'AUTH', code: 'UNAUTHORIZED', retryable: false };
    }
    if (status === 404) {
      return { type: 'NOT_FOUND', code: 'NOT_FOUND', retryable: false };
    }
    return { type: 'CLIENT_ERROR', code: `CLIENT_${status}`, retryable: false };
  }

  // 5xx errors (server errors - retryable)
  if (status >= 500) {
    return { type: 'SERVER_ERROR', code: `SERVER_${status}`, retryable: true };
  }

  return { type: 'UNKNOWN', code: 'UNKNOWN_ERROR', retryable: false };
}

/**
 * Create structured error object
 * @param {Error} error - Original error
 * @param {string} operation - Operation name (e.g., 'getItemById')
 * @param {Object} context - Additional context (e.g., { itemId })
 * @returns {Error} - Structured error with code, status, source, details
 */
function createStructuredError(error, operation, context = {}) {
  const classification = classifyError(error);
  const status = error.response?.status;
  const errorMessage = error.response?.data?.message 
    || error.response?.data?.error_description
    || error.response?.data?.error 
    || error.message;

  const structuredError = new Error(errorMessage);
  structuredError.code = classification.code;
  structuredError.status = status;
  structuredError.source = 'fusion';
  structuredError.operation = operation;
  structuredError.retryable = classification.retryable;
  structuredError.details = {
    type: classification.type,
    ...context,
    responseData: error.response?.data
  };

  // Preserve original error stack
  structuredError.stack = error.stack;

  return structuredError;
}

/**
 * Retry wrapper for API calls with exponential backoff
 * @param {Function} fn - Async function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 2)
 * @param {number} baseDelay - Base delay in ms (default: 500)
 * @returns {Promise} - Result of function call
 */
async function retryWithBackoff(fn, maxRetries = 2, baseDelay = 500) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const classification = classifyError(error);
      if (!classification.retryable || attempt >= maxRetries) {
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn(`Retrying after ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`, {
        source: 'fusion',
        error: error.message,
        code: classification.code
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create axios instance for Fusion Manage API requests with access token
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @returns {axios.AxiosInstance} - Configured axios instance
 */
function createFusionAxios(accessToken) {
  if (!accessToken) {
    throw new Error('No access token provided for Fusion Manage request');
  }

  // Create axios instance with baseURL
  const apiClient = axios.create({
    baseURL: config.fusionManage.apiBaseUrl,
    timeout: 15000, // 15 seconds timeout
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    }
  });

  // Request interceptor for logging
  apiClient.interceptors.request.use(
    (config) => {
      logger.debug('Fusion Manage API request', {
        source: 'fusion',
        method: config.method.toUpperCase(),
        url: config.url,
        baseURL: config.baseURL
      });
      return config;
    },
    (error) => {
      logger.error('Request interceptor error', {
        source: 'fusion',
        error: error.message
      });
      return Promise.reject(error);
    }
  );

  // Response interceptor for error logging
  apiClient.interceptors.response.use(
    (response) => {
      return response;
    },
    (error) => {
      const classification = classifyError(error);
      logger.error('Fusion Manage API request failed', {
        source: 'fusion',
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        code: classification.code,
        status: error.response?.status,
        statusText: error.response?.statusText,
        retryable: classification.retryable,
        message: error.message
      });
      return Promise.reject(error);
    }
  );

  return apiClient;
}

/**
 * Get item details from Fusion Manage by ID
 * @param {string} itemId - Item ID (dmsId)
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @param {Object} [options] - Optional parameters
 * @param {boolean} [options.includeRelations=false] - If true, include relationships in response
 * @returns {Promise<Object>} - Item data with relevant fields
 */
async function getItemById(itemId, accessToken, options = {}) {
  const operation = 'getItemById';
  const { includeRelations = false } = options;
  
  // Validate access token
  if (!accessToken) {
    const error = new Error('No access token provided for Fusion Manage request');
    logger.error('getItemById called without access token', {
      source: 'fusion',
      operation,
      itemId
    });
    throw error;
  }
  
  return retryWithBackoff(async () => {
    try {
      logger.debug(`Fetching item details for ID: ${itemId}`, {
        source: 'fusion',
        operation,
        includeRelations
      });

      // Create axios instance with access token
      const apiClient = createFusionAxios(accessToken);
      
      const workspaceId = config.fusionManage.workspaceId;
      
      // Build query parameters
      const params = {};
      if (includeRelations) {
        // Try multiple possible parameter names for including relationships
        // Based on Fusion Manage API, use 'include' with 'relationships' or 'ALL'
        params.include = 'relationships';
      }
      
      const response = await apiClient.get(
        `/api/rest/v1/workspaces/${workspaceId}/items/${itemId}`,
        { params }
      );

      const item = response.data;
      
      // Log available relation keys if relations are present
      if (item.relations && item.relations.entry) {
        const relationKeys = item.relations.entry.map(e => e.key).filter(Boolean);
        logger.debug('Fusion item relations keys', {
          source: 'fusion',
          operation,
          itemId,
          relationKeys: relationKeys,
          relationCount: relationKeys.length
        });
      }
      
      // Extract relevant fields
      const itemData = {
        itemId: item.dmsId || itemId,
        itemNumber: item.number || null,
        dmsId: item.dmsId || null,
        description: item.description || null,
        revision: item.revision || null,
        lifecycleState: item.lifecycleState || null,
        title: item.title || null,
        workspaceId: item.workspaceId || workspaceId,
        createdAt: item.createdAt || null,
        modifiedAt: item.modifiedAt || null,
        // Include full item for flexibility
        raw: item
      };

      logger.debug(`Item details retrieved successfully`, {
        source: 'fusion',
        operation,
        itemId: itemData.itemId,
        itemNumber: itemData.itemNumber
      });

      return itemData;
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { itemId });
      
      // 404 is a special case - item not found
      if (error.response?.status === 404) {
        structuredError.code = 'NOT_FOUND';
        structuredError.message = `Item not found: ${itemId}`;
      }

      logger.error(`Failed to get item ${itemId}`, {
        source: 'fusion',
        operation,
        code: structuredError.code,
        status: structuredError.status,
        retryable: structuredError.retryable
      });

      throw structuredError;
    }
  });
}

/**
 * Map Fusion Manage BOM response to internal BomItem structure
 * @param {Object} data - Raw BOM response data from Fusion Manage API
 * @param {string} rootItemId - Root item ID (dmsId) for fallback parent number
 * @returns {BomItem[]} - Array of mapped BOM items
 */
function mapFusionBomResponse(data, rootItemId) {
  // Log sample of raw data structure for debugging (only once, first entry)
  if (data && (data.list || data.items || data.bomItems || Array.isArray(data))) {
    const sampleEntry = data.list?.[0] || data.items?.[0] || data.bomItems?.[0] || (Array.isArray(data) ? data[0] : null);
    if (sampleEntry) {
      logger.debug('Sample BOM entry structure', {
        source: 'fusion',
        operation: 'mapFusionBomResponse',
        sampleKeys: Object.keys(sampleEntry),
        hasParent: !!(sampleEntry.parentItem || sampleEntry.parent || sampleEntry.parentDmsId),
        hasChild: !!(sampleEntry.childItem || sampleEntry.child || sampleEntry.childDmsId),
        hasQuantity: !!(sampleEntry.quantity || sampleEntry.qty)
      });
    }
  }

  // Extract BOM items array from various possible response structures
  const bomItems = data.list || data.items || data.bomItems || (Array.isArray(data) ? data : []);
  
  if (!Array.isArray(bomItems) || bomItems.length === 0) {
    logger.debug('No BOM items found in response', {
      source: 'fusion',
      operation: 'mapFusionBomResponse',
      dataKeys: data ? Object.keys(data) : []
    });
    return [];
  }

  const mappedItems = [];
  let rootParentNumber = null;

  // Try to determine root parent number from first entry or root item
  if (bomItems.length > 0) {
    const firstEntry = bomItems[0];
    // Try to get parent number from first entry
    const parentItem = firstEntry.parentItem || firstEntry.parent || {};
    rootParentNumber = parentItem.number || parentItem.NUMBER || parentItem.itemNumber || null;
    
    // If not found, try to get from root item reference
    if (!rootParentNumber && firstEntry.rootItem) {
      rootParentNumber = firstEntry.rootItem.number || firstEntry.rootItem.NUMBER || null;
    }
  }

  for (const bomEntry of bomItems) {
    try {
      // Extract parent information
      const parentItem = bomEntry.parentItem || bomEntry.parent || {};
      const parentNumber = parentItem.number || parentItem.NUMBER || parentItem.itemNumber || rootParentNumber || null;

      // Extract child information
      const childItem = bomEntry.childItem || bomEntry.child || bomEntry.item || bomEntry;
      const childNumber = childItem.number || childItem.NUMBER || childItem.itemNumber || null;
      const childLabel = childItem.title || childItem.TITLE || childItem.description || childItem.DESCRIPTION || childItem.label || null;

      // Extract quantity
      const qty = bomEntry.quantity || bomEntry.qty || bomEntry.QUANTITY || 1;
      const parsedQty = parseFloat(qty);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        logger.warn('Invalid quantity in BOM entry, using default 1', {
          source: 'fusion',
          operation: 'mapFusionBomResponse',
          qty: qty,
          childNumber: childNumber
        });
      }

      // Extract position (optional)
      const position = bomEntry.position || bomEntry.lineNumber || bomEntry.sortOrder || bomEntry.POSITION || null;

      // Determine level
      // If level/depth is provided in response, use it; otherwise default to 1
      let level = bomEntry.level !== undefined ? bomEntry.level : 
                  bomEntry.depth !== undefined ? bomEntry.depth : 
                  bomEntry.LEVEL !== undefined ? bomEntry.LEVEL : 1;

      // Ensure level is a number
      level = parseInt(level, 10);
      if (isNaN(level)) {
        level = 1;
      }

      // Only add if we have at least child number
      if (childNumber) {
        mappedItems.push({
          level: level,
          parentNumber: parentNumber,
          childNumber: childNumber,
          childLabel: childLabel,
          qty: isNaN(parsedQty) ? 1 : parsedQty,
          position: position
        });
      } else {
        logger.warn('Skipping BOM entry without child number', {
          source: 'fusion',
          operation: 'mapFusionBomResponse',
          entryKeys: Object.keys(bomEntry)
        });
      }
    } catch (entryError) {
      logger.warn('Error mapping BOM entry, skipping', {
        source: 'fusion',
        operation: 'mapFusionBomResponse',
        error: entryError.message
      });
      // Continue with next entry
    }
  }

  logger.debug('BOM response mapped successfully', {
    source: 'fusion',
    operation: 'mapFusionBomResponse',
    inputCount: bomItems.length,
    outputCount: mappedItems.length
  });

  return mappedItems;
}

/**
 * Extract BOM lines from REL_BOM relation in new format
 * @param {Object} fusionItem - Item object from getItemById (with raw property)
 * @param {string} itemId - Item ID for logging
 * @returns {Array} - Array of BOM line objects with { fusionItemId, childNumber, description, quantity }
 */
function extractBomLinesFromRelBom(fusionItem, itemId) {
  const operation = 'extractBomLinesFromRelBom';
  
  try {
    // Extract relations from raw item data
    const relations = fusionItem.raw?.relations?.entry || [];
    
    // Enhanced logging for REL_BOM structure
    logger.debug('Extracting BOM from REL_BOM relation', {
      source: 'fusion',
      operation,
      itemId,
      relationsCount: relations.length,
      relationKeys: relations.map(r => r.key).filter(Boolean)
    });
    
    // Find REL_BOM relation (fallback to REL_INV_BOM if not found)
    let bomRel = relations.find(e => e.key === 'REL_BOM');
    
    if (!bomRel) {
      // Try REL_INV_BOM as fallback
      bomRel = relations.find(e => e.key === 'REL_INV_BOM');
      if (bomRel) {
        logger.debug('REL_BOM not found, using REL_INV_BOM fallback', {
          source: 'fusion',
          operation,
          itemId
        });
      }
    }
    
    if (!bomRel) {
      logger.debug('No REL_BOM or REL_INV_BOM relation found in item', {
        source: 'fusion',
        operation,
        itemId,
        availableRelations: relations.map(r => r.key).filter(Boolean)
      });
      return [];
    }
    
    // Log REL_BOM structure for debugging
    logger.debug('REL_BOM relation structure', {
      source: 'fusion',
      operation,
      itemId,
      bomRelKeys: Object.keys(bomRel),
      hasValue: !!bomRel.value,
      valueType: typeof bomRel.value,
      valueKeys: bomRel.value ? Object.keys(bomRel.value) : null
    });
    
    // Extract children from REL_BOM relation
    // Try multiple possible structures
    const children = bomRel.value?.item || 
                     bomRel.value?.items || 
                     bomRel.value?.children ||
                     (Array.isArray(bomRel.value) ? bomRel.value : []);
    
    if (!Array.isArray(children) || children.length === 0) {
      logger.debug('REL_BOM relation found but no children items', {
        source: 'fusion',
        operation,
        itemId,
        bomRelValueType: typeof bomRel.value,
        bomRelValueKeys: bomRel.value ? Object.keys(bomRel.value) : null
      });
      return [];
    }
    
    logger.debug(`Found ${children.length} BOM children in REL_BOM for item ${itemId}`, {
      source: 'fusion',
      operation,
      itemId,
      childCount: children.length,
      sampleChildKeys: children.length > 0 ? Object.keys(children[0]) : null
    });
    
    const bomLines = [];
    
    for (const child of children) {
      try {
        // Extract child ID
        const fusionItemId = child.id || child.dmsId || child.itemId || null;
        
        if (!fusionItemId) {
          logger.warn('Skipping BOM child without ID', {
            source: 'fusion',
            operation,
            itemId,
            childKeys: Object.keys(child)
          });
          continue;
        }
        
        // Extract child number from descriptor or description
        let childNumber = null;
        const descriptor = child.details?.descriptor || child.descriptor || '';
        
        if (descriptor) {
          // Parse descriptor: "ADSK-011001 - Packaging Machine [REV:1]" => "ADSK-011001"
          // Try to match first word group (alphanumeric with dashes/underscores) before space or " - "
          const match = String(descriptor).match(/^([A-Z0-9\-_]+)/);
          if (match && match[1]) {
            childNumber = match[1].trim();
          }
        }
        
        // Fallback to description if no number found
        if (!childNumber) {
          childNumber = child.description || child.number || child.itemNumber || null;
        }
        
        // Extract description
        const description = child.description || descriptor || childNumber || null;
        
        // Quantity: Try multiple possible fields and structures
        // Check for quantity in various locations
        let quantity = child.quantity || 
                      child.qty || 
                      child.QUANTITY ||
                      child.amount ||
                      child.count ||
                      null;
        
        // If quantity is in a nested structure, try to extract it
        if (!quantity && child.details) {
          quantity = child.details.quantity || child.details.qty || null;
        }
        
        // If quantity is in metadata/fields
        if (!quantity && child.metaFields) {
          const qtyField = Array.isArray(child.metaFields) 
            ? child.metaFields.find(f => (f.key || f.fieldKey) === 'QUANTITY' || (f.key || f.fieldKey) === 'QTY')
            : child.metaFields.QUANTITY || child.metaFields.QTY;
          
          if (qtyField) {
            quantity = qtyField.fieldData?.value || qtyField.value || qtyField;
          }
        }
        
        // Parse and validate quantity
        const parsedQuantity = quantity ? parseFloat(quantity) : NaN;
        const finalQuantity = (isNaN(parsedQuantity) || parsedQuantity <= 0) ? 1 : parsedQuantity;
        
        // Log warning if quantity was not found (but still use default 1)
        if (!quantity || isNaN(parsedQuantity)) {
          logger.warn('No quantity found in REL_BOM child, using default 1', {
            source: 'fusion',
            operation,
            itemId,
            childId: fusionItemId,
            childNumber: childNumber,
            childKeys: Object.keys(child)
          });
        }
        
        // Build BOM line in new format
        bomLines.push({
          fusionItemId: String(fusionItemId),
          childNumber: childNumber ? String(childNumber).trim() : null,
          description: description ? String(description).trim() : null,
          quantity: finalQuantity
        });
        
        logger.debug('Extracted BOM child from REL_BOM', {
          source: 'fusion',
          operation,
          itemId,
          childId: fusionItemId,
          childNumber: childNumber,
          quantity: finalQuantity,
          quantitySource: quantity ? 'found' : 'default'
        });
      } catch (childError) {
        logger.warn('Error extracting BOM child from REL_BOM, skipping', {
          source: 'fusion',
          operation,
          itemId,
          error: childError.message
        });
        // Continue with next child
      }
    }
    
    logger.info(`Extracted ${bomLines.length} BOM lines from REL_BOM relation`, {
      source: 'fusion',
      operation,
      itemId,
      extractedCount: bomLines.length,
      totalChildren: children.length
    });
    
    return bomLines;
  } catch (error) {
    logger.error('Error extracting BOM from REL_BOM relation', {
      source: 'fusion',
      operation,
      itemId,
      error: error.message,
      stack: error.stack
    });
    return [];
  }
}

/**
 * Get BOM (Bill of Materials) for an item from Fusion Manage
 * Strategy: Use /boms endpoint (API v1). Optional REL_BOM fallback can stay.
 * @param {string} itemId - Item ID (dmsId)
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @returns {Promise<FusionBomLine[]>} - Array of BOM lines with parent/child info and quantities
 */
async function getBomForItem(itemId, accessToken) {
  const operation = 'getBomForItem';

  if (!accessToken) {
    const error = new Error('No access token provided for Fusion Manage request');
    logger.error('getBomForItem called without access token', {
      source: 'fusion',
      operation,
      itemId
    });
    throw error;
  }

  return retryWithBackoff(async () => {
    // 1) Parent holen (inkl. Nummer). Relations sind hier nicht nötig.
    const parentItem = await getItemById(itemId, accessToken, { includeRelations: false });
    const parentNumber =
      parentItem.itemNumber ||
      parentItem.raw?.metaFields?.entry?.find(e => e.key === 'NUMBER')?.fieldData?.value ||
      parentItem.raw?.number ||
      String(itemId);

    let bomLines = [];

    // 2) Richtigen BOM-Endpoint (API v1) verwenden
    try {
      logger.debug(`Attempting to fetch BOM from /boms endpoint for item: ${itemId}`, {
        source: 'fusion',
        operation,
        itemId
      });

      const apiClient = createFusionAxios(accessToken);
      const workspaceId = config.fusionManage.workspaceId;

      const response = await apiClient.get(
        `/api/rest/v1/workspaces/${workspaceId}/items/${itemId}/boms`,
        {
          params: {
            depth: 3,
            revisionBias: 'release'
          }
        }
      );

      const bomData = response.data || {};
      const listData = bomData.list?.data || [];

      // Jede listData-Row enthält ein "bom-item" Objekt
      const bomItemsRaw = listData
        .map(row => row['bom-item'] || row)
        .filter(Boolean);

      logger.debug('BOM /boms endpoint response', {
        source: 'fusion',
        operation,
        itemId,
        status: response.status,
        itemCount: bomItemsRaw.length
      });

      if (bomItemsRaw.length > 0) {
        bomLines = bomItemsRaw
          .map(entry => {
            // dmsID des Childs
            const childId = entry.dmsID ? String(entry.dmsID) : null;

            // Nummer aus descriptor extrahieren: "ADSK-011001 - Packaging Machine [REV:1]"
            const descriptor = entry.descriptor || '';
            let childNumber = null;

            if (descriptor) {
              const match = String(descriptor).match(/^([A-Z0-9\-_]+)/i);
              if (match && match[1]) {
                childNumber = match[1].trim();
              }
            }

            // Fallbacks
            if (!childNumber && entry.itemNumber) {
              childNumber = String(entry.itemNumber);
            }

            const childDescription = descriptor || childNumber || null;

            // Menge
            const qtyRaw = entry.quantity ?? entry.itemQuantity ?? 1;
            const qtyParsed = parseFloat(qtyRaw);
            const finalQty = (!isNaN(qtyParsed) && qtyParsed > 0) ? qtyParsed : 1;

            // Positionsnummer = itemNumber in der BOM (falls vorhanden)
            const position = entry.itemNumber ?? null;

            if (!childId && !childNumber) {
              logger.warn('Skipping BOM entry without childId and childNumber', {
                source: 'fusion',
                operation,
                itemId,
                entryKeys: Object.keys(entry)
              });
              return null;
            }

            return {
              parentId: String(itemId),
              parentNumber: String(parentNumber),
              childId,
              childNumber,
              childDescription,
              qty: finalQty,
              position,
              raw: entry
            };
          })
          .filter(line => !!line); // null rausfiltern

        logger.info('BOM retrieved successfully from /boms', {
          source: 'fusion',
          operation,
          itemId,
          lineCount: bomLines.length,
          sampleLine: bomLines[0]
            ? {
                childId: bomLines[0].childId,
                childNumber: bomLines[0].childNumber,
                qty: bomLines[0].qty
              }
            : null
        });

        if (bomLines.length > 0) {
          return bomLines;
        }
      } else {
        logger.warn('BOM /boms endpoint returned empty list.data', {
          source: 'fusion',
          operation,
          itemId
        });
      }
    } catch (error) {
      const status = error.response?.status;
      logger.warn('BOM /boms endpoint request failed', {
        source: 'fusion',
        operation,
        itemId,
        status,
        message: error.message
      });
    }

    // 3) Optionaler Fallback über REL_BOM (bestehende Logik weiterverwenden).
    //    Wenn du REL_BOM nicht brauchst, kannst du diesen Block auch entfernen.
    try {
      logger.debug(`Using REL_BOM fallback for item: ${itemId}`, {
        source: 'fusion',
        operation,
        itemId
      });

      const parentWithRelations = await getItemById(itemId, accessToken, { includeRelations: true });
      const relBomLines = extractBomLinesFromRelBom(parentWithRelations, itemId);

      if (relBomLines && relBomLines.length > 0) {
        bomLines = relBomLines.map((line, index) => ({
          parentId: String(itemId),
          parentNumber: String(parentNumber),
          childId: line.fusionItemId || null,
          childNumber: line.childNumber || null,
          childDescription: line.description || null,
          qty: line.quantity || 1,
          position: line.position || ((index + 1) * 10),
          raw: null
        }));

        logger.info(`Using REL_BOM fallback, lines found: ${bomLines.length}`, {
          source: 'fusion',
          operation,
          itemId
        });

        return bomLines;
      }
    } catch (fallbackError) {
      logger.warn('REL_BOM fallback failed', {
        source: 'fusion',
        operation,
        itemId,
        error: fallbackError.message
      });
    }

    logger.warn(`No BOM lines found for item ${itemId} (neither /boms nor REL_BOM)`, {
      source: 'fusion',
      operation,
      itemId
    });

    return [];
  });
}

/**
 * Search for an item by item number
 * @param {string} itemNumber - Item number to search for
 * @param {string} accessToken - OAuth access token (from 3-legged OAuth flow)
 * @returns {Promise<Object|null>} - First matching item or null if not found
 */
async function searchItemByNumber(itemNumber, accessToken) {
  const operation = 'searchItemByNumber';
  
  // Validate access token
  if (!accessToken) {
    const error = new Error('No access token provided for Fusion Manage request');
    logger.error('searchItemByNumber called without access token', {
      source: 'fusion',
      operation,
      itemNumber
    });
    throw error;
  }
  
  return retryWithBackoff(async () => {
    try {
      logger.debug(`Searching for item with number: ${itemNumber}`, {
        source: 'fusion',
        operation
      });

      // Create axios instance with access token
      const apiClient = createFusionAxios(accessToken);
      
      const workspaceId = config.fusionManage.workspaceId;
      const encodedQuery = encodeURIComponent(`NUMBER=${itemNumber}`);
      const response = await apiClient.get(
        `/api/rest/v1/workspaces/${workspaceId}/items?query=${encodedQuery}`
      );

      const searchResults = response.data;
      
      // Handle different possible response structures
      const items = searchResults.items || searchResults.data || searchResults || [];
      
      if (Array.isArray(items) && items.length > 0) {
        const firstMatch = items[0];
        
        // Return in same format as getItemById
        const itemData = {
          itemId: firstMatch.dmsId || firstMatch.id,
          itemNumber: firstMatch.number || firstMatch.itemNumber || itemNumber,
          dmsId: firstMatch.dmsId || firstMatch.id,
          description: firstMatch.description || null,
          revision: firstMatch.revision || null,
          lifecycleState: firstMatch.lifecycleState || null,
          title: firstMatch.title || null,
          workspaceId: firstMatch.workspaceId || workspaceId,
          createdAt: firstMatch.createdAt || null,
          modifiedAt: firstMatch.modifiedAt || null,
          raw: firstMatch
        };

        logger.debug(`Item found by number`, {
          source: 'fusion',
          operation,
          itemNumber,
          itemId: itemData.itemId
        });

        return itemData;
      }

      logger.debug(`No item found with number: ${itemNumber}`, {
        source: 'fusion',
        operation
      });
      return null;
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { itemNumber });
      
      // 404 or empty results are not errors for search
      if (error.response?.status === 404) {
        logger.debug(`No item found with number: ${itemNumber}`, {
          source: 'fusion',
          operation
        });
        return null;
      }

      logger.error(`Failed to search for item number ${itemNumber}`, {
        source: 'fusion',
        operation,
        code: structuredError.code,
        status: structuredError.status,
        retryable: structuredError.retryable
      });

      throw structuredError;
    }
  });
}

module.exports = {
  createFusionAxios,
  getItemById,
  getBomForItem,
  searchItemByNumber
};
