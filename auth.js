/**
 * QueueLess — Authentication & Role-Based Authorization Engine
 * Secure password hashing with crypto.scrypt, session management,
 * and role-based access control (Citizen, Officer, Admin).
 */

const crypto = require('crypto');

// Password hashing using Node.js built-in scrypt
function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a valid string.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return {
    hash: derivedKey.toString('hex'),
    salt
  };
}

function verifyPassword(password, hash, salt) {
  if (!password || !hash || !salt) return false;
  try {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');
    const hashBuffer = Buffer.from(hash, 'hex');
    if (keyBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, hashBuffer);
  } catch (err) {
    return false;
  }
}

// Generate secure random session tokens
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Parse cookies from incoming HTTP request headers
function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (!rc) return list;

  rc.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift().trim();
    const value = decodeURIComponent(parts.join('='));
    if (key) list[key] = value;
  });
  return list;
}

// Extract bearer token from Authorization header or cookie
function extractAuthToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req);
  if (cookies.ql_session) {
    return cookies.ql_session.trim();
  }
  return null;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  parseCookies,
  extractAuthToken
};
