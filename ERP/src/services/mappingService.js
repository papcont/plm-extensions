const logger = require('../logger');

/**
 * Mapping Service for transforming Fusion Manage data to Dolibarr format
 * 
 * This service handles:
 * - Field mapping between Fusion Manage and Dolibarr
 * - Value normalization and conversion (units, types, etc.)
 * - Data validation and sanitization
 */

/**
 * Unit conversion map for common units
 * Maps Fusion Manage units to Dolibarr-compatible units
 */
const UNIT_MAP = {
  'pcs': 'pcs',
  'piece': 'pcs',
  'pieces': 'pcs',
  'stk': 'pcs',
  'stück': 'pcs',
  'kg': 'kg',
  'kilogram': 'kg',
  'g': 'g',
  'gram': 'g',
  'm': 'm',
  'meter': 'm',
  'mm': 'mm',
  'millimeter': 'mm',
  'cm': 'cm',
  'centimeter': 'cm',
  'l': 'l',
  'liter': 'l',
  'ml': 'ml',
  'milliliter': 'ml'
};

/**
 * Normalize unit string to standard format
 * @param {string} unit - Unit string from Fusion Manage
 * @returns {string} - Normalized unit string
 */
function normalizeUnit(unit) {
  if (!unit) {
    return null;
  }
  
  const normalized = unit.trim().toLowerCase();
  return UNIT_MAP[normalized] || normalized;
}

/**
 * Map Fusion Manage item to Dolibarr product data
 * @param {Object} fusionItem - Fusion Manage item object
 * @returns {Object} - Dolibarr product data { ref, label, description }
 */
function mapItemToProduct(fusionItem) {
  if (!fusionItem) {
    throw new Error('Fusion item is required for mapping');
  }

  // Extract and validate item number (required for Dolibarr ref)
  const itemNumber = fusionItem.itemNumber || fusionItem.number || fusionItem.itemId;
  if (!itemNumber) {
    throw new Error('Item number is required for Dolibarr product reference');
  }

  // Map fields with fallbacks
  const productData = {
    ref: String(itemNumber).trim(), // Product reference (must be unique)
    label: (fusionItem.description || fusionItem.title || itemNumber).trim(),
    description: (fusionItem.description || fusionItem.title || itemNumber).trim()
  };

  // Sanitize: remove null/undefined, ensure strings
  Object.keys(productData).forEach(key => {
    if (!productData[key]) {
      productData[key] = productData.ref; // Fallback to ref if empty
    }
  });

  logger.debug('Mapped Fusion item to Dolibarr product', {
    fusionItemId: fusionItem.itemId,
    itemNumber: productData.ref,
    label: productData.label
  });

  return productData;
}

/**
 * Map Fusion Manage BOM line to Dolibarr BOM line data
 * Supports both old format (with childItem/item) and new format (BomItem with childNumber/qty)
 * @param {Object} bomLine - Fusion Manage BOM line object (old format) or BomItem (new format)
 * @param {string} parentItemId - Parent item ID for reference
 * @returns {Object} - Dolibarr BOM line data { childProductRef, quantity, unit, description }
 */
function mapBomLineToDolibarr(bomLine, parentItemId) {
  if (!bomLine) {
    throw new Error('BOM line is required for mapping');
  }

  let childNumber;
  let quantity;
  let description;
  let unit = null;

  // Check if this is the new BomItem format (has childNumber and qty directly)
  if (bomLine.childNumber && bomLine.qty !== undefined) {
    // New format: BomItem structure
    childNumber = bomLine.childNumber;
    quantity = parseFloat(bomLine.qty);
    description = bomLine.childLabel || bomLine.childNumber;
  } else {
    // Old format: Legacy structure with nested childItem
    const childItem = bomLine.childItem || bomLine.item || bomLine;
    childNumber = childItem.number || childItem.itemNumber || bomLine.childNumber || bomLine.childItemId;
    
    // Extract and normalize quantity
    quantity = parseFloat(bomLine.quantity || bomLine.qty || 1);
    
    // Extract description
    description = childItem.description || childItem.title || bomLine.description || childNumber;
    
    // Extract and normalize unit (only in old format)
    unit = normalizeUnit(bomLine.unit || bomLine.unitOfMeasure || bomLine.uom);
  }
  
  if (!childNumber) {
    throw new Error('Child item number is required for BOM line mapping');
  }

  // Validate and normalize quantity
  if (isNaN(quantity) || quantity <= 0) {
    logger.warn('Invalid quantity in BOM line, defaulting to 1', {
      bomLine,
      parentItemId,
      quantity: bomLine.qty || bomLine.quantity
    });
    quantity = 1;
  }

  const bomLineData = {
    childProductRef: String(childNumber).trim(),
    quantity: quantity,
    unit: unit,
    description: description || childNumber
  };

  logger.debug('Mapped Fusion BOM line to Dolibarr format', {
    parentItemId,
    childProductRef: bomLineData.childProductRef,
    quantity: bomLineData.quantity,
    unit: bomLineData.unit,
    format: bomLine.childNumber ? 'new' : 'old'
  });

  return bomLineData;
}

/**
 * Map multiple Fusion Manage BOM lines to Dolibarr format
 * @param {Array} bomLines - Array of Fusion Manage BOM lines
 * @param {string} parentItemId - Parent item ID for reference
 * @returns {Array} - Array of Dolibarr BOM line data
 */
function mapBomLinesToDolibarr(bomLines, parentItemId) {
  if (!Array.isArray(bomLines)) {
    return [];
  }

  const mappedLines = [];
  const errors = [];

  for (let i = 0; i < bomLines.length; i++) {
    try {
      const mappedLine = mapBomLineToDolibarr(bomLines[i], parentItemId);
      mappedLines.push(mappedLine);
    } catch (error) {
      errors.push({
        index: i,
        bomLine: bomLines[i],
        error: error.message
      });
      logger.warn(`Failed to map BOM line ${i + 1}`, {
        parentItemId,
        error: error.message,
        bomLine: bomLines[i]
      });
    }
  }

  if (errors.length > 0) {
    logger.warn(`Failed to map ${errors.length} out of ${bomLines.length} BOM lines`, {
      parentItemId,
      errors: errors.map(e => e.error)
    });
  }

  return mappedLines;
}

/**
 * Validate mapped product data before sending to Dolibarr
 * @param {Object} productData - Mapped product data
 * @returns {Object} - Validation result { valid, errors }
 */
function validateProductData(productData) {
  const errors = [];

  if (!productData.ref || productData.ref.trim() === '') {
    errors.push('Product reference (ref) is required');
  }

  if (!productData.label || productData.label.trim() === '') {
    errors.push('Product label is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate mapped BOM line data
 * @param {Object} bomLineData - Mapped BOM line data
 * @returns {Object} - Validation result { valid, errors }
 */
function validateBomLineData(bomLineData) {
  const errors = [];

  if (!bomLineData.childProductRef || bomLineData.childProductRef.trim() === '') {
    errors.push('Child product reference is required');
  }

  if (!bomLineData.quantity || bomLineData.quantity <= 0) {
    errors.push('Quantity must be greater than 0');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  mapItemToProduct,
  mapBomLineToDolibarr,
  mapBomLinesToDolibarr,
  normalizeUnit,
  validateProductData,
  validateBomLineData
};

