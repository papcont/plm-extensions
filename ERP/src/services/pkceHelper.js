const crypto = require('crypto');

/**
 * PKCE (Proof Key for Code Exchange) Helper Functions
 * 
 * PKCE is a security extension for OAuth 2.0 that prevents authorization code interception attacks.
 * It uses a code verifier and code challenge to ensure that the entity that exchanges the
 * authorization code is the same one that initiated the authorization request.
 */

/**
 * Generate a cryptographically secure random code verifier
 * 
 * According to RFC 7636, the code verifier should be:
 * - A high-entropy cryptographic random string
 * - With a minimum length of 43 characters
 * - Maximum length of 128 characters
 * - Using the unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
 * 
 * @returns {string} - Base64URL-encoded random string (length ~64)
 */
function generateCodeVerifier() {
  // Generate 32 random bytes (256 bits) for high entropy
  const randomBytes = crypto.randomBytes(32);
  
  // Convert to base64url encoding (RFC 4648 Section 5)
  // Base64URL uses - and _ instead of + and /, and omits padding
  const verifier = randomBytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return verifier;
}

/**
 * Generate code challenge from code verifier using SHA256
 * 
 * The code challenge is the SHA256 hash of the code verifier,
 * base64url-encoded (without padding).
 * 
 * @param {string} verifier - The code verifier string
 * @returns {string} - Base64URL-encoded SHA256 hash of the verifier
 */
function generateCodeChallenge(verifier) {
  if (!verifier) {
    throw new Error('Code verifier is required to generate code challenge');
  }
  
  // Create SHA256 hash of the verifier
  const hash = crypto.createHash('sha256').update(verifier).digest();
  
  // Convert to base64url encoding
  const challenge = hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return challenge;
}

module.exports = {
  generateCodeVerifier,
  generateCodeChallenge
};





