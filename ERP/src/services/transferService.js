const fusionManageClient = require('../clients/fusionManageClient');
const dolibarrClient = require('../clients/dolibarrClient');
const bomTransformer = require('./bomTransformer');
const database = require('../database/db');
const logger = require('../utils/logger');

class TransferService {
    /**
     * Transfer a BOM from Fusion Manage to Dolibarr
     * @param {string} workspaceId - Fusion Manage workspace ID
     * @param {string} itemDmsId - Fusion Manage item DMS ID
     * @returns {Object} Transfer result
     */
    async transferBOM(workspaceId, itemDmsId) {
        logger.info(`Starting BOM transfer for workspace: ${workspaceId}, item: ${itemDmsId}`);

        try {
            // Step 1: Fetch item details from Fusion Manage
            const itemDetails = await fusionManageClient.getItemDetails(workspaceId, itemDmsId);
            logger.info(`Fetched item details: ${itemDetails.title || itemDmsId}`);

            // Step 2: Fetch BOM from Fusion Manage
            const fusionBOM = await fusionManageClient.getBOM(workspaceId, itemDmsId, {
                depth: 10,
                filterDeleted: true,
                revisionBias: 'released'
            });

            if (!fusionBOM || !fusionBOM.items || fusionBOM.items.length === 0) {
                logger.warn(`No BOM found for item ${itemDmsId}`);

                await database.logTransfer({
                    fusionWorkspaceId: workspaceId,
                    fusionItemDmsId: itemDmsId,
                    fusionItemTitle: itemDetails.title,
                    dolibarrBomId: null,
                    status: 'failed',
                    errorMessage: 'No BOM items found',
                    bomSnapshot: null
                });

                return {
                    success: false,
                    message: 'No BOM items found for this item'
                };
            }

            // Step 3: Transform BOM structure
            const transformedData = bomTransformer.transformBOM(fusionBOM, itemDetails);
            logger.info(`Transformed BOM with ${transformedData.bomLines.length} lines`);

            // Step 4: Ensure main product exists in Dolibarr
            let dolibarrProduct = await dolibarrClient.findProductByRef(transformedData.mainProduct.ref);

            if (!dolibarrProduct) {
                logger.info(`Creating main product in Dolibarr: ${transformedData.mainProduct.ref}`);
                const productId = await dolibarrClient.createProduct(transformedData.mainProduct);
                dolibarrProduct = { id: productId };
            } else {
                logger.info(`Main product already exists: ${transformedData.mainProduct.ref}`);
            }

            // Step 5: Ensure all BOM line products exist in Dolibarr
            await this.ensureBOMLineProducts(transformedData.bomLines);

            // Step 6: Resolve product IDs for BOM lines
            const resolvedLines = await this.resolveBOMLineProductIds(transformedData.bomLines);

            // Step 7: Create or update BOM in Dolibarr
            let dolibarrBomId;
            const existingBOM = await dolibarrClient.findBOMByProductRef(transformedData.mainProduct.ref);

            if (existingBOM) {
                logger.info(`Updating existing BOM ${existingBOM.id} in Dolibarr`);
                dolibarrBomId = existingBOM.id;

                // Update BOM header (without lines)
                const bomHeader = {
                    ref: transformedData.bom.ref,
                    label: transformedData.bom.label,
                    description: transformedData.bom.description,
                    fk_product: dolibarrProduct.id,
                    qty: transformedData.bom.qty,
                    efficiency: transformedData.bom.efficiency
                };
                await dolibarrClient.updateBOM(existingBOM.id, bomHeader);

                // TODO: In a production system, you'd want to sync lines (delete old, add new)
                // For now, we'll just add new lines
            } else {
                logger.info(`Creating new BOM in Dolibarr`);

                // Create BOM header first (without lines)
                const bomHeader = {
                    ref: transformedData.bom.ref,
                    label: transformedData.bom.label,
                    description: transformedData.bom.description,
                    fk_product: dolibarrProduct.id,
                    qty: transformedData.bom.qty || 1,
                    efficiency: transformedData.bom.efficiency || 1
                };

                dolibarrBomId = await dolibarrClient.createBOM(bomHeader);
                logger.info(`Created BOM with ID: ${dolibarrBomId}`);

                // Step 8: Add BOM lines one by one
                logger.info(`Adding ${resolvedLines.length} lines to BOM ${dolibarrBomId}`);
                for (const line of resolvedLines) {
                    try {
                        await dolibarrClient.addBOMLine(dolibarrBomId, line);
                    } catch (error) {
                        logger.warn(`Failed to add line for product ${line.fk_product}:`, error.message);
                    }
                }
            }

            // Step 9: Log successful transfer
            await database.logTransfer({
                fusionWorkspaceId: workspaceId,
                fusionItemDmsId: itemDmsId,
                fusionItemTitle: itemDetails.title,
                dolibarrBomId: dolibarrBomId,
                status: 'success',
                errorMessage: null,
                bomSnapshot: {
                    fusionBOM,
                    transformedData
                }
            });

            logger.info(`BOM transfer completed successfully. Dolibarr BOM ID: ${dolibarrBomId}`);

            return {
                success: true,
                message: 'BOM transferred successfully',
                dolibarrBomId,
                itemsTransferred: transformedData.bomLines.length
            };

        } catch (error) {
            logger.error(`BOM transfer failed for ${itemDmsId}:`, error);

            // Log failed transfer
            await database.logTransfer({
                fusionWorkspaceId: workspaceId,
                fusionItemDmsId: itemDmsId,
                fusionItemTitle: null,
                dolibarrBomId: null,
                status: 'failed',
                errorMessage: error.message,
                bomSnapshot: null
            });

            throw error;
        }
    }

