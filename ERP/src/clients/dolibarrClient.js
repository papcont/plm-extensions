const axios = require('axios');
const { config } = require('../../config/default');
const logger = require('../utils/logger');

class DolibarrClient {
    constructor() {
        this.apiUrl = config.dolibarr.apiUrl;
        this.apiKey = config.dolibarr.apiKey;
    }

    getHeaders() {
        return {
            'DOLAPIKEY': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
    }

    async findProductByRef(reference) {
        try {
            const url = `${this.apiUrl}/products`;
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                params: {
                    sqlfilters: `t.ref:=:'${reference}'`
                }
            });

            if (response.data && response.data.length > 0) {
                logger.info(`Found product in Dolibarr: ${reference}`);
                return response.data[0];
            }

            logger.warn(`Product not found in Dolibarr: ${reference}`);
            return null;
        } catch (error) {
            logger.error(`Failed to find product ${reference}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async createProduct(productData) {
        try {
            const url = `${this.apiUrl}/products`;
            const response = await axios.post(url, productData, {
                headers: this.getHeaders()
            });

            logger.info(`Created product in Dolibarr: ${productData.ref}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to create product ${productData.ref}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async createBOM(bomData) {
        try {
            const url = `${this.apiUrl}/boms`;

            // Dolibarr API expects request_data format
            const payload = {
                request_data: bomData
            };

            const response = await axios.post(url, payload, {
                headers: this.getHeaders()
            });

            // API returns the BOM ID directly
            const bomId = typeof response.data === 'number' ? response.data : response.data.id;
            logger.info(`Created BOM in Dolibarr with ID: ${bomId}`);
            return bomId;
        } catch (error) {
            logger.error(`Failed to create BOM:`, error.response?.data || error.message);
            throw error;
        }
    }

    async updateBOM(bomId, bomData) {
        try {
            const url = `${this.apiUrl}/boms/${bomId}`;

            const payload = {
                request_data: bomData
            };

            const response = await axios.put(url, payload, {
                headers: this.getHeaders()
            });

            logger.info(`Updated BOM ${bomId} in Dolibarr`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to update BOM ${bomId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getBOM(bomId) {
        try {
            const url = `${this.apiUrl}/boms/${bomId}`;
            const response = await axios.get(url, {
                headers: this.getHeaders()
            });

            logger.info(`Retrieved BOM ${bomId} from Dolibarr`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to get BOM ${bomId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async findBOMByProductRef(productRef) {
        try {
            // First find the product
            const product = await this.findProductByRef(productRef);
            if (!product) {
                return null;
            }

            // Then find BOM for this product
            const url = `${this.apiUrl}/boms`;
            const response = await axios.get(url, {
                headers: this.getHeaders(),
                params: {
                    sqlfilters: `t.fk_product:=:${product.id}`
                }
            });

            if (response.data && response.data.length > 0) {
                logger.info(`Found BOM for product ${productRef}`);
                return response.data[0];
            }

            return null;
        } catch (error) {
            logger.error(`Failed to find BOM for product ${productRef}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async addBOMLine(bomId, lineData) {
        try {
            const url = `${this.apiUrl}/boms/${bomId}/lines`;

            const payload = {
                request_data: lineData
            };

            const response = await axios.post(url, payload, {
                headers: this.getHeaders()
            });

            // API returns the line ID
            const lineId = typeof response.data === 'number' ? response.data : response.data.id;
            logger.info(`Added line to BOM ${bomId}, line ID: ${lineId}`);
            return lineId;
        } catch (error) {
            logger.error(`Failed to add line to BOM ${bomId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getBOMLines(bomId) {
        try {
            const url = `${this.apiUrl}/boms/${bomId}/lines`;
            const response = await axios.get(url, {
                headers: this.getHeaders()
            });

            logger.info(`Retrieved ${response.data?.length || 0} lines for BOM ${bomId}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to get BOM lines for ${bomId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new DolibarrClient();
