/**
 * QueueLess — Firebase Authentication Backend Engine
 * Provides public client config delivery and server-side Phone ID token verification.
 */

const fs = require('fs');
const path = require('path');
let admin = null;
let isFirebaseAdminInitialized = false;
let firebaseAuth = null;

function initFirebaseAdmin() {
  if (isFirebaseAdminInitialized) return true;

  try {
    const adminModule = require('firebase-admin');
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (serviceAccountPath) {
      const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
      if (fs.existsSync(resolvedPath)) {
        const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        adminModule.initializeApp({
          credential: adminModule.credential.cert(serviceAccount)
        });
        admin = adminModule;
        firebaseAuth = adminModule.auth();
        isFirebaseAdminInitialized = true;
        console.log('[FIREBASE ADMIN] Initialized with service account credentials.');
        return true;
      }
    }

    // Alternatively initialize with project ID if running in Google Cloud or test mode
    if (process.env.FIREBASE_PROJECT_ID) {
      adminModule.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID
      });
      admin = adminModule;
      firebaseAuth = adminModule.auth();
      isFirebaseAdminInitialized = true;
      console.log(`[FIREBASE ADMIN] Initialized for project "${process.env.FIREBASE_PROJECT_ID}".`);
      return true;
    }
  } catch (err) {
    console.warn(`[FIREBASE ADMIN] Initialization skipped: ${err.message}`);
  }

  return false;
}

function cleanVal(v) {
  if (!v) return '';
  return String(v)
    .trim()
    .replace(/^["']|["'],?$/g, '')
    .replace(/[,;]$/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

// Get non-secret client configuration for browser SDK
function getFirebaseClientConfig() {
  let apiKey = cleanVal(process.env.FIREBASE_CLIENT_API_KEY || process.env.apiKey);
  let authDomain = cleanVal(process.env.FIREBASE_AUTH_DOMAIN || process.env.authDomain);
  let projectId = cleanVal(process.env.FIREBASE_PROJECT_ID || process.env.projectId);
  let storageBucket = cleanVal(process.env.FIREBASE_STORAGE_BUCKET || process.env.storageBucket);
  let messagingSenderId = cleanVal(process.env.FIREBASE_MESSAGING_SENDER_ID || process.env.messagingSenderId);
  let appId = cleanVal(process.env.FIREBASE_APP_ID || process.env.appId);

  // Fallback: direct .env inspection if environment parsing missed variables
  if ((!apiKey || !authDomain || !projectId || !appId) && fs.existsSync(path.resolve(process.cwd(), '.env'))) {
    try {
      const rawEnv = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
      const extractKey = (name) => {
        const m = rawEnv.match(new RegExp(`(?:FIREBASE_${name}|${name})\\s*[:=]\\s*["']?([^"',\\s\\n\\r]+)["']?`, 'i'));
        return m ? cleanVal(m[1]) : '';
      };
      if (!apiKey) apiKey = extractKey('CLIENT_API_KEY') || extractKey('apiKey');
      if (!authDomain) authDomain = extractKey('AUTH_DOMAIN') || extractKey('authDomain');
      if (!projectId) projectId = extractKey('PROJECT_ID') || extractKey('projectId');
      if (!storageBucket) storageBucket = extractKey('STORAGE_BUCKET') || extractKey('storageBucket');
      if (!messagingSenderId) messagingSenderId = extractKey('MESSAGING_SENDER_ID') || extractKey('messagingSenderId');
      if (!appId) appId = extractKey('APP_ID') || extractKey('appId');
    } catch (e) {}
  }

  const isConfigured = !!(apiKey && authDomain && projectId && appId);

  return {
    configured: isConfigured,
    missingConfig: isConfigured ? [] : [
      !apiKey && 'FIREBASE_CLIENT_API_KEY',
      !authDomain && 'FIREBASE_AUTH_DOMAIN',
      !projectId && 'FIREBASE_PROJECT_ID',
      !appId && 'FIREBASE_APP_ID'
    ].filter(Boolean),
    config: isConfigured ? {
      apiKey,
      authDomain,
      projectId,
      storageBucket: storageBucket || `${projectId}.appspot.com`,
      messagingSenderId: messagingSenderId || '',
      appId
    } : null
  };
}

// Verify Firebase ID Token on Server
async function verifyFirebasePhoneToken(idToken, expectedMobile) {
  if (!idToken) {
    return {
      valid: false,
      error: 'NO_TOKEN_PROVIDED',
      message: 'Mobile verification ID token is required to issue a citizen token.'
    };
  }

  // Test environment verification support for automated test suites
  if (process.env.NODE_ENV === 'test' && idToken === 'TEST_AUTOMATED_TOKEN') {
    return {
      valid: true,
      uid: 'test_user_verified',
      phoneNumber: '+91' + String(expectedMobile || '').replace(/\D/g, '').slice(-10)
    };
  }

  const cleanExpected = String(expectedMobile || '').replace(/\D/g, '').slice(-10);

  // If Firebase Admin is available, use it
  if (isFirebaseAdminInitialized && admin) {
    try {
      const decoded = await firebaseAuth.verifyIdToken(idToken);
      const phoneInToken = String(decoded.phone_number || '').replace(/\D/g, '').slice(-10);

      if (cleanExpected && phoneInToken !== cleanExpected) {
        return {
          valid: false,
          error: 'PHONE_MISMATCH',
          message: `Phone number in token (${decoded.phone_number}) does not match requested mobile (${expectedMobile}).`
        };
      }

      return {
        valid: true,
        uid: decoded.uid,
        phoneNumber: decoded.phone_number
      };
    } catch (err) {
      return {
        valid: false,
        error: 'INVALID_TOKEN',
        message: `Firebase token verification failed: ${err.message}`
      };
    }
  }

  // If Firebase Admin is not initialized but Firebase Web Client API key is set,
  // we can verify via Google Identity Toolkit REST API
  const clientConfig = getFirebaseClientConfig();
  const apiKey = clientConfig.configured ? clientConfig.config.apiKey : cleanVal(process.env.FIREBASE_CLIENT_API_KEY || process.env.apiKey);
  if (apiKey) {
    try {
      const https = require('https');
      const payload = JSON.stringify({ idToken });

      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'identitytoolkit.googleapis.com',
          path: `/v1/accounts:lookup?key=${apiKey}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (res) => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(body));
            } catch (e) {
              reject(e);
            }
          });
        });

        req.on('error', reject);
        req.write(payload);
        req.end();
      });

      if (result.users && result.users[0]) {
        const user = result.users[0];
        const phoneInToken = String(user.phoneNumber || '').replace(/\D/g, '').slice(-10);

        if (cleanExpected && phoneInToken !== cleanExpected) {
          return {
            valid: false,
            error: 'PHONE_MISMATCH',
            message: `Verified phone number (${user.phoneNumber}) does not match requested mobile.`
          };
        }

        return {
          valid: true,
          uid: user.localId,
          phoneNumber: user.phoneNumber
        };
      } else {
        return {
          valid: false,
          error: 'LOOKUP_FAILED',
          message: result.error ? result.error.message : 'Invalid Firebase ID token.'
        };
      }
    } catch (err) {
      return {
        valid: false,
        error: 'VERIFICATION_ERROR',
        message: `Token verification request failed: ${err.message}`
      };
    }
  }

  // If neither is configured
  return {
    valid: false,
    error: 'FIREBASE_NOT_CONFIGURED',
    message: 'Firebase Authentication is not configured on the server. Please supply Firebase credentials in .env.'
  };
}

module.exports = {
  initFirebaseAdmin,
  getFirebaseClientConfig,
  verifyFirebasePhoneToken
};
