require('dotenv').config();

/**
 * Configuration loader from environment variables
 * 
 * Required environment variables:
 * - FUSION_CLIENT_ID: Autodesk Platform Services Client ID
 * - FUSION_CLIENT_SECRET: Autodesk Platform Services Client Secret
 * - FUSION_TENANT_ID: Fusion Manage tenant ID (e.g., contelosuxdemo)
 * - FUSION_WORKSPACE_ID: Fusion Manage workspace ID (e.g., 57 for Items)
 * - FUSION_API_BASE_URL: Fusion Manage API base URL (e.g., https://contelosuxdemo.autodeskplm360.net)
 * - DOLIBARR_API_URL: Dolibarr API endpoint (e.g., http://localhost:9030/dolibarr/api/index.php)
 * - DOLIBARR_API_KEY: Dolibarr API key for authentication
 * 
 * Optional environment variables:
 * - PORT: Server port (default: 3000)
 * - NODE_ENV: Environment (default: development)
 * - LOG_LEVEL: Logging level (default: info)
 * - LOG_FILE: Main log file path (default: logs/integration.log)
 * - DB_PATH: SQLite database path (default: ./data/transfers.db)
 * - WEBHOOK_SECRET: Secret for webhook signature verification (optional, but recommended)
 * - WEBHOOK_CALLBACK_URL: Webhook callback URL for documentation (optional)
 * - SYNC_SCHEDULE: Cron expression for scheduled syncs (optional, e.g., "0 2 * * *")
 * - APS_CLIENT_ID: Autodesk Platform Services Client ID (for 3-legged OAuth, optional)
 * - APS_CALLBACK_URL: OAuth callback URL (default: http://localhost:3000/auth/callback)
 * - APS_SCOPES: OAuth scopes (default: "data:read data:write account:read")
 * - APS_AUTH_BASE_URL: APS authentication base URL (default: https://developer.api.autodesk.com)
 * - SESSION_SECRET: Secret for express-session (required for OAuth flows)
 */

const config = {
  fusionManage: {
    clientId: process.env.FUSION_CLIENT_ID,
    clientSecret: process.env.FUSION_CLIENT_SECRET,
    tenantId: process.env.FUSION_TENANT_ID,
    workspaceId: process.env.FUSION_WORKSPACE_ID,
    apiBaseUrl: process.env.FUSION_API_BASE_URL,
    authUrl: 'https://developer.api.autodesk.com/authentication/v2/token'
  },
  
  dolibarr: {
    apiUrl: process.env.DOLIBARR_API_URL,
    apiKey: process.env.DOLIBARR_API_KEY
  },
  
  webhook: {
    secret: process.env.WEBHOOK_SECRET || null,
    callbackUrl: process.env.WEBHOOK_CALLBACK_URL || null
  },
  
  server: {
    port: process.env.PORT || 3000,
    env: process.env.NODE_ENV || 'development'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/integration.log',
    errorFile: process.env.LOG_ERROR_FILE || 'logs/error.log'
  },
  
  db: {
    path: process.env.DB_PATH || './data/transfers.db'
  },
  
  sync: {
    schedule: process.env.SYNC_SCHEDULE || null
  },
  
  auth: {
    clientId: process.env.APS_CLIENT_ID || process.env.FUSION_CLIENT_ID || null,
    callbackUrl: process.env.APS_CALLBACK_URL || 'http://localhost:3000/auth/callback',
    scopes: process.env.APS_SCOPES || 'data:read data:write account:read',
    baseUrl: process.env.APS_AUTH_BASE_URL || 'https://developer.api.autodesk.com',
    authorizeUrl: 'https://developer.api.autodesk.com/authentication/v2/authorize',
    tokenUrl: 'https://developer.api.autodesk.com/authentication/v2/token'
  },
  
  session: {
    secret: process.env.SESSION_SECRET || null
  }
};

/**
 * Validate configuration with strict checks
 * Throws error with detailed message if validation fails
 */
function validateConfig() {
  const errors = [];
  
  // Helper to check if value is missing or empty
  const isMissing = (value) => {
    return value === undefined || value === null || value === '';
  };
  
  // Helper to add error with context
  const addError = (path, envVar) => {
    errors.push(`  - ${path} (env: ${envVar})`);
  };
  
  // Required Fusion Manage configuration
  if (isMissing(config.fusionManage.clientId)) {
    addError('fusionManage.clientId', 'FUSION_CLIENT_ID');
  }
  if (isMissing(config.fusionManage.clientSecret)) {
    addError('fusionManage.clientSecret', 'FUSION_CLIENT_SECRET');
  }
  if (isMissing(config.fusionManage.tenantId)) {
    addError('fusionManage.tenantId', 'FUSION_TENANT_ID');
  }
  if (isMissing(config.fusionManage.workspaceId)) {
    addError('fusionManage.workspaceId', 'FUSION_WORKSPACE_ID');
  }
  if (isMissing(config.fusionManage.apiBaseUrl)) {
    addError('fusionManage.apiBaseUrl', 'FUSION_API_BASE_URL');
  }
  
  // Required Dolibarr configuration
  if (isMissing(config.dolibarr.apiUrl)) {
    addError('dolibarr.apiUrl', 'DOLIBARR_API_URL');
  }
  if (isMissing(config.dolibarr.apiKey)) {
    addError('dolibarr.apiKey', 'DOLIBARR_API_KEY');
  }
  
  // Validate URL formats
  if (config.fusionManage.apiBaseUrl && !isValidUrl(config.fusionManage.apiBaseUrl)) {
    errors.push(`  - fusionManage.apiBaseUrl: Invalid URL format (${config.fusionManage.apiBaseUrl})`);
  }
  if (config.dolibarr.apiUrl && !isValidUrl(config.dolibarr.apiUrl)) {
    errors.push(`  - dolibarr.apiUrl: Invalid URL format (${config.dolibarr.apiUrl})`);
  }
  
  // Validate port number
  if (config.server.port) {
    const port = parseInt(config.server.port, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      errors.push(`  - server.port: Must be a number between 1 and 65535 (got: ${config.server.port})`);
    }
  }
  
  // Validate log level
  const validLogLevels = ['error', 'warn', 'info', 'debug', 'verbose', 'silly'];
  if (config.logging.level && !validLogLevels.includes(config.logging.level.toLowerCase())) {
    errors.push(`  - logging.level: Must be one of ${validLogLevels.join(', ')} (got: ${config.logging.level})`);
  }
  
  // Validate environment
  const validEnvs = ['development', 'production', 'test'];
  if (config.server.env && !validEnvs.includes(config.server.env.toLowerCase())) {
    errors.push(`  - server.env: Must be one of ${validEnvs.join(', ')} (got: ${config.server.env})`);
  }
  
  // Note: Auth and session config are optional for 2-legged OAuth
  // They are only required for 3-legged OAuth with PKCE
  // Validation warnings are handled in src/config/index.js
  
  // If errors found, throw with detailed message
  if (errors.length > 0) {
    const errorMessage = [
      'Configuration validation failed:',
      '',
      'Missing or invalid required configuration:',
      ...errors,
      '',
      'Please check your .env file and ensure all required variables are set.',
      'See config/default.js for documentation of required environment variables.'
    ].join('\n');
    
    throw new Error(errorMessage);
  }
}

/**
 * Simple URL validation
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid URL format
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

module.exports = { config, validateConfig };
