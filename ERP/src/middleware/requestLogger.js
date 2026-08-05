const logger = require('../logger');

/**
 * Request logging middleware
 * Logs method, URL, status code, and response time
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Log request start
  logger.debug(`${req.method} ${req.originalUrl || req.url} - Request started`);

  // Override res.end to capture response details
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    
    logger.info({
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress
    });

    // Call original end
    originalEnd.call(this, chunk, encoding);
  };

  next();
}

module.exports = requestLogger;