    /**
     * Ensure all BOM line products exist in Dolibarr
     */
    async ensureBOMLineProducts(bomLines) {
        for (const line of bomLines) {
            try {
                let product = await dolibarrClient.findProductByRef(line._product_ref);

                if (!product) {
                    logger.info(`Creating BOM line product: ${line._product_ref}`);
                    await dolibarrClient.createProduct({
                        ref: line._product_ref,
                        label: line._product_label,
                        description: line._description || '',
                        type: 0,
                        status: 1
                    });
                }
            } catch (error) {
                logger.warn(`Failed to ensure product ${line._product_ref}:`, error.message);
            }
        }
    }

    /**
     * Resolve product IDs for BOM lines
     */
    async resolveBOMLineProductIds(bomLines) {
        const resolvedLines = [];

        for (const line of bomLines) {
            try {
                const product = await dolibarrClient.findProductByRef(line._product_ref);

                if (product) {
                    // Create clean line object with only Dolibarr API fields
                    const cleanLine = {
                        fk_product: product.id,
                        qty: line.qty,
                        qty_frozen: line.qty_frozen || 0,
                        efficiency: line.efficiency || 1,
                        position: line.position
                    };

                    // Add array_options if present
                    if (line.array_options) {
                        cleanLine.array_options = line.array_options;
                    }

                    resolvedLines.push(cleanLine);
                } else {
                    logger.warn(`Could not resolve product ID for ${line._product_ref}`);
                }
            } catch (error) {
                logger.warn(`Failed to resolve product ${line._product_ref}:`, error.message);
            }
        }

        return resolvedLines;
    }

    /**
     * Batch transfer multiple BOMs
     */
    async batchTransfer(items) {
        const results = [];

        for (const item of items) {
            try {
                const result = await this.transferBOM(item.workspaceId, item.itemDmsId);
                results.push({
                    ...item,
                    ...result
                });
            } catch (error) {
                results.push({
                    ...item,
                    success: false,
                    message: error.message
                });
            }
        }

        return results;
    }
}

module.exports = new TransferService();
