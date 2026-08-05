const axios = require('axios');
const { config } = require('../../config/default');
const logger = require('../utils/logger');

class FusionManageClient {
    constructor() {
        this.accessToken = null;
        this.tokenExpiry = null;
    }

    async authenticate() {
        try {
            const response = await axios.post(
                config.fusionManage.authUrl,
                new URLSearchParams({
                    grant_type: 'client_credentials',
                    client_id: config.fusionManage.clientId,
                    client_secret: config.fusionManage.clientSecret,
                    scope: 'data:read data:write'
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            this.accessToken = response.data.access_token;
            // Set expiry to 5 minutes before actual expiry for safety
            this.tokenExpiry = Date.now() + (response.data.expires_in - 300) * 1000;

            logger.info('Fusion Manage authentication successful');
            return this.accessToken;
        } catch (error) {
            logger.error('Fusion Manage authentication failed:', error.response?.data || error.message);
            throw new Error('Failed to authenticate with Fusion Manage');
        }
    }

    async ensureAuthenticated() {
        if (!this.accessToken || Date.now() >= this.tokenExpiry) {
            await this.authenticate();
        }
        return this.accessToken;
    }

    async getItemDetails(workspaceId, itemDmsId) {
        try {
            await this.ensureAuthenticated();

            const url = `${config.fusionManage.apiBaseUrl}/api/rest/v1/workspaces/${workspaceId}/items/${itemDmsId}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            logger.info(`Retrieved item details for ${itemDmsId}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to get item details for ${itemDmsId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async getBOM(workspaceId, itemDmsId, options = {}) {
        try {
            await this.ensureAuthenticated();

            const {
                depth = 10,
                filterDeleted = true,
                effectiveDate = null,
                revisionBias = 'released'
            } = options;

            const params = new URLSearchParams({
                depth: depth.toString(),
                filterDeleted: filterDeleted.toString(),
                revisionBias
            });

            if (effectiveDate) {
                params.append('effectiveDate', effectiveDate);
            }

            const url = `${config.fusionManage.apiBaseUrl}/api/rest/v1/workspaces/${workspaceId}/items/${itemDmsId}/boms?${params}`;

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Accept': 'application/json'
                }
            });

            logger.info(`Retrieved BOM for item ${itemDmsId} with depth ${depth}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to get BOM for ${itemDmsId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    async addBOMItems(workspaceId, itemDmsId, bomItems) {
        try {
            await this.ensureAuthenticated();

            const url = `${config.fusionManage.apiBaseUrl}/api/rest/v1/workspaces/${workspaceId}/items/${itemDmsId}/boms`;

            const response = await axios.post(url, bomItems, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });

            logger.info(`Added BOM items to ${itemDmsId}`);
            return response.data;
        } catch (error) {
            logger.error(`Failed to add BOM items to ${itemDmsId}:`, error.response?.data || error.message);
            throw error;
        }
    }
}

module.exports = new FusionManageClient();
