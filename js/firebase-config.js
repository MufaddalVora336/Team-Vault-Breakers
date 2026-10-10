/**
 * QueueLess — Firebase Web Client Configuration Loader
 * 
 * Supports TWO ways to provide your Firebase Web App configuration:
 * 1. RECOMMENDED: Add your keys to the project .env file (see .env.example)
 *    The server will automatically serve them securely via GET /api/config/firebase.
 * 
 * 2. DIRECT: Paste your Firebase Web App configuration object into the 
 *    QUEUELESS_FIREBASE_CONFIG object below.
 */

window.QUEUELESS_FIREBASE_CONFIG = window.QUEUELESS_FIREBASE_CONFIG || {
  // If you prefer pasting your Firebase Web App config directly, fill in apiKey & appId below:
  apiKey: "AIzaSyBY-MTph6yPrCOD_aOY_P3dXYN_oNuhp30",
  authDomain: "queueless-25589.firebaseapp.com",
  projectId: "queueless-25589",
  storageBucket: "queueless-25589.firebasestorage.app",
  messagingSenderId: "736277318839",
  appId: "1:736277318839:web:d579d3dc7bb1afcbbed132"
};

/**
 * Loads the active Firebase configuration (prioritizing server-provided .env variables).
 * @returns {Promise<{configured: boolean, config: object|null, source: string}>}
 */
async function loadActiveFirebaseConfig() {
  // 1. Try fetching from server (.env)
  try {
    const res = await fetch('/api/config/firebase');
    if (res.ok) {
      const data = await res.json();
      if (data && data.configured && data.config) {
        return {
          configured: true,
          config: data.config,
          source: 'server_env'
        };
      }
    }
  } catch (err) {
    console.warn('[FIREBASE CONFIG] Could not reach /api/config/firebase, checking client config object:', err.message);
  }

  // 2. Check if developer pasted config into window.QUEUELESS_FIREBASE_CONFIG
  const cfg = window.QUEUELESS_FIREBASE_CONFIG;
  if (cfg && cfg.apiKey && cfg.apiKey.trim() && cfg.projectId && cfg.projectId.trim()) {
    return {
      configured: true,
      config: cfg,
      source: 'client_object'
    };
  }

  return {
    configured: false,
    config: null,
    source: 'none',
    missingKeys: ['apiKey', 'authDomain', 'projectId', 'appId']
  };
}

window.loadActiveFirebaseConfig = loadActiveFirebaseConfig;
