/**
 * Middleware to capture raw body for webhook signature verification
 * Must be used before express.json() middleware
 */
function rawBodyParser(req, res, next) {
  const chunks = [];
  
  req.on('data', (chunk) => {
    chunks.push(chunk);
  });
  
  req.on('end', () => {
    req.rawBody = Buffer.concat(chunks);
    next();
  });
  
  req.on('error', (err) => {
    next(err);
  });
}

module.exports = rawBodyParser;





