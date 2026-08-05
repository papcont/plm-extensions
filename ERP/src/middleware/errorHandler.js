const logger = require('../logger');
const { config } = require('../config');

/**
 * Central error handling middleware
 * Catches all errors and returns structured JSON response
 */
function errorHandler(err, req, res, next) {
  // Log error
  logger.error({
    error: err.message,
    stack: config.server.env !== 'production' ? err.stack : undefined,
    method: req.method,
    url: req.originalUrl || req.url,
    ip: req.ip || req.connection.remoteAddress
  });

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  // Build error response
  const errorResponse = {
    error: {
      message: err.message || 'Internal Server Error',
      statusCode: statusCode
    }
  };

  // Include stack trace in development
  if (config.server.env !== 'production' && err.stack) {
    errorResponse.error.stack = err.stack;
  }

  // Include additional error details if available
  if (err.details) {
    errorResponse.error.details = err.details;
  }

  res.status(statusCode).json(errorResponse);
}

module.exports = errorHandler;





