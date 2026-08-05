const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const router = express.Router();
const logger = require('../logger');
const { config } = require('../config');
const { generateCodeVerifier, generateCodeChallenge } = require('../services/pkceHelper');

/**
 * GET /auth/login
 * Initiates 3-legged OAuth flow with PKCE
 * Redirects user to Autodesk Platform Services authorization page
 * 
 * @route GET /auth/login
 */
router.get('/login', (req, res, next) => {
  try {
    // Validate auth configuration
    if (!config.auth.clientId) {
      logger.error('OAuth login attempted but auth.clientId is not configured');
      return res.status(500).json({
        status: 'error',
        message: 'OAuth not configured. Please set APS_CLIENT_ID in environment variables.'
      });
    }

    if (!config.auth.callbackUrl) {
      logger.error('OAuth login attempted but auth.callbackUrl is not configured');
      return res.status(500).json({
        status: 'error',
        message: 'OAuth callback URL not configured. Please set APS_CALLBACK_URL in environment variables.'
      });
    }

    logger.info('Initiating OAuth login flow with PKCE');

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    
    // Generate state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store in session
    req.session.state = state;
    req.session.codeVerifier = codeVerifier;

    logger.debug('PKCE values generated and stored in session', {
      stateLength: state.length,
      verifierLength: codeVerifier.length,
      challengeLength: codeChallenge.length
    });

    // Build authorization URL
    // Note: URLSearchParams automatically URL-encodes all values
    const scopes = config.auth.scopes.split(' ').join(' '); // Ensure space-separated
    const authParams = new URLSearchParams({
      response_type: 'code',
      client_id: config.auth.clientId,
      redirect_uri: config.auth.callbackUrl,
      scope: scopes,
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login' // Always prompt for login to ensure fresh authentication
    });

    const authUrl = `${config.auth.authorizeUrl}?${authParams.toString()}`;

    logger.info('Redirecting to Autodesk Platform Services authorization page', {
      authorizeUrl: config.auth.authorizeUrl,
      clientId: config.auth.clientId,
      callbackUrl: config.auth.callbackUrl,
      scopes: scopes
    });

    // Redirect to authorization page
    res.redirect(authUrl);
  } catch (error) {
    logger.error('Error initiating OAuth login flow', {
      error: error.message,
      stack: config.server.env !== 'production' ? error.stack : undefined
    });
    next(error);
  }
});

