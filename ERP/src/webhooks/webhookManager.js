const axios = require('axios');
const { config } = require('../../config/default');
const logger = require('../utils/logger');

class WebhookManager {
    constructor() {
        this.webhookId = null;
    }

    /**
     * Register webhook with Autodesk Platform Services
     */
    async registerWebhook() {
        try {
            // Get OAuth token for webhook registration
            const token = await this.getWebhookToken();

            const webhookData = {
                callbackUrl: config.webhook.callbackUrl,
                scope: {
                    workspace: config.fusionManage.workspaceId
                },
                hookAttribute: {
                    // Optional: filter for specific events
                    // For now, we listen to all item.update events
                }
            };

            const response = await axios.post(
                'https://developer.api.autodesk.com/webhooks/v1/systems/adsk.flc.production/events/item.update/hooks',
                webhookData,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            this.webhookId = response.data.hookId;
            logger.info(`Webhook registered successfully. Hook ID: ${this.webhookId}`);

            return this.webhookId;
        } catch (error) {
            logger.error('Failed to register webhook:', error.response?.data || error.message);

            // Don't throw error - allow service to start without webhook
            logger.warn('Service will continue without webhook. Manual transfers will still work.');
            return null;
        }
    }

    /**
     * Get OAuth token for webhook operations
     */
    async getWebhookToken() {
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

            return response.data.access_token;
        } catch (error) {
            logger.error('Failed to get webhook token:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Verify webhook signature for security
     */
    verifyWebhookSignature(payload, signature) {
        // Implement signature verification based on Autodesk's webhook security
        // For now, we'll use a simple secret-based verification

        if (!config.webhook.secret) {
            logger.warn('No webhook secret configured - skipping signature verification');
            return true;
        }

        // TODO: Implement proper HMAC signature verification
        // This is a placeholder for demonstration
        return true;
    }

    /**
     * Unregister webhook on shutdown
     */
    async unregisterWebhook() {
        if (!this.webhookId) {
            logger.info('No webhook to unregister');
            return;
        }

        try {
            const token = await this.getWebhookToken();

            await axios.delete(
                `https://developer.api.autodesk.com/webhooks/v1/systems/adsk.flc.production/events/item.update/hooks/${this.webhookId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            logger.info(`Webhook ${this.webhookId} unregistered successfully`);
            this.webhookId = null;
        } catch (error) {
            logger.error('Failed to unregister webhook:', error.response?.data || error.message);
        }
    }

    /**
     * List all registered webhooks
     */
    async listWebhooks() {
        try {
            const token = await this.getWebhookToken();

            const response = await axios.get(
                'https://developer.api.autodesk.com/webhooks/v1/systems/adsk.flc.production/events/item.update/hooks',
                {
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                }
            );

            logger.info(`Found ${response.data.data?.length || 0} registered webhooks`);
            return response.data.data || [];
        } catch (error) {
            logger.error('Failed to list webhooks:', error.response?.data || error.message);
            return [];
        }
    }
}

module.exports = new WebhookManager();
