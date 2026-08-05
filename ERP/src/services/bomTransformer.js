const logger = require('../utils/logger');

class BOMTransformer {
    /**
     * Transform Fusion Manage BOM structure to Dolibarr format
     * @param {Object} fusionBOM - BOM data from Fusion Manage
     * @param {Object} fusionItem - Item details from Fusion Manage
     * @returns {Object} Transformed BOM data for Dolibarr
     */
    transformBOM(fusionBOM, fusionItem) {
        try {
            logger.info(`Transforming BOM for item: ${fusionItem.title || fusionItem.dmsId}`);

            // Extract main product information
            const mainProduct = {
                ref: this.extractProductRef(fusionItem),
                label: fusionItem.title || fusionItem.descriptor || 'Untitled',
                description: fusionItem.description || '',
                type: 0, // 0 = product, 1 = service
                status: 1 // 1 = on sale
            };

            // Transform BOM lines
            const bomLines = this.transformBOMLines(fusionBOM);

            // Create Dolibarr BOM structure
            const dolibarrBOM = {
                ref: `BOM-${mainProduct.ref}`,
                label: `BOM for ${mainProduct.label}`,
                description: `Bill of Materials imported from Fusion Manage`,
                fk_product: null, // Will be set after product creation
                qty: 1,
                efficiency: 1,
                lines: bomLines
            };

            return {
                mainProduct,
                bom: dolibarrBOM,
                bomLines
            };
        } catch (error) {
            logger.error('BOM transformation failed:', error);
            throw new Error(`Failed to transform BOM: ${error.message}`);
        }
    }

    /**
     * Extract product reference from Fusion item
     */
    extractProductRef(fusionItem) {
        // Try to get item number, otherwise use DMS ID
        return fusionItem.itemNumber ||
            fusionItem.number ||
            fusionItem.dmsId ||
            `FM-${fusionItem.urn}`;
    }

    /**
     * Transform BOM lines from Fusion Manage to Dolibarr format
     */
    transformBOMLines(fusionBOM) {
        if (!fusionBOM || !fusionBOM.items || fusionBOM.items.length === 0) {
            logger.warn('No BOM items found');
            return [];
        }

        const lines = [];

        fusionBOM.items.forEach((bomItem, index) => {
            try {
                const line = {
                    // Core Dolibarr BOM line fields
                    fk_product: null, // Will be resolved by product ref later
                    qty: bomItem.quantity || 1,
                    qty_frozen: 0,
                    efficiency: 1,
                    position: index + 1,

                    // Additional fields for reference (used during resolution)
                    _product_ref: this.extractBOMItemRef(bomItem),
                    _product_label: bomItem.item?.title || bomItem.item?.descriptor || 'Unknown',
                    _description: bomItem.item?.description || ''
                };

                // Add custom fields if available
                if (bomItem.fields && bomItem.fields.length > 0) {
                    line.array_options = this.transformCustomFields(bomItem.fields);
                }

                lines.push(line);
            } catch (error) {
                logger.warn(`Failed to transform BOM line ${index}:`, error.message);
            }
        });

        logger.info(`Transformed ${lines.length} BOM lines`);
        return lines;
    }

    /**
     * Extract product reference from BOM item
     */
    extractBOMItemRef(bomItem) {
        if (!bomItem.item) {
            return `UNKNOWN-${Date.now()}`;
        }

        return bomItem.item.itemNumber ||
            bomItem.item.number ||
            bomItem.item.dmsId ||
            `FM-${bomItem.bomDmsID}`;
    }

    /**
     * Transform custom fields from Fusion Manage to Dolibarr
     */
    transformCustomFields(fields) {
        const customFields = {};

        fields.forEach(field => {
            if (field.value !== null && field.value !== undefined) {
                // Clean field name for Dolibarr
                const fieldName = field.title?.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() || field.urn;
                customFields[fieldName] = field.value;
            }
        });

        return customFields;
    }

    /**
     * Flatten hierarchical BOM if needed
     * Dolibarr supports hierarchical BOMs, but this method can flatten if required
     */
    flattenBOM(fusionBOM, maxDepth = 10) {
        const flatItems = [];

        const traverse = (items, depth = 0, parentPath = '') => {
            if (depth > maxDepth) return;

            items.forEach((bomItem, index) => {
                const currentPath = parentPath ? `${parentPath}.${index}` : `${index}`;

                flatItems.push({
                    ...bomItem,
                    depth,
                    path: currentPath
                });

                // Recursively traverse child items if they exist
                if (bomItem.children && bomItem.children.length > 0) {
                    traverse(bomItem.children, depth + 1, currentPath);
                }
            });
        };

        if (fusionBOM && fusionBOM.items) {
            traverse(fusionBOM.items);
        }

        return flatItems;
    }
}

module.exports = new BOMTransformer();
