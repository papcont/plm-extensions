const axios = require('axios');
const logger = require('../logger');
const { config } = require('../config');

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
 * @param {string} operation - Operation name (e.g., 'ensureProductExists')
 * @param {Object} context - Additional context (e.g., { ref })
 * @returns {Error} - Structured error with code, status, source, details
 */
function createStructuredError(error, operation, context = {}) {
  const classification = classifyError(error);
  const status = error.response?.status;
  const errorMessage = error.response?.data?.error?.message 
    || error.response?.data?.message 
    || error.response?.data?.error 
    || error.message;

  const structuredError = new Error(errorMessage);
  structuredError.code = classification.code;
  structuredError.status = status;
  structuredError.source = 'dolibarr';
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
        source: 'dolibarr',
        error: error.message,
        code: classification.code
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Create axios instance with baseURL and request interceptor for authentication
 */
const apiClient = axios.create({
  baseURL: config.dolibarr.apiUrl,
  timeout: 15000, // 15 seconds timeout
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'DOLAPIKEY': config.dolibarr.apiKey
  }
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    logger.debug('Dolibarr API request', {
      source: 'dolibarr',
      method: config.method.toUpperCase(),
      url: config.url,
      baseURL: config.baseURL
    });
    return config;
  },
  (error) => {
    logger.error('Request interceptor error', {
      source: 'dolibarr',
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
    logger.error('Dolibarr API request failed', {
      source: 'dolibarr',
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

/**
 * Make authenticated request to Dolibarr API
 * @param {string} method - HTTP method
 * @param {string} endpoint - API endpoint (relative to apiUrl)
 * @param {Object} [data] - Request body
 * @param {Object} [headers] - Additional headers
 * @returns {Promise<Object>} - API response
 */
async function request(method, endpoint, data = null, headers = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${config.dolibarr.apiUrl}${endpoint}`;

  try {
    const response = await axios({
      method,
      url,
      data,
      timeout: 15000,
      headers: {
        'DOLAPIKEY': config.dolibarr.apiKey,
        'Content-Type': 'application/json',
        ...headers
      }
    });

    return response.data;
  } catch (error) {
    const structuredError = createStructuredError(error, 'request', { method, endpoint });
    logger.error(`Dolibarr API request failed: ${method} ${endpoint}`, {
      source: 'dolibarr',
      operation: 'request',
      code: structuredError.code,
      status: structuredError.status,
      retryable: structuredError.retryable
    });
    throw structuredError;
  }
}

/**
 * Ensure product exists in Dolibarr, create if it doesn't
 * @param {Object} params - Product parameters
 * @param {string} params.ref - Product reference (item number)
 * @param {string} params.label - Product label/name
 * @param {string} [params.description] - Product description
 * @returns {Promise<Object>} - Product object with id, ref, label, etc.
 */
async function ensureProductExists({ ref, label, description }) {
  const operation = 'ensureProductExists';
  
  return retryWithBackoff(async () => {
    try {
      logger.debug(`Checking if product exists with ref: ${ref}`, {
        source: 'dolibarr',
        operation
      });

      // Search for existing product by reference
      const sqlFilter = encodeURIComponent(`(t.ref:=:'${ref}')`);
      const searchResponse = await apiClient.get(`/products?sqlfilters=${sqlFilter}`);

      // Handle different possible response structures
      let products = [];
      if (Array.isArray(searchResponse.data)) {
        products = searchResponse.data;
      } else if (searchResponse.data?.products) {
        products = searchResponse.data.products;
      } else if (searchResponse.data?.data) {
        products = searchResponse.data.data;
      } else if (searchResponse.data) {
        // Single product object
        products = [searchResponse.data];
      }

      // If product exists, return it
      if (products.length > 0) {
        const existingProduct = products[0];
        logger.debug(`Product found with ref: ${ref}`, {
          source: 'dolibarr',
          operation,
          id: existingProduct.id,
          ref: existingProduct.ref
        });
        return existingProduct;
      }

      // Product doesn't exist, create it
      logger.debug(`Product not found, creating new product with ref: ${ref}`, {
        source: 'dolibarr',
        operation
      });

      const productData = {
        ref: ref,
        label: label || ref,
        description: description || label || ref,
        type: 0 // 0 = Product, 1 = Service
      };

      const createResponse = await apiClient.post('/products', productData);
      
      // Robustly extract product ID from various possible response structures
      let productId = null;
      const data = createResponse && createResponse.data;
      
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Response is an object: { id: 422 }, { product: { id: 422 } }, etc.
        productId = data.id || data.rowid || data.product_id || null;
        
        // If nested in product object
        if (!productId && data.product) {
          productId = data.product.id || data.product.rowid || data.product.product_id || null;
        }
      } else if (typeof data === 'number') {
        // Response is a naked number: 422
        productId = data;
      } else if (typeof data === 'string' && data.trim() !== '' && !isNaN(Number(data))) {
        // Response is a string number: "422"
        productId = Number(data);
      }
      
      // Fallback: If ID still not found, try to look up product by ref
      if (!productId) {
        logger.warn('Product ID not found in POST response, trying fallback lookup by ref', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          ref,
          responseData: data
        });
        
        try {
          const lookupResponse = await apiClient.get(`/products/ref/${encodeURIComponent(ref)}`);
          const lookupData = lookupResponse && lookupResponse.data;
          
          if (lookupData && typeof lookupData === 'object' && !Array.isArray(lookupData)) {
            productId = lookupData.id || lookupData.rowid || lookupData.product_id || null;
          }
        } catch (lookupError) {
          logger.warn('Fallback lookup by ref failed', {
            service: 'fusion-dolibarr-integration',
            source: 'dolibarr',
            operation,
            ref,
            error: lookupError.message
          });
        }
      }
      
      // If still no ID, throw error
      if (!productId) {
        const error = new Error(`Child product created but no ID returned for: ${ref}`);
        error.code = 'NO_PRODUCT_ID';
        error.ref = ref;
        error.responseData = data;
        throw error;
      }
      
      // Build product object with extracted ID
      const newProduct = {
        id: productId,
        ref: ref,
        label: label || ref,
        description: description || label || ref,
        ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {})
      };

      logger.info('Product created successfully', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        id: newProduct.id,
        ref: newProduct.ref
      });

      return newProduct;
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { ref });
      
      logger.error(`Failed to ensure product exists: ${ref}`, {
        source: 'dolibarr',
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
 * Get BOM for a product from Dolibarr
 * @param {number} productId - Dolibarr product ID
 * @returns {Promise<Object|null>} - BOM object with { id, fk_product, label, ref, ... } or null if not found
 */
async function getBomForProduct(productId) {
  const operation = 'getBomForProduct';
  
  return retryWithBackoff(async () => {
    try {
      logger.debug('Checking if BOM exists for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        productId
      });

      // Search for existing BOMs using fk_product query parameter
      // Try both query parameter and sqlfilters for compatibility
      let searchResponse;
      try {
        searchResponse = await apiClient.get(`/boms?fk_product=${productId}`);
      } catch (queryError) {
        // Fallback to sqlfilters if query parameter doesn't work
        const sqlFilter = encodeURIComponent(`(t.fk_product:=:${productId})`);
        searchResponse = await apiClient.get(`/boms?sqlfilters=${sqlFilter}`);
      }

      // Handle different possible response structures
      let boms = [];
      if (Array.isArray(searchResponse.data)) {
        boms = searchResponse.data;
      } else if (searchResponse.data?.boms) {
        boms = searchResponse.data.boms;
      } else if (searchResponse.data?.data) {
        boms = searchResponse.data.data;
      } else if (searchResponse.data) {
        // Single BOM object
        boms = [searchResponse.data];
      }

      // Filter client-side to ensure we only get BOMs for this exact product
      const matchingBoms = boms.filter(bom => {
        const bomProductId = bom.fk_product || bom.fk_product_father || bom.product_id;
        return bomProductId == productId; // Use == for type coercion
      });

      if (matchingBoms.length === 0) {
        logger.debug('No BOM found for product', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          productId
        });
        return null;
      }

      // Return the first matching BOM
      const bom = matchingBoms[0];
      logger.debug('BOM found for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        productId,
        bomId: bom.id || bom.rowid,
        label: bom.label,
        ref: bom.ref
      });

      return {
        id: bom.id || bom.rowid,
        fk_product: bom.fk_product || bom.fk_product_father || productId,
        label: bom.label,
        ref: bom.ref,
        ...bom // Include all other fields
      };
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { productId });
      
      logger.error('Failed to get BOM for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        productId,
        code: structuredError.code,
        status: structuredError.status,
        retryable: structuredError.retryable
      });

      // If it's a NOT_FOUND, return null instead of throwing
      if (error.response?.status === 404 || structuredError.code === 'NOT_FOUND') {
        return null;
      }

      throw structuredError;
    }
  });
}

/**
 * Ensure BOM exists for a product, create if it doesn't
 * Returns the BOM ID for the given product
 * @param {number} parentProductId - Dolibarr product ID
 * @param {string} parentNumber - Parent product number/ref (e.g., "ADSK-011001") for BOM ref generation
 * @returns {Promise<number>} - BOM ID
 */
async function ensureBomForProduct(parentProductId, parentNumber) {
  const operation = 'ensureBomForProduct';
  
  return retryWithBackoff(async () => {
    try {
      logger.debug('Checking if BOM exists for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentNumber
      });

      // Step 1: Check if BOM already exists using getBomForProduct
      const existingBom = await getBomForProduct(parentProductId);

      if (existingBom) {
        const bomId = existingBom.id;
        logger.info('ensureBomForProduct: using existing BOM', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          bomId: bomId,
          productId: parentProductId,
          parentNumber,
          label: existingBom.label,
          ref: existingBom.ref
        });
        return bomId;
      }

      // Step 2: BOM doesn't exist, create it
      logger.debug('BOM not found, creating new BOM for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentNumber
      });

      // Generate BOM ref: BOM-<parent-number> or use product ID as fallback
      const bomRef = parentNumber ? `BOM-${parentNumber}` : `BOM-${parentProductId}`;
      const bomLabel = parentNumber ? `BOM for ${parentNumber}` : `BOM for ${parentProductId}`;

      // Validate that parentProductId is set
      if (!parentProductId) {
        const error = new Error('parentProductId is required to create BOM');
        error.code = 'VALIDATION_ERROR';
        throw error;
      }

      // Ensure fk_product is a number (Dolibarr expects numeric ID)
      const fkProduct = typeof parentProductId === 'number' 
        ? parentProductId 
        : parseInt(parentProductId, 10);
      
      if (isNaN(fkProduct)) {
        const error = new Error(`Invalid parentProductId: ${parentProductId}`);
        error.code = 'VALIDATION_ERROR';
        throw error;
      }

      // Create new BOM payload (flat format, without request_data wrapper)
      const payload = {
        ref: bomRef,           // Required field for Dolibarr
        label: bomLabel,
        fk_product: fkProduct,  // Required field - link to parent product (must be numeric)
        qty: 1,
        bomtype: 0,            // 0 = Fertigung
        status: 0              // 0 = Entwurf / Draft
      };

      logger.debug('Creating Dolibarr BOM', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation: 'ensureBomForProduct',
        method: 'POST',
        url: '/boms',
        payload: payload,
        parentProductId,
        parentNumber,
        fk_product: fkProduct  // Explicitly log fk_product for debugging
      });

      const createResponse = await apiClient.post('/boms', payload);
      
      // Handle different possible response structures
      const newBom = createResponse.data?.bom || 
                    createResponse.data?.data ||
                    createResponse.data || 
                    createResponse;
      
      const bomId = newBom.id || newBom.rowid;

      if (!bomId) {
        logger.error('BOM created but no ID returned in response', {
          source: 'dolibarr',
          operation,
          parentProductId,
          parentNumber,
          response: createResponse.data
        });
        throw new Error('BOM created but no ID returned in response');
      }

      logger.info('ensureBomForProduct: created new BOM in Dolibarr', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId: bomId,
        bomId: bomId,
        ref: bomRef,
        label: newBom.label || bomLabel,
        fk_product: fkProduct,
        parentNumber
      });

      return bomId;
    } catch (error) {
      // Log detailed error information including Dolibarr response
      logger.error('Failed to create BOM in Dolibarr', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation: 'ensureBomForProduct',
        parentProductId,
        parentNumber,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        payload: {
          ref: parentNumber ? `BOM-${parentNumber}` : `BOM-${parentProductId}`,
          label: parentNumber ? `BOM for ${parentNumber}` : `BOM for ${parentProductId}`,
          bomtype: 0,
          fk_product: parentProductId,
          qty: 1,
          status: 0
        }
      });

      const structuredError = createStructuredError(error, operation, { parentProductId, parentNumber });
      
      logger.error('Failed to ensure BOM exists for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentNumber,
        code: structuredError.code,
        status: structuredError.status,
        retryable: structuredError.retryable
      });

      throw structuredError;
    }
  });
}

/**
 * Ensure BOM exists for a product, create if it doesn't
 * @param {Object} params - BOM parameters
 * @param {number} params.productId - Product ID
 * @param {string} [params.parentNumber] - Parent product number/ref (optional, for BOM ref generation)
 * @param {Array} [params.lines] - BOM lines (for reference, not used in this function)
 * @returns {Promise<Object>} - BOM object with id, label, fk_product, etc.
 * @deprecated Use ensureBomForProduct(parentProductId, parentNumber) instead, which returns just the BOM ID
 */
async function ensureBomExistsForProduct({ productId, parentNumber, lines }) {
  const operation = 'ensureBomExistsForProduct';
  
  // Use the new function and convert to old format for backward compatibility
  const bomId = await ensureBomForProduct(productId, parentNumber);
  
  // Get full BOM details
  try {
    const bomResponse = await apiClient.get(`/boms/${bomId}`);
    const bom = bomResponse.data?.bom || bomResponse.data || bomResponse;
    return bom;
  } catch (error) {
    // If we can't get full details, return minimal object
    return { id: bomId, fk_product: productId };
  }
}

/**
 * Create a single BOM line in Dolibarr
 * Based on Dolibarr API: POST /boms/{id}/lines calls Boms::postLine($id, $request_data)
 * where $request_data is an object with at least fk_product and qty
 * 
 * Example request to POST /boms/123/lines:
 * {
 *   "fk_product": 456,
 *   "qty": 2,
 *   "position": 10,
 *   "qty_frozen": 0,
 *   "disable_stock_change": 0,
 *   "efficiency": 100,
 *   "fk_bom_child": null,
 *   "import_key": "FM-001",
 *   "fk_unit": null
 * }
 * 
 * Required fields: fk_product, qty
 * Optional fields: position, qty_frozen, disable_stock_change, efficiency, 
 *                  fk_bom_child, import_key, fk_unit, array_options, fk_default_workstation
 * 
 * @param {number} bomId - BOM ID
 * @param {Object} line - BOM line object with childProductId (Dolibarr product ID), quantity, and optional fields
 * @param {number} line.childProductId - Dolibarr product ID (required)
 * @param {number} line.quantity - Quantity (required)
 * @param {number|string} [line.position] - Position/line number (optional)
 * @param {boolean} [dryRun=false] - If true, only log what would be done
 * @returns {Promise<Object>} - Created BOM line object with id
 */
async function createBomLine(bomId, line, dryRun = false) {
  const operation = 'createBomLine';
  
  // Validate required fields
  if (!line.childProductId) {
    const error = new Error('childProductId is required for BOM line');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  
  if (dryRun) {
    logger.info('DryRun: would create BOM line', {
      source: 'dolibarr',
      operation,
      bomId,
      childProductId: line.childProductId,
      quantity: line.quantity || 1,
      position: line.position
    });
    return { id: null, bomId, childProductId: line.childProductId };
  }
  
  return retryWithBackoff(async () => {
    try {
      // Validate qty is numeric
      const qty = line.quantity || 1;
      const qtyParsed = parseFloat(qty);
      if (isNaN(qtyParsed) || qtyParsed <= 0) {
        const error = new Error(`Invalid quantity for BOM line: ${qty}`);
        error.code = 'VALIDATION_ERROR';
        throw error;
      }

      // Build payload object for Dolibarr API
      // Dolibarr expects: { "fk_product": ..., "qty": ..., "position": ... }
      const requestDataPayload = {
        fk_product: line.childProductId,
        qty: qtyParsed
      };
      
      // Add optional fields if provided
      if (line.position !== undefined && line.position !== null) {
        requestDataPayload.position = typeof line.position === 'number' 
          ? line.position 
          : parseInt(line.position, 10);
      }
      
      // Additional optional fields that Dolibarr supports (can be extended)
      if (line.qtyFrozen !== undefined) {
        requestDataPayload.qty_frozen = line.qtyFrozen;
      }
      if (line.disableStockChange !== undefined) {
        requestDataPayload.disable_stock_change = line.disableStockChange;
      }
      if (line.efficiency !== undefined) {
        requestDataPayload.efficiency = line.efficiency;
      }
      if (line.fkBomChild !== undefined) {
        requestDataPayload.fk_bom_child = line.fkBomChild;
      }
      if (line.importKey !== undefined) {
        requestDataPayload.import_key = line.importKey;
      }
      if (line.fkUnit !== undefined) {
        requestDataPayload.fk_unit = line.fkUnit;
      }

      // Send payload directly (without request_data wrapper)
      const payload = requestDataPayload;
      
      logger.debug('Creating BOM line', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId,
        method: 'POST',
        url: `/boms/${bomId}/lines`,
        payload
      });
      
      // POST /boms/{bomId}/lines with flat payload format
      const createResponse = await apiClient.post(`/boms/${bomId}/lines`, payload);
      
      // Handle different possible response structures
      const newLine = createResponse.data?.line || 
                     createResponse.data?.data ||
                     createResponse.data || 
                     createResponse;
      
      logger.info('Created Dolibarr BOM line', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId,
        childProductId: line.childProductId,
        quantity: qtyParsed,
        position: requestDataPayload.position,
        responseId: newLine.id || newLine.rowid,
        endpoint: `/boms/${bomId}/lines`
      });
      
      return newLine;
    } catch (error) {
      const structuredError = createStructuredError(error, operation, {
        bomId,
        childProductId: line.childProductId
      });
      
      const errorStatus = error.response?.status;
      const errorData = error.response?.data || {};
      const errorMessage = errorData.message || error.message || '';
      
      // Check if it's a server error (5xx) indicating BOM lines are not supported
      if (errorStatus >= 500) {
        // Check if error indicates BOM line API issue (e.g., api_boms.class.php / postLine)
        const isBomLineApiError = errorMessage.includes('api_boms') || 
                                  errorMessage.includes('postLine') ||
                                  errorData.file?.includes('api_boms') ||
                                  errorData.trace?.some?.(frame => frame?.file?.includes('api_boms'));
        
        if (isBomLineApiError) {
          structuredError.bomLinesUnsupported = true;
          structuredError.retryable = false; // Don't retry if API is fundamentally broken
        }
      }
      
      // Check if it's a validation error (missing required fields)
      // Don't retry on 400/500 if it's a validation issue
      if (errorStatus === 400 || errorStatus === 500) {
        if (errorMessage.includes('fk_product') || errorMessage.includes('qty') || 
            errorMessage.includes('required') || errorMessage.includes('missing') ||
            errorMessage.includes('ref')) {
          structuredError.retryable = false;
        }
      }
      
      logger.error('Failed to create BOM line', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId,
        childProductId: line.childProductId,
        method: 'POST',
        url: `/boms/${bomId}/lines`,
        payload: {
          fk_product: line.childProductId,
          qty: line.quantity || 1,
          position: line.position
        },
        code: structuredError.code,
        status: structuredError.status,
        statusText: error.response?.statusText,
        retryable: structuredError.retryable,
        bomLinesUnsupported: structuredError.bomLinesUnsupported || false,
        dolibarrResponse: error.response?.data
      });
      
      throw structuredError;
    }
  });
}

/**
 * Get BOM lines for a BOM from Dolibarr
 * Enriches lines with product ref if not already present
 * @param {number} bomId - BOM ID
 * @returns {Promise<Array>} - Array of BOM line objects with product_ref if available
 */
async function getBomLinesForBom(bomId) {
  const operation = 'getBomLinesForBom';
  
  try {
    logger.debug('Loading BOM lines', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId,
        method: 'GET',
        url: `/boms/${bomId}/lines`
      });

      const getLinesResponse = await apiClient.get(`/boms/${bomId}/lines`);
      
      // Handle different possible response structures
    let lines = [];
      if (Array.isArray(getLinesResponse.data)) {
      lines = getLinesResponse.data;
      } else if (getLinesResponse.data?.lines) {
      lines = getLinesResponse.data.lines;
      } else if (getLinesResponse.data?.data) {
      lines = getLinesResponse.data.data;
      } else if (getLinesResponse.data) {
      lines = [getLinesResponse.data];
    }

    // Enrich lines with product ref if fk_product is present but product_ref is missing
    // Batch load product refs to avoid too many API calls
    const productIdsToLoad = new Set();
    const lineProductMap = new Map();
    
    for (const line of lines) {
      if (line.fk_product && !line.product_ref && !line.ref) {
        const productId = String(line.fk_product);
        productIdsToLoad.add(productId);
        if (!lineProductMap.has(productId)) {
          lineProductMap.set(productId, []);
        }
        lineProductMap.get(productId).push(line);
      }
    }
    
    // Batch load product refs
    if (productIdsToLoad.size > 0) {
      logger.debug('Loading product refs for BOM lines', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          bomId,
        productCount: productIdsToLoad.size
      });
      
      for (const productId of productIdsToLoad) {
        try {
          const productResponse = await apiClient.get(`/products/${productId}`);
          const product = productResponse.data?.product || productResponse.data || productResponse;
          if (product && product.ref) {
            // Set product_ref for all lines with this product ID
            const linesForProduct = lineProductMap.get(productId);
            if (linesForProduct) {
              linesForProduct.forEach(line => {
                line.product_ref = product.ref;
              });
            }
          }
        } catch (productError) {
          // If product lookup fails, continue without ref (will use fk_product as fallback)
          logger.debug('Could not load product ref for BOM line', {
                service: 'fusion-dolibarr-integration',
                source: 'dolibarr',
                operation,
                bomId,
            fk_product: productId,
            error: productError.message
          });
        }
      }
    }

    return lines;
  } catch (error) {
    logger.error('Failed to load BOM lines', {
                  service: 'fusion-dolibarr-integration',
                  source: 'dolibarr',
                  operation,
                  bomId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Normalize BOM lines for comparison
 * Creates a comparable structure with key, childRef, qty, position
 * @param {Array} lines - Array of BOM line objects
 * @param {string} source - Source identifier ('fusion' or 'dolibarr')
 * @returns {Array} - Normalized BOM lines
 */
function normalizeBomLines(lines, source) {
  return lines.map(line => {
    // Extract child reference (product ref/number)
    let childRef = null;
    if (source === 'fusion') {
      // For Fusion lines: use childNumber
      childRef = line.childNumber || line.childRef || String(line.childProductId || '');
    } else {
      // For Dolibarr lines: try multiple possible fields for product ref
      // Dolibarr may return: product_ref, ref, fk_product (as ID), or product object with ref
      childRef = line.product_ref || 
                 line.ref || 
                 (line.product && (line.product.ref || line.product.product_ref)) ||
                 String(line.fk_product || '');
    }
    
    // Extract quantity
    const qty = Number(line.qty || line.quantity || line.qty_frozen || 0);
    
    // Extract position (Dolibarr may use 'rang' or 'position')
    const position = Number(line.position || line.rang || line.sortorder || 0);
    
    // Create key: childRef|position
    const key = `${childRef}|${position}`;
    
    return {
      key,
      childRef: String(childRef),
      qty,
      position,
      _raw: line,
      _source: source,
      _lineId: line.id || line.rowid || null  // Keep line ID for Dolibarr lines
    };
  });
}

/**
 * Full replace of BOM lines (delete all, create all)
 * @param {number} bomId - BOM ID
 * @param {Array} lines - Array of BOM line objects with { childProductId, quantity, position }
 * @param {boolean} [dryRun=false] - If true, only log what would be done
 * @returns {Promise<Object>} - { bomId, written, planned, deletedCount, skippedCount, bomLineSyncUnsupported, errors }
 */
async function fullReplaceBomLines(bomId, lines, dryRun = false, progressCallback = null) {
  const operation = 'fullReplaceBomLines';
  
  if (dryRun || !bomId) {
    logger.info('DryRun: would full replace BOM lines', {
      service: 'fusion-dolibarr-integration',
      source: 'dolibarr',
      operation,
      bomId: bomId || 'N/A',
      lineCount: lines.length
    });
    return { bomId: bomId || null, written: 0, planned: lines.length, deletedCount: 0, skippedCount: 0 };
  }
  
  return retryWithBackoff(async () => {
    try {
      // Get existing lines
      const existingLines = await getBomLinesForBom(bomId);
      
      // Delete all existing lines
      let deletedCount = 0;
      for (const line of existingLines) {
        const lineId = line.id || line.rowid;
        if (lineId) {
          try {
            await apiClient.delete(`/boms/${bomId}/lines/${lineId}`);
            deletedCount++;
          } catch (deleteError) {
            const deleteStatus = deleteError.response?.status;
            if (deleteStatus === 404) {
              continue; // Already deleted
            }
            if (deleteStatus >= 500) {
              throw deleteError;
            }
            // Other errors: log but continue
          }
        }
      }
      
      // Create new lines
      let written = 0;
      let skippedCount = 0;
      const errors = [];
      let bomLineSyncUnsupported = false;
      const totalLines = lines.length;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        try {
          // Send progress update before creating line
          if (progressCallback) {
            try {
              const percent = Math.floor(((i + 1) / totalLines) * 100);
              progressCallback({
                step: 'create_bom_lines',
                message: `BOM-Zeile ${i + 1}/${totalLines} erstellen`,
                percent: percent,
                current: i + 1,
                total: totalLines
              });
            } catch (progressError) {
              logger.warn('Error sending BOM line create progress', { error: progressError.message });
            }
          }
          
          await createBomLine(bomId, {
            childProductId: line.childProductId,
            quantity: line.quantity,
            position: line.position
          }, dryRun);
          written++;
        } catch (createError) {
          const createStatus = createError.response?.status;
          const isValidationError = createError.code === 'VALIDATION_ERROR' || 
                                   (createStatus >= 400 && createStatus < 500 && !createError.retryable);
          
          if (isValidationError) {
            skippedCount++;
            errors.push({
              childProductId: line.childProductId,
              quantity: line.quantity,
              position: line.position,
              error: createError.message,
              code: createError.code,
              status: createStatus
            });
            continue;
          }
          
          if (createStatus >= 500) {
            if (createError.bomLinesUnsupported === true) {
              bomLineSyncUnsupported = true;
              break;
            }
            throw createError;
          }
          
          throw createError;
        }
      }
      
      return {
        bomId,
        written,
        planned: lines.length,
        deletedCount,
        skippedCount,
        bomLineSyncUnsupported,
        errors: errors.length > 0 ? errors : undefined
      };
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { bomId });
      throw structuredError;
    }
  });
}

/**
 * Replace BOM lines using diff strategy (create/update/delete only changed lines)
 * Falls back to full replace for large changes
 * @param {number} bomId - BOM ID
 * @param {Array} lines - Array of BOM line objects with { childProductId, quantity, position, childNumber }
 * @param {Array} existingLines - Array of existing Dolibarr BOM line objects
 * @param {boolean} [dryRun=false] - If true, only log what would be done
 * @returns {Promise<Object>} - { bomId, written, planned, deletedCount, updatedCount, skippedCount, bomLineSyncUnsupported, errors, usedFullReplace }
 */
async function replaceBomLinesWithDiff(bomId, lines, existingLines, dryRun = false, onProgress = null) {
  const operation = 'replaceBomLinesWithDiff';
  
  if (dryRun || !bomId) {
    logger.info('DryRun: would sync BOM lines via diff', {
              service: 'fusion-dolibarr-integration',
              source: 'dolibarr',
              operation,
      bomId: bomId || 'N/A',
      lineCount: lines.length
    });
    return { bomId: bomId || null, written: 0, planned: lines.length, deletedCount: 0, updatedCount: 0, skippedCount: 0, usedFullReplace: false };
  }
  
  // Ensure onProgress is a function that accepts object format
  const progressCallback = onProgress && typeof onProgress === 'function' ? onProgress : null;
  
  return retryWithBackoff(async () => {
    try {
      // Normalize both sides
      const normalizedTarget = normalizeBomLines(lines.map(l => ({
        childNumber: l.childNumber || String(l.childProductId),
        qty: l.quantity,
        position: l.position
      })), 'fusion');
      
      const normalizedExisting = normalizeBomLines(existingLines, 'dolibarr');
      
      // Build maps for comparison
      const existingByKey = new Map();
      normalizedExisting.forEach(l => existingByKey.set(l.key, l));
      
      const targetByKey = new Map();
      normalizedTarget.forEach(l => targetByKey.set(l.key, l));
      
      // Calculate diff
      const toCreate = [];
      const toUpdate = [];
      const toDelete = [];
      
      // Find lines to create or update
      for (const targetLine of normalizedTarget) {
        const existingLine = existingByKey.get(targetLine.key);
        if (!existingLine) {
          // New line
          toCreate.push(targetLine);
        } else if (existingLine.qty !== targetLine.qty || existingLine.position !== targetLine.position) {
          // Line exists but changed
          toUpdate.push({ existing: existingLine, target: targetLine });
        }
        // If identical, do nothing
      }
      
      // Find lines to delete
      for (const existingLine of normalizedExisting) {
        if (!targetByKey.has(existingLine.key)) {
          toDelete.push(existingLine);
        }
      }
      
      // Check if change is too large for diff strategy
      const totalExisting = normalizedExisting.length;
      const totalTarget = normalizedTarget.length;
      const changeCount = toCreate.length + toUpdate.length + toDelete.length;
      const bigChange = totalTarget > 200 || changeCount > totalTarget * 0.5;
      
      if (bigChange) {
        logger.info('Large change detected, using full replace strategy', {
                service: 'fusion-dolibarr-integration',
                source: 'dolibarr',
                operation,
                bomId,
          totalExisting,
          totalTarget,
          changeCount,
          threshold: Math.max(200, totalTarget * 0.5)
        });
        
        // Fallback to full replace
        const fullReplaceResult = await fullReplaceBomLines(bomId, lines, dryRun, progressCallback);
        return {
          ...fullReplaceResult,
          updatedCount: 0,
          usedFullReplace: true
        };
      }
      
      // Execute diff operations
      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      let skippedCount = 0;
      const errors = [];
      let bomLineSyncUnsupported = false;
      
      // Delete lines
      for (const lineToDelete of toDelete) {
        const lineId = lineToDelete._lineId;
        if (lineId) {
          try {
            await apiClient.delete(`/boms/${bomId}/lines/${lineId}`);
            deletedCount++;
          } catch (deleteError) {
            const deleteStatus = deleteError.response?.status;
            if (deleteStatus === 404) {
              continue;
            }
            if (deleteStatus >= 500) {
              throw deleteError;
            }
            logger.warn('Failed to delete BOM line', {
                service: 'fusion-dolibarr-integration',
                source: 'dolibarr',
                operation,
                bomId,
              lineId,
              status: deleteStatus
            });
          }
        }
      }
      
      // Update lines (delete old, create new)
      for (const { existing, target } of toUpdate) {
        const lineId = existing._lineId;
        if (lineId) {
          try {
            // Delete old line
            await apiClient.delete(`/boms/${bomId}/lines/${lineId}`);
            
            // Create new line with updated values
            // Find original line data to get childProductId
            const originalLine = lines.find(l => {
              const normalized = normalizeBomLines([{
                childNumber: l.childNumber || String(l.childProductId),
                qty: l.quantity,
                position: l.position
              }], 'fusion')[0];
              return normalized.key === target.key;
            });
            
            if (originalLine) {
              await createBomLine(bomId, {
                childProductId: originalLine.childProductId,
                quantity: target.qty,
                position: target.position
              }, dryRun);
              updatedCount++;
            }
          } catch (updateError) {
            const updateStatus = updateError.response?.status;
            if (updateStatus >= 500 && updateError.bomLinesUnsupported === true) {
              bomLineSyncUnsupported = true;
              break;
            }
            if (updateStatus >= 500) {
              throw updateError;
            }
            skippedCount++;
            errors.push({
              key: target.key,
              error: updateError.message,
              code: updateError.code,
              status: updateStatus
            });
          }
        }
      }
      
      // Create new lines
      let createdIndex = 0;
      const totalToCreate = toCreate.length;
      
      logger.info('Starting BOM line creation', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation: 'replaceBomLinesWithDiff',
        bomId,
        lineCount: totalToCreate,
        hasProgressCallback: !!progressCallback
      });
      
      // Send initial progress for BOM line creation phase
      if (progressCallback && totalToCreate > 0) {
        try {
          logger.debug('Sending initial BOM line create progress', {
            totalToCreate,
            hasCallback: !!progressCallback
          });
          progressCallback({
            step: 'create_bom_lines',
            message: `BOM-Zeilen erstellen: Starte (0/${totalToCreate})...`,
            percent: 0,
            current: 0,
            total: totalToCreate
          });
        } catch (progressError) {
          logger.warn('Error sending initial BOM line create progress', { error: progressError.message });
        }
      } else if (totalToCreate === 0) {
        logger.debug('No BOM lines to create', { bomId });
        // Send completion event even if no lines to create
        if (progressCallback) {
          try {
            progressCallback({
              step: 'create_bom_lines',
              message: 'Keine neuen BOM-Zeilen zu erstellen',
              percent: 100,
              current: 0,
              total: 0
            });
          } catch (progressError) {
            logger.warn('Error sending BOM line completion for empty list', { error: progressError.message });
          }
        }
      } else if (!progressCallback) {
        logger.debug('No progress callback provided for BOM line creation');
      }
      
      for (const targetLine of toCreate) {
        try {
          // Find original line data
          const originalLine = lines.find(l => {
            const normalized = normalizeBomLines([{
              childNumber: l.childNumber || String(l.childProductId),
              qty: l.quantity,
              position: l.position
            }], 'fusion')[0];
            return normalized.key === targetLine.key;
          });
          
          if (originalLine) {
            createdIndex++;
            
            // Send progress update with detailed info BEFORE creating the line
            if (progressCallback) {
              try {
                const percent = Math.floor((createdIndex / totalToCreate) * 100);
                const progressData = {
                  step: 'bom_lines',
                  phase: 'creating',
                  context: 'bomLines',
                  current: createdIndex,
                  total: totalToCreate,
                  message: `BOM-Zeile ${createdIndex}/${totalToCreate} wird erstellt...`,
                  percent: percent,
                  position: targetLine.position,
                  quantity: targetLine.qty
                };
                
                // Log every 10th update or first/last
                if (createdIndex === 1 || createdIndex % 10 === 0 || createdIndex === totalToCreate) {
                  logger.debug('Sending BOM line create progress', {
                    createdIndex,
                    totalToCreate,
                    percent
                  });
                }
                
                progressCallback(progressData);
              } catch (progressError) {
                logger.warn('Error sending BOM line create progress', { 
                  error: progressError.message,
                  createdIndex,
                  totalToCreate
                });
              }
            }
            
            await createBomLine(bomId, {
              childProductId: originalLine.childProductId,
              quantity: targetLine.qty,
              position: targetLine.position
            }, dryRun);
            createdCount++;
          }
        } catch (createError) {
          const createStatus = createError.response?.status;
          if (createStatus >= 500 && createError.bomLinesUnsupported === true) {
            bomLineSyncUnsupported = true;
            break;
          }
          if (createStatus >= 500) {
            throw createError;
          }
          const isValidationError = createError.code === 'VALIDATION_ERROR' || 
                                   (createStatus >= 400 && createStatus < 500 && !createError.retryable);
          if (isValidationError) {
            skippedCount++;
            errors.push({
              key: targetLine.key,
              error: createError.message,
              code: createError.code,
              status: createStatus
            });
            continue;
          }
          throw createError;
        }
      }

      logger.info('BOM lines synced via diff', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation: 'replaceBomLines',
        bomId,
        plannedCount: normalizedTarget.length,
        createdCount,
        updatedCount,
        deletedCount,
        skippedCount,
        usedFullReplace: false
      });
      
      // Send completion signal if we created lines
      if (progressCallback && totalToCreate > 0) {
        try {
          progressCallback({
            step: 'create_bom_lines',
            message: `BOM-Zeilen-Erstellung abgeschlossen: ${createdCount}/${totalToCreate}`,
            percent: 100,
            current: createdCount,
            total: totalToCreate
          });
        } catch (progressError) {
          logger.warn('Error sending BOM line completion', { error: progressError.message });
        }
      }
      
      logger.info('BOM line creation completed', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation: 'replaceBomLinesWithDiff',
        bomId,
        createdCount,
        totalToCreate,
        updatedCount,
        deletedCount
      });
      
      return {
        bomId, 
        written: createdCount + updatedCount,
        planned: normalizedTarget.length,
        deletedCount,
        updatedCount,
        skippedCount,
        bomLineSyncUnsupported,
        errors: errors.length > 0 ? errors : undefined,
        usedFullReplace: false
      };
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { bomId });
      throw structuredError;
    }
  });
}

/**
 * Replace all BOM lines for a BOM
 * Uses diff strategy for small changes, full replace for large changes
 * @param {number} bomId - BOM ID
 * @param {Array} lines - Array of BOM line objects with { childProductId, quantity, position, childNumber }
 * @param {boolean} [dryRun=false] - If true, only log what would be done
 * @returns {Promise<Object>} - { bomId, written, planned, deletedCount, updatedCount, skippedCount, bomLineSyncUnsupported, errors, usedFullReplace }
 */
async function replaceBomLines(bomId, lines, dryRun = false, onProgress = null) {
  const operation = 'replaceBomLines';
  
  if (dryRun || !bomId) {
    logger.info('DryRun: would replace BOM lines in Dolibarr', {
      service: 'fusion-dolibarr-integration',
      source: 'dolibarr',
      operation,
      bomId: bomId || 'N/A',
      lineCount: lines.length
    });
    return { bomId: bomId || null, written: 0, planned: lines.length, deletedCount: 0, updatedCount: 0, skippedCount: 0, usedFullReplace: false };
  }
  
  try {
    // Load existing lines
    const existingLines = await getBomLinesForBom(bomId);
    
    logger.info('Loaded existing BOM lines', {
      service: 'fusion-dolibarr-integration',
      source: 'dolibarr',
      operation,
      bomId,
      lineCount: existingLines.length,
      lineIds: existingLines.map(l => l.id || l.rowid).filter(Boolean)
    });
    
    // Use diff strategy
    return await replaceBomLinesWithDiff(bomId, lines, existingLines, dryRun, onProgress);
    } catch (error) {
      const structuredError = createStructuredError(error, operation, { bomId });
      
      logger.error('Failed to replace BOM lines for BOM', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        bomId,
        code: structuredError.code,
        status: structuredError.status,
        retryable: structuredError.retryable,
        dolibarrResponse: error.response?.data
      });

      throw structuredError;
    }
}

/**
 * Sync BOM lines from Fusion Manage to Dolibarr
 * Ensures child products exist, creates/updates BOM, and replaces all BOM lines
 * @param {Object} params - Sync parameters
 * @param {number} params.parentProductId - Dolibarr product ID of parent
 * @param {string} params.parentRef - Dolibarr product ref (for logging)
 * @param {Array<Object>} params.bomLines - Array of FusionBomLine objects from getBomForItem
 * @param {boolean} [params.dryRun=false] - If true, only log what would be done
 * @returns {Promise<Object>} - { bomId: number|null, linesWritten: number }
 */
async function syncBomLinesForProduct({ parentProductId, parentRef, bomLines, dryRun = false, onProgress }) {
  const operation = 'syncBomLinesForProduct';
  
  logger.info('Syncing BOM lines for product', {
    service: 'fusion-dolibarr-integration',
    source: 'dolibarr',
    operation,
    parentProductId,
    parentRef,
    lineCount: bomLines.length,
    bomLinesPlanned: bomLines.length,
    dryRun
  });
  
  if (!bomLines || bomLines.length === 0) {
    logger.debug('No BOM lines to sync', {
      service: 'fusion-dolibarr-integration',
      source: 'dolibarr',
      operation,
      parentProductId
    });
    return { bomId: null, linesWritten: 0, skippedCount: 0 };
  }
  
  try {
    // Step 1: Ensure all child products exist in Dolibarr
    const dolibarrBomLines = [];
    const skippedItems = [];
    const totalLines = bomLines.length;
    
    for (let i = 0; i < bomLines.length; i++) {
      const bomLine = bomLines[i];
      
      // Validate child number
      if (!bomLine.childNumber) {
        logger.warn('Skipping BOM line without childNumber', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          index: i,
          childId: bomLine.childId
        });
        skippedItems.push({
          index: i,
          childId: bomLine.childId,
          reason: 'Missing childNumber'
        });
        continue;
      }
      
      const childNumber = String(bomLine.childNumber).trim();
      const childDescription = bomLine.childDescription || childNumber;
      const quantity = bomLine.qty || 1;
      
      try {
        let childProduct;
        if (!dryRun) {
          // Send progress: Product wird erstellt/geprüft
          if (onProgress && typeof onProgress === 'function') {
            onProgress({
              step: 'ensure_products',
              message: `Produkt prüfen/erstellen: ${childNumber}`,
              current: i + 1,
              total: totalLines,
              percent: Math.round(((i + 1) / totalLines) * 100)
            });
            onProgress({
              phase: 'product',
              current: i + 1,
              total: totalLines,
              message: `Produkt prüfen/erstellen: ${childNumber}`,
              itemNumber: childNumber,
              itemDescription: childDescription,
              position: bomLine.position || ((i + 1) * 10)
            });
          }
          
          // CRITICAL: Ensure child product exists BEFORE adding BOM line
          // This prevents VALIDATION_ERROR for missing fk_product
          childProduct = await ensureProductExists({
            ref: childNumber,
            label: childDescription,
            description: childDescription
          });
          
          // Send progress: Product erstellt
          if (onProgress && typeof onProgress === 'function') {
            onProgress({
              phase: 'product',
              current: i + 1,
              total: totalLines,
              message: `Produkt bereit: ${childNumber} (ID: ${childProduct.id})`,
              itemNumber: childNumber,
              itemDescription: childDescription,
              productId: childProduct.id,
              position: bomLine.position || ((i + 1) * 10)
            });
          }
          
          // Validate that product was created successfully
          if (!childProduct || !childProduct.id) {
            throw new Error(`Child product created but no ID returned for: ${childNumber}`);
          }
        } else {
          // Mock product for dry run
          childProduct = { id: null, ref: childNumber };
        }
        
        // Validate quantity is numeric
        const qtyParsed = parseFloat(quantity);
        if (isNaN(qtyParsed) || qtyParsed <= 0) {
          logger.warn('Invalid quantity in BOM line, using default 1', {
            service: 'fusion-dolibarr-integration',
            source: 'dolibarr',
            operation,
            childNumber,
            quantity: quantity
          });
          quantity = 1;
        }
        
        // Build BOM line for Dolibarr
        const dolibarrLine = {
          childProductId: childProduct.id,
          quantity: isNaN(qtyParsed) ? 1 : qtyParsed,
          childNumber: childNumber  // Include childNumber for comparison
        };
        
        // Add position if provided (or use index-based position)
        if (bomLine.position !== undefined && bomLine.position !== null) {
          dolibarrLine.position = typeof bomLine.position === 'number' 
            ? bomLine.position 
            : parseInt(bomLine.position, 10);
        } else {
          // Default position: 10, 20, 30... (Dolibarr convention)
          dolibarrLine.position = (i + 1) * 10;
        }
        
        // Only add line if childProductId is valid (not null)
        if (childProduct.id) {
          dolibarrBomLines.push(dolibarrLine);
          
          // Send progress: BOM-Line vorbereitet
          if (onProgress && typeof onProgress === 'function') {
            onProgress({
              phase: 'bom_line_prepare',
              current: i + 1,
              total: totalLines,
              message: `BOM-Zeile vorbereitet: ${childNumber} (Pos: ${dolibarrLine.position}, Menge: ${dolibarrLine.quantity})`,
              itemNumber: childNumber,
              itemDescription: childDescription,
              productId: childProduct.id,
              position: dolibarrLine.position,
              quantity: dolibarrLine.quantity
            });
          }
          
          logger.debug('Child product ensured and BOM line prepared', {
            service: 'fusion-dolibarr-integration',
            source: 'dolibarr',
            operation,
            childNumber,
            childProductId: childProduct.id,
            quantity: dolibarrLine.quantity,
            position: dolibarrLine.position,
            dryRun
          });
        } else {
          logger.warn('Skipping BOM line - child product ID is null', {
            service: 'fusion-dolibarr-integration',
            source: 'dolibarr',
            operation,
            childNumber,
            dryRun
          });
          skippedItems.push({
            index: i,
            childId: bomLine.childId,
            childNumber: childNumber,
            reason: 'Child product ID is null'
          });
        }
      } catch (childError) {
        logger.error('Failed to ensure child product, skipping BOM line', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          childNumber,
          error: childError.message,
          code: childError.code,
          status: childError.status,
          dolibarrResponse: childError.response?.data
        });
        skippedItems.push({
          index: i,
          childId: bomLine.childId,
          childNumber: childNumber,
          reason: `Failed to create product: ${childError.message}`
        });
        // Continue with next item
      }
    }
    
    if (dolibarrBomLines.length === 0 && bomLines.length > 0) {
      const error = new Error('No valid BOM lines could be processed');
      logger.error('BOM sync failed: no valid lines', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        totalLines: bomLines.length,
        skippedItems: skippedItems.length
      });
      throw error;
    }
    
    // Step 2: Ensure BOM exists for parent product and get its ID
    // Pass parentRef (parentNumber) to generate BOM ref like "BOM-<product-number>"
    let bomId;
    if (!dryRun) {
      bomId = await ensureBomForProduct(parentProductId, parentRef);
      logger.debug('BOM ensured for product', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentRef,
        bomId
      });
    } else {
      // Mock BOM ID for dry run
      bomId = null;
    }
    
    // Step 3: Check if BOM is already up to date (skip if identical)
    if (!dryRun && bomId) {
      try {
        const existingLines = await getBomLinesForBom(bomId);
        
        // Normalize both sides for comparison
        const normalizedFusion = normalizeBomLines(dolibarrBomLines.map(l => ({
          childNumber: l.childNumber || String(l.childProductId),
          qty: l.quantity,
          position: l.position
        })), 'fusion');
        
        const normalizedDolibarr = normalizeBomLines(existingLines, 'dolibarr');
        
        // Check if identical
        if (normalizedFusion.length === normalizedDolibarr.length) {
          let isIdentical = true;
          const fusionByKey = new Map();
          normalizedFusion.forEach(l => fusionByKey.set(l.key, l));
          
          for (const dolibarrLine of normalizedDolibarr) {
            const fusionLine = fusionByKey.get(dolibarrLine.key);
            if (!fusionLine || 
                fusionLine.childRef !== dolibarrLine.childRef ||
                fusionLine.qty !== dolibarrLine.qty ||
                fusionLine.position !== dolibarrLine.position) {
              isIdentical = false;
              break;
            }
          }
          
          if (isIdentical) {
            logger.info('BOM already up to date, skipping replace', {
              service: 'fusion-dolibarr-integration',
              source: 'dolibarr',
              operation: 'syncBomLinesForProduct',
              parentRef,
              bomId,
              lineCount: normalizedFusion.length
            });
            
            return {
              bomId: bomId,
              linesWritten: normalizedFusion.length,
              skippedCount: skippedItems.length,
              bomLineSyncUnsupported: false,
              errors: undefined,
              alreadyUpToDate: true
            };
          }
        }
      } catch (compareError) {
        // If comparison fails, continue with normal sync
        logger.warn('Failed to compare BOM lines, proceeding with sync', {
          service: 'fusion-dolibarr-integration',
          source: 'dolibarr',
          operation,
          bomId,
          error: compareError.message
        });
      }
    }
    
    // Step 4: Replace all BOM lines for this specific BOM
    let linesWritten = 0;
    let skippedCount = 0;
    let errors = [];
    let bomLineSyncUnsupported = false;
    
    // Create progress callback for BOM line creation phase
    // This will be called by replaceBomLinesWithDiff with object format
    const bomLineCreateProgress = onProgress ? (progressData) => {
      if (onProgress && typeof onProgress === 'function') {
        // If it's already an object, pass it through (new format with step/context)
        if (typeof progressData === 'object' && progressData !== null) {
          onProgress(progressData);
        } else {
          // Legacy format: (created, total) - convert to new format
          const created = progressData;
          const total = arguments[1] || bomLines.length;
          const percent = total > 0 ? Math.floor((created / total) * 100) : 0;
          onProgress({
            step: 'bom_lines',
            phase: 'creating',
            context: 'bomLines',
            current: created,
            total: total,
            message: `BOM-Zeile ${created}/${total} in Dolibarr erstellen...`,
            percent: percent
          });
        }
      }
    } : null;
    
    const replaceResult = await replaceBomLines(bomId, dolibarrBomLines, dryRun, bomLineCreateProgress);
    linesWritten = replaceResult.written || 0;
    skippedCount = replaceResult.skippedCount || 0;
    bomLineSyncUnsupported = replaceResult.bomLineSyncUnsupported === true;
    if (replaceResult.errors) {
      errors = replaceResult.errors;
    }
    
    // Combine skipped items from child product creation and BOM line creation
    const totalSkippedCount = skippedItems.length + skippedCount;
    const allErrors = errors;
    
    // If BOM line sync is unsupported, log warning but don't throw error
    if (bomLineSyncUnsupported) {
      logger.warn('BOM line sync is not supported on this Dolibarr instance; only BOM header was synchronized', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentRef,
        bomId: bomId,
        totalLines: bomLines.length,
        writtenLines: linesWritten,
        skippedLines: totalSkippedCount
      });
    } else {
      logger.info('BOM lines synced successfully', {
        service: 'fusion-dolibarr-integration',
        source: 'dolibarr',
        operation,
        parentProductId,
        parentRef,
        bomId: bomId,
        lineCount: bomLines.length,
        bomLinesPlanned: bomLines.length,
        bomLinesWritten: linesWritten,
        skippedCount: totalSkippedCount,
        dryRun
      });
    }
    
    return {
      bomId: bomId,
      linesWritten: linesWritten,
      skippedCount: totalSkippedCount,
      bomLineSyncUnsupported: bomLineSyncUnsupported,
      errors: allErrors.length > 0 ? allErrors : undefined
    };
  } catch (error) {
    logger.error('Failed to sync BOM lines', {
      service: 'fusion-dolibarr-integration',
      source: 'dolibarr',
      operation,
      parentProductId,
      parentRef,
      error: error.message,
      code: error.code,
      status: error.status,
      dolibarrResponse: error.response?.data
    });
    throw error;
  }
}

module.exports = {
  request,
  ensureProductExists,
  getBomForProduct,
  ensureBomForProduct,
  ensureBomExistsForProduct,
  createBomLine,
  replaceBomLines,
  syncBomLinesForProduct,
  // Export apiClient for advanced use cases
  apiClient
};
