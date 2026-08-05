const express = require('express');
const session = require('express-session');
const cron = require('node-cron');
const { config, validateConfig } = require('./config');
const logger = require('./logger');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');
const db = require('./db/sqlite');
const { syncBomFromFusionToDolibarr } = require('./services/bomSyncService');

// Create Express app
const app = express();

// Middleware to capture raw body for webhook signature verification
// Must be before express.json()
app.use((req, res, next) => {
  if (req.path === '/webhook/fusion-manage' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks);
      next();
    });
    req.on('error', next);
  } else {
    next();
  }
});

// Session middleware (required for 3-legged OAuth with PKCE)
app.use(session({
  secret: config.session.secret || 'local-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Middleware
app.use(express.json());
app.use(requestLogger);

// Serve static files from public directory
app.use(express.static('public'));

// Routes
app.use('/api', routes);
// Webhook routes (mounted directly at root, not under /api)
app.use('/', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Fusion Manage - Dolibarr Integration Service',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/api/health',
      syncBOM: 'POST /api/sync/bom/:itemId',
      syncHistory: 'GET /api/sync/history/:itemId'
    }
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Start server
async function start() {
  try {
    // Validate configuration
    logger.info('Validating configuration...');
    validateConfig();
    logger.info('Configuration validated successfully');

    // Initialize database
    logger.info('Initializing database...');
    await db.initialize();
    logger.info('Database initialized successfully');

    // Log session support status
    if (config.session.secret) {
      logger.info('Session support enabled (required for 3-legged OAuth)');
    } else {
      logger.warn('Session secret not configured - using default (not recommended for production)');
    }

    // Start HTTP server
    const port = config.server.port;
    app.listen(port, () => {
      logger.info(`Server started on port ${port}`);
      logger.info(`Environment: ${config.server.env}`);
      logger.info(`API base: http://localhost:${port}/api`);
      logger.info(`Health check: http://localhost:${port}/api/health`);
      logger.info(`Webhook endpoint: http://localhost:${port}/webhook/fusion-manage`);
      if (config.auth.clientId && config.auth.callbackUrl) {
        logger.info(`OAuth callback URL: ${config.auth.callbackUrl}`);
      }
    });

    // Initialize cron job for scheduled sync (if configured)
    if (config.sync.schedule) {
      logger.info(`Scheduled sync enabled with cron: ${config.sync.schedule}`);
      
      // Validate cron expression
      if (!cron.validate(config.sync.schedule)) {
        logger.error(`Invalid cron expression: ${config.sync.schedule}`);
        throw new Error(`Invalid cron expression: ${config.sync.schedule}`);
      }

      // Schedule the sync job
      const cronJob = cron.schedule(config.sync.schedule, async () => {
        logger.info('Scheduled BOM sync job started');
        
        try {
          // Get list of scheduled items from database
          const scheduledItems = await db.getScheduledItems();
          
          if (scheduledItems.length === 0) {
            logger.info('No scheduled items found - skipping sync');
            return;
          }

          logger.info(`Found ${scheduledItems.length} scheduled items to sync`);

          let successCount = 0;
          let errorCount = 0;

          // Process each item (with error handling to prevent one failure from stopping others)
          for (const itemId of scheduledItems) {
            try {
              logger.debug(`Processing scheduled sync for item: ${itemId}`);
              
              await syncBomFromFusionToDolibarr({ itemId });
              
              successCount++;
              logger.debug(`Scheduled sync completed successfully for item: ${itemId}`);
            } catch (itemError) {
              errorCount++;
              // Error is already logged in syncBomFromFusionToDolibarr
              logger.warn(`Scheduled sync failed for item ${itemId}:`, itemError.message);
              // Continue with next item
            }
          }

          logger.info('Scheduled BOM sync job completed', {
            totalItems: scheduledItems.length,
            successCount,
            errorCount
          });
        } catch (error) {
          logger.error('Scheduled BOM sync job failed:', error.message);
          // Don't throw - cron job should continue running
        }
      }, {
        scheduled: true,
        timezone: 'Europe/Berlin' // Adjust as needed
      });

      logger.info('Scheduled sync job registered and started');
      
      // Store cron job reference for potential cleanup
      app.locals.cronJob = cronJob;
    } else {
      logger.info('Scheduled sync not configured (SYNC_SCHEDULE not set)');
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down gracefully...');
  
  try {
    // Stop cron job if running
    if (app.locals?.cronJob) {
      logger.info('Stopping scheduled sync job...');
      app.locals.cronJob.stop();
      logger.info('Scheduled sync job stopped');
    }

    // Close database connection
    await db.close();
    logger.info('Database connection closed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
start();