/**
 * GET /auth/callback
 * Handles OAuth callback from Autodesk Platform Services
 * Exchanges authorization code for access token using PKCE
 * 
 * @route GET /auth/callback
 * @query {string} code - Authorization code from APS
 * @query {string} state - State parameter for CSRF protection
 */
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Check for OAuth errors
    if (error) {
      logger.error('OAuth callback received error from APS', {
        error,
        error_description
      });
      return res.status(400).json({
        status: 'error',
        message: `OAuth error: ${error}`,
        error_description: error_description || null
      });
    }

    // Validate required parameters
    if (!code) {
      logger.error('OAuth callback missing authorization code');
      return res.status(400).json({
        status: 'error',
        message: 'Authorization code is required'
      });
    }

    if (!state) {
      logger.error('OAuth callback missing state parameter');
      return res.status(400).json({
        status: 'error',
        message: 'State parameter is required'
      });
    }

    // Validate state to prevent CSRF attacks
    if (!req.session.state) {
      logger.error('OAuth callback: No state found in session');
      return res.status(401).json({
        status: 'error',
        message: 'Session expired or invalid. Please try logging in again.'
      });
    }

    if (state !== req.session.state) {
      logger.error('OAuth callback: State mismatch', {
        received: state,
        expected: req.session.state
      });
      return res.status(401).json({
        status: 'error',
        message: 'State mismatch. Possible CSRF attack or session expired.'
      });
    }

    // Get code verifier from session
    const codeVerifier = req.session.codeVerifier;
    if (!codeVerifier) {
      logger.error('OAuth callback: Code verifier not found in session');
      return res.status(401).json({
        status: 'error',
        message: 'Code verifier not found in session. Please try logging in again.'
      });
    }

    logger.info('Exchanging authorization code for access token', {
      hasCode: !!code,
      hasCodeVerifier: !!codeVerifier
    });

    // Exchange authorization code for access token
    try {
      // Build token request parameters
      // Note: client_secret is only sent if it exists and is not empty
      // PKCE flow typically doesn't require client_secret
      const tokenParams = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.auth.clientId,
        code: code,
        redirect_uri: config.auth.callbackUrl,
        code_verifier: codeVerifier
      });

      // Only add client_secret if it exists and is not empty
      // This is for apps that support both PKCE and traditional OAuth
      if (config.auth.clientSecret && config.auth.clientSecret.trim() !== '') {
        tokenParams.append('client_secret', config.auth.clientSecret);
        logger.debug('Including client_secret in token request');
      } else {
        logger.debug('Skipping client_secret (PKCE-only flow)');
      }

      // Debug logging: Log all parameters that will be sent
      logger.debug('Preparing token exchange', {
        grant_type: 'authorization_code',
        code: req.query.code,
        client_id: config.auth.clientId,
        callbackUrl: config.auth.callbackUrl,
        hasCodeVerifier: !!req.session.codeVerifier,
        hasClientSecret: !!config.auth.clientSecret,
        tokenUrl: config.auth.tokenUrl
      });

      const tokenResponse = await axios.post(
        config.auth.tokenUrl,
        tokenParams,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      const tokenData = tokenResponse.data;
      const accessToken = tokenData.access_token;
      const refreshToken = tokenData.refresh_token || null;
      const expiresIn = tokenData.expires_in || 3600;

      if (!accessToken) {
        throw new Error('Access token not received from token endpoint');
      }

      // Calculate token expiry time
      const expiresAt = Date.now() + (expiresIn * 1000);

      // Store tokens in session
      req.session.fusionAccessToken = accessToken;
      if (refreshToken) {
        req.session.fusionRefreshToken = refreshToken;
      }
      req.session.fusionTokenExpiresAt = expiresAt;

      // Clear PKCE values from session (no longer needed)
      delete req.session.state;
      delete req.session.codeVerifier;

      logger.info('OAuth token exchange successful', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        expiresIn: `${expiresIn}s`,
        expiresAt: new Date(expiresAt).toISOString()
      });

      // Redirect to main page after successful login
      // Show a brief success message before redirect
      res.send(`
        <!DOCTYPE html>
        <html lang="de">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Login erfolgreich</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
              text-align: center;
              max-width: 500px;
            }
            h1 {
              color: #28a745;
              margin-bottom: 20px;
            }
            p {
              color: #666;
              line-height: 1.6;
            }
            .spinner {
              display: inline-block;
              width: 20px;
              height: 20px;
              border: 3px solid #f3f3f3;
              border-top: 3px solid #28a745;
              border-radius: 50%;
              animation: spin 1s linear infinite;
              margin-left: 10px;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ Login erfolgreich</h1>
            <p>Du bist jetzt authentifiziert. Du wirst weitergeleitet...</p>
            <p><small>Token läuft ab: ${new Date(expiresAt).toLocaleString('de-DE')}</small></p>
            <p style="margin-top: 20px;"><span class="spinner"></span></p>
          </div>
          <script>
            // Redirect to main page after 1 second
            setTimeout(function() {
              window.location.href = '/';
            }, 1000);
          </script>
        </body>
        </html>
      `);
    } catch (tokenError) {
      const errorMessage = tokenError.response?.data?.error_description 
        || tokenError.response?.data?.error 
        || tokenError.message;

      logger.error('Token request failed', {
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        error: errorMessage,
        data: tokenError.response?.data,
        hasClientSecret: !!(config.auth.clientSecret && config.auth.clientSecret.trim() !== '')
      });

      // Clear session on error
      delete req.session.state;
      delete req.session.codeVerifier;

      return res.status(500).json({
        error: 'token_exchange_failed',
        details: tokenError.response?.data || { message: errorMessage }
      });
    }
  } catch (error) {
    logger.error('Error in OAuth callback', {
      error: error.message,
      stack: config.server.env !== 'production' ? error.stack : undefined
    });
    next(error);
  }
});

/**
 * GET /auth/logout
 * Logs out the user by destroying the session
 * 
 * @route GET /auth/logout
 */
router.get('/logout', (req, res, next) => {
  try {
    logger.info('User logout requested');

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        logger.error('Error destroying session during logout', {
          error: err.message
        });
        return next(err);
      }

      logger.info('User logged out successfully');
      res.json({
        status: 'ok',
        message: 'Logout erfolgreich'
      });
    });
  } catch (error) {
    logger.error('Error during logout', {
      error: error.message
    });
    next(error);
  }
});

/**
 * GET /auth/status
 * Returns current authentication status
 * 
 * @route GET /auth/status
 */
router.get('/status', (req, res) => {
  const hasToken = !!req.session.fusionAccessToken;
  const hasRefreshToken = !!req.session.fusionRefreshToken;
  const expiresAt = req.session.fusionTokenExpiresAt;
  const isExpired = expiresAt ? Date.now() >= expiresAt : true;

  res.json({
    authenticated: hasToken && !isExpired,
    hasAccessToken: hasToken,
    hasRefreshToken: hasRefreshToken,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    isExpired: isExpired
  });
});

module.exports = router;

