/**
 * Central configuration module
 * 
 * This module loads and validates configuration from config/default.js
 * which reads from environment variables via dotenv.
 * 
 * Required environment variables (must be set in .env):
 * ====================================================
 * 
 * Fusion Manage:
 * - FUSION_CLIENT_ID: Autodesk Platform Services Client ID
 * - FUSION_CLIENT_SECRET: Autodesk Platform Services Client Secret
 * - FUSION_TENANT_ID: Fusion Manage tenant ID (e.g., contelosuxdemo)
 * - FUSION_WORKSPACE_ID: Fusion Manage workspace ID (e.g., 57 for Items)
 * - FUSION_API_BASE_URL: Fusion Manage API base URL
 *   (e.g., https://contelosuxdemo.autodeskplm360.net)
 * 
 * Dolibarr:
 * - DOLIBARR_API_URL: Dolibarr API endpoint
 *   (e.g., http://localhost:9030/dolibarr/api/index.php)
 * - DOLIBARR_API_KEY: Dolibarr API key for authentication
 * 
 * Optional environment variables (have safe defaults):
 * ====================================================
 * - PORT: Server port (default: 3000)
 * - NODE_ENV: Environment (default: development)
 * - LOG_LEVEL: Logging level (default: info)
 * - LOG_FILE: Main log file path (default: logs/integration.log)
 * - LOG_ERROR_FILE: Error log file path (default: logs/error.log)
 * - DB_PATH: SQLite database path (default: ./data/transfers.db)
 * - WEBHOOK_SECRET: Secret for webhook signature verification (optional)
 * - WEBHOOK_CALLBACK_URL: Webhook callback URL for documentation (optional)
 * - SYNC_SCHEDULE: Cron expression for scheduled syncs (optional)
 * - APS_CLIENT_ID: Autodesk Platform Services Client ID (for 3-legged OAuth)
 * - APS_CALLBACK_URL: OAuth callback URL (default: http://localhost:3000/auth/callback)
 * - APS_SCOPES: OAuth scopes (default: "data:read data:write account:read")
 * - APS_AUTH_BASE_URL: APS authentication base URL (default: https://developer.api.autodesk.com)
 * - SESSION_SECRET: Secret for express-session (required for OAuth flows)
 * 
 * Usage:
 * ======
 * const { config, validateConfig } = require('./config');
 * 
 * // Validate before using (usually done in server.js on startup)
 * validateConfig();
 * 
 * // Access configuration
 * const port = config.server.port;
 * const apiUrl = config.fusionManage.apiBaseUrl;
 */

const { config: defaultConfig, validateConfig: defaultValidateConfig } = require('../../config/default');

/**
 * Structured configuration object
 * All values are read from config/default.js which loads from process.env
 * 
 * Structure:
 * - fusionManage: Fusion Manage API configuration
 * - dolibarr: Dolibarr API configuration
 * - server: Server configuration (port, environment)
 * - logging: Logging configuration (level, file paths)
 * - db: Database configuration (SQLite path)
 * - webhook: Webhook configuration (secret, callback URL)
 * - sync: Scheduled sync configuration (cron expression)
 * - auth: OAuth configuration (clientId, callbackUrl, scopes, URLs)
 * - session: Session configuration (secret)
 */
const config = {
  fusionManage: {
    clientId: defaultConfig.fusionManage.clientId,
    clientSecret: defaultConfig.fusionManage.clientSecret,
    tenantId: defaultConfig.fusionManage.tenantId,
    workspaceId: defaultConfig.fusionManage.workspaceId,
    apiBaseUrl: defaultConfig.fusionManage.apiBaseUrl,
    authUrl: defaultConfig.fusionManage.authUrl
  },
  
  dolibarr: {
    apiUrl: defaultConfig.dolibarr.apiUrl,
    apiKey: defaultConfig.dolibarr.apiKey
  },
  
  server: {
    port: defaultConfig.server.port,
    env: defaultConfig.server.env
  },
  
  logging: {
    level: defaultConfig.logging.level,
    file: defaultConfig.logging.file,
    errorFile: defaultConfig.logging.errorFile
  },
  
  db: {
    path: defaultConfig.db.path
  },
  
  webhook: {
    secret: defaultConfig.webhook.secret,
    callbackUrl: defaultConfig.webhook.callbackUrl
  },
  
  sync: {
    schedule: defaultConfig.sync.schedule
  },
  
  auth: {
    clientId: defaultConfig.auth.clientId,
    clientSecret: defaultConfig.fusionManage.clientSecret || null, // Optional: only for apps that support both PKCE and traditional OAuth
    callbackUrl: defaultConfig.auth.callbackUrl,
    scopes: defaultConfig.auth.scopes,
    baseUrl: defaultConfig.auth.baseUrl,
    authorizeUrl: defaultConfig.auth.authorizeUrl,
    tokenUrl: defaultConfig.auth.tokenUrl
  },
  
  session: {
    secret: defaultConfig.session.secret
  }
};

/**
 * Enhanced validation function
 * Wraps the default validation and adds additional checks
 * 
 * This function is called automatically in server.js on startup.
 * If validation fails, the server will not start and a detailed
 * error message will be displayed.
 */
function validateConfig() {
  // Call the base validation from config/default.js
  // This will throw if required values are missing or invalid
  defaultValidateConfig();
  
  // Additional validation for OAuth configuration
  // Warn if auth config is incomplete (but don't fail for 2-legged OAuth)
  // Note: Using console.warn here to avoid circular dependency with logger
  if (!defaultConfig.auth.clientId) {
    console.warn('Warning: auth.clientId not set - 3-legged OAuth will not be available');
  }
  if (!defaultConfig.auth.callbackUrl) {
    console.warn('Warning: auth.callbackUrl not set - 3-legged OAuth will not be available');
  }
  if (!defaultConfig.session.secret) {
    console.warn('Warning: session.secret not set - Session support may not work properly');
  }
}

module.exports = { config, validateConfig };
