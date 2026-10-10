/**
 * QueueLess — Node.js Server & Real-Time Backend Logging Engine
 * Integrated with MongoDB Atlas & Firebase Authentication Phone Sign-in
 */

require('dotenv').config();

const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');
const { initFirebaseAdmin, getFirebaseClientConfig, verifyFirebasePhoneToken } = require('./firebase-server');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = __dirname;
const AVG_SERVICE_MINUTES = 5;

// ==========================================
// Terminal Logging Helpers
// ==========================================

function getTimeStr() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function formatDateStr() {
  const d = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}, ${getTimeStr()}`;
}

function maskMobile(mobile) {
  if (!mobile) return '******0000';
  const clean = String(mobile).replace(/\D/g, '');
  if (clean.length >= 4) {
    return '******' + clean.slice(-4);
  }
  return '******3210';
}

function logRequest(method, reqPath) {
  console.log(`[${getTimeStr()}] ${method.padEnd(4)} ${reqPath}`);
}

function logInfo(msg) {
  console.log(`[INFO] ${msg}`);
}

function logAuth(msg, details = {}) {
  console.log(`[AUTH] ${msg}`);
  if (details.mobile) {
    console.log(`[AUTH] Mobile: ${maskMobile(details.mobile)}`);
  }
  if (details.status) {
    console.log(`[AUTH] Verification: ${details.status}`);
  }
  if (details.uid) {
    console.log(`[AUTH] Firebase UID: ${details.uid}`);
  }
  if (details.mode) {
    console.log(`[AUTH] ${details.mode}`);
  }
}

function logToken(token, peopleAhead, waitMinutes) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[TOKEN CREATED]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${token.id}`);
  console.log(`Type          : ${token.type}`);
  console.log(`Service       : ${token.service}`);
  console.log(`Office        : ${token.office}`);
  console.log(`Mobile        : ${maskMobile(token.mobile)}`);
  console.log(`Queue Pos     : ${peopleAhead + 1} (${peopleAhead} ahead)`);
  console.log(`Estimated Wait: ${waitMinutes} min`);
  console.log(`Status        : WAITING`);
  console.log(`--------------------------------------------------\n`);
}

function logWalkIn(token, queuePos, eta) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[WALK-IN ADDED]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${token.id}`);
  console.log(`Type          : ${token.type}`);
  console.log(`Customer      : ${token.customerName}`);
  console.log(`Service       : ${token.service}`);
  console.log(`Office        : ${token.office}`);
  console.log(`Added By      : Officer Desk`);
  console.log(`Queue Pos     : ${queuePos}`);
  console.log(`Estimated Wait: ${eta} min`);
  console.log(`Status        : WAITING`);
  console.log(`--------------------------------------------------\n`);
}

function logQueueAction(token, counter, prevStatus = 'WAITING') {
  console.log(`\n--------------------------------------------------`);
  console.log(`[QUEUE ACTION — CALL NEXT]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${token.id}`);
  console.log(`Type          : ${token.type}`);
  console.log(`Service       : ${token.service}`);
  console.log(`Counter       : ${counter || 'Counter 2'}`);
  console.log(`Transition    : ${prevStatus} -> CALLED / SERVING`);
  console.log(`--------------------------------------------------\n`);
}

function logServiceCompleted(completedToken, nextTokenId) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[SERVICE COMPLETED]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${completedToken.id}`);
  console.log(`Type          : ${completedToken.type || 'ONLINE'}`);
  console.log(`Service       : ${completedToken.service}`);
  console.log(`Counter       : ${completedToken.counter || 'Counter 2'}`);
  console.log(`Transition    : SERVING -> COMPLETED`);
  console.log(`Next in Queue : ${nextTokenId || 'None (Queue empty)'}`);
  console.log(`--------------------------------------------------\n`);
}

function logNoShow(token) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[CUSTOMER NO-SHOW]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${token.id}`);
  console.log(`Type          : ${token.type}`);
  console.log(`Customer      : ${token.customerName || 'Citizen'}`);
  console.log(`Service       : ${token.service}`);
  console.log(`Transition    : ${token.status === 'SERVING' ? 'SERVING' : 'WAITING'} -> NO_SHOW (Removed from active queue)`);
  console.log(`--------------------------------------------------\n`);
}

function logCancel(token) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[TOKEN CANCELLED]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Token         : ${token.id}`);
  console.log(`Type          : ${token.type}`);
  console.log(`Service       : ${token.service}`);
  console.log(`Transition    : WAITING -> CANCELLED (Removed from queue)`);
  console.log(`--------------------------------------------------\n`);
}

function logQueueSnapshot(state) {
  const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
  console.log(`[QUEUE SNAPSHOT] ${getTimeStr()}`);
  console.log(`Serving Now   : ${state.currentServing ? `${state.currentServing.id} (${state.currentServing.counter || 'Counter 2'})` : 'None'}`);
  console.log(`Waiting Count : ${waitingTokens.length}`);
  console.log(`Completed     : ${state.completedCount} today | Walk-ins: ${state.walkinCount}`);
  if (waitingTokens.length > 0) {
    const queueList = waitingTokens.map(t => `${t.id} [${t.type}]`).join(' -> ');
    console.log(`Unified Queue : ${queueList}`);
  } else {
    console.log(`Unified Queue : Empty`);
  }
  console.log('');
}

function logAppointment(apt) {
  console.log(`\n--------------------------------------------------`);
  console.log(`[APPOINTMENT CREATED]`);
  console.log(`Time          : ${getTimeStr()}`);
  console.log(`Appointment ID: ${apt.id}`);
  console.log(`Citizen       : ${apt.name}`);
  console.log(`Mobile        : ${maskMobile(apt.mobile)}`);
  console.log(`Office        : ${apt.office}`);
  console.log(`Service       : ${apt.service}`);
  console.log(`Date          : ${apt.date}`);
  console.log(`Time Slot     : ${apt.slot}`);
  console.log(`Status        : CONFIRMED`);
  console.log(`--------------------------------------------------\n`);
}

function logError(route, reason, details = {}) {
  console.log(`\n[ERROR] ${getTimeStr()}`);
  console.log(`Route         : ${route}`);
  console.log(`Reason        : ${reason}`);
  if (details.mobile) {
    console.log(`Mobile        : ${maskMobile(details.mobile)}`);
  }
  if (details.service) {
    console.log(`Service       : ${details.service}`);
  }
  console.log('');
}

// MIME types for static files
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ==========================================
// HTTP Request Dispatcher
// ==========================================

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const method = req.method.toUpperCase();

  const sendJson = (statusCode, data, extraHeaders = {}) => {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...extraHeaders
    });
    res.end(JSON.stringify(data));
  };

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // Parse JSON Body for POST requests
  const readBody = () => {
    return new Promise((resolve, reject) => {
      let bodyStr = '';
      req.on('data', chunk => bodyStr += chunk);
      req.on('end', () => {
        try {
          const parsed = bodyStr ? JSON.parse(bodyStr) : {};
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
  };

  // Auth Verification Helpers
  const authenticateRequest = async () => {
    const token = auth.extractAuthToken(req);
    if (!token) return null;
    return await db.getSession(token);
  };

  const requireRole = async (allowedRoles = []) => {
    const session = await authenticateRequest();
    if (!session) {
      return { ok: false, status: 401, message: 'Authentication required. Please sign in.' };
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(session.role)) {
      return { ok: false, status: 403, message: 'Forbidden: Insufficient privileges.' };
    }
    if (session.role === 'officer' && session.status !== 'APPROVED') {
      return { ok: false, status: 403, message: 'Your officer account is pending approval by the administrator.' };
    }
    return { ok: true, session };
  };

  const verifyOfficerOrAdmin = async () => {
    const token = auth.extractAuthToken(req);
    if (token) {
      const session = await db.getSession(token);
      if (!session) {
        return { ok: false, status: 401, message: 'Invalid or expired session token.' };
      }
      if (session.role !== 'officer' && session.role !== 'admin') {
        return { ok: false, status: 403, message: 'Forbidden: Citizens cannot perform officer operations.' };
      }
      if (session.role === 'officer' && session.status !== 'APPROVED') {
        return { ok: false, status: 403, message: 'Forbidden: Officer account is pending administrator approval.' };
      }
      return { ok: true, actor: session };
    }
    if (process.env.REQUIRE_OFFICER_AUTH === 'true') {
      return { ok: false, status: 401, message: 'Authentication required. Please sign in as an officer or administrator.' };
    }
    // Permissive fallback for unauthenticated local quick demo / legacy test runner
    return { ok: true, actor: { name: 'Counter 2 Desk', role: 'officer' } };
  };

  // ------------------------------------------
  // API ROUTES
  // ------------------------------------------

  if (pathname.startsWith('/api/')) {
    logRequest(method, pathname);

    try {
      // 0. GET /api/health -> Deployment health check
      if (pathname === '/api/health' && method === 'GET') {
        const dbStatus = db.getDatabaseStatus();
        const fbConfig = getFirebaseClientConfig();
        return sendJson(200, {
          status: 'UP',
          service: 'QueueLess Virtual Queue System',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          database: dbStatus,
          firebase: {
            configured: fbConfig.configured
          }
        });
      }

      // 1. GET /api/config/firebase -> Provide non-secret client config to browser
      if (pathname === '/api/config/firebase' && method === 'GET') {
        const fbConfig = getFirebaseClientConfig();
        return sendJson(200, fbConfig);
      }

      // 2. GET /api/status -> System and database status
      if (pathname === '/api/status' && method === 'GET') {
        const dbStatus = db.getDatabaseStatus();
        const fbConfig = getFirebaseClientConfig();
        return sendJson(200, {
          server: 'RUNNING',
          database: dbStatus,
          firebase: {
            configured: fbConfig.configured,
            missingConfig: fbConfig.missingConfig
          }
        });
      }

      // 3. GET /api/queue -> Authoritative queue state & stats from database
      if (pathname === '/api/queue' && method === 'GET') {
        const [state, stats] = await Promise.all([
          db.getQueueState(),
          db.getStats()
        ]);

        return sendJson(200, {
          success: true,
          state,
          stats,
          storage: db.getDatabaseStatus()
        });
      }

      // ------------------------------------------
      // AUTHENTICATION & SESSION ROUTES
      // ------------------------------------------

      // POST /api/auth/register-officer -> Self-registration for officers (sets status to PENDING)
      if (pathname === '/api/auth/register-officer' && method === 'POST') {
        const body = await readBody();
        const { username, email, fullName, password, officeId, employeeId, counter, mobile } = body || {};

        if (!username || username.trim().length < 3) {
          return sendJson(400, { success: false, message: 'Username must be at least 3 characters.' });
        }
        if (!password || password.length < 6) {
          return sendJson(400, { success: false, message: 'Password must be at least 6 characters.' });
        }
        if (!email || !email.includes('@')) {
          return sendJson(400, { success: false, message: 'Valid official email address is required.' });
        }
        if (!fullName || !fullName.trim()) {
          return sendJson(400, { success: false, message: 'Full name is required.' });
        }

        const existing = await db.getUserByIdentifier(username);
        if (existing) {
          return sendJson(409, { success: false, message: 'Username or email already registered.' });
        }

        const cred = auth.hashPassword(password);
        const newUser = await db.createUser({
          username: username.trim().toLowerCase(),
          email: email.trim().toLowerCase(),
          name: fullName.trim(),
          mobile: mobile || '',
          employeeId: employeeId || '',
          office: officeId || 'Rajkot District Service Center',
          counter: counter || 'Counter 1',
          role: 'officer',
          status: 'PENDING',
          passwordHash: cred.hash,
          salt: cred.salt
        });

        logInfo(`[AUTH] Officer registration submitted: ${newUser.username} (${newUser.name}) -> PENDING approval.`);
        return sendJson(201, {
          success: true,
          message: 'Officer registration submitted. Account is pending admin approval.',
          user: newUser
        });
      }

      // POST /api/auth/login -> Login for officers and administrators
      if (pathname === '/api/auth/login' && method === 'POST') {
        const body = await readBody();
        const { username, password } = body || {};

        if (!username || !password) {
          return sendJson(400, { success: false, message: 'Username and password are required.' });
        }

        const user = await db.getUserByIdentifier(username);
        if (!user || !user.passwordHash || !user.salt) {
          return sendJson(401, { success: false, message: 'Invalid username or password.' });
        }

        const valid = auth.verifyPassword(password, user.passwordHash, user.salt);
        if (!valid) {
          return sendJson(401, { success: false, message: 'Invalid username or password.' });
        }

        if (user.role === 'officer' && user.status === 'PENDING') {
          return sendJson(403, {
            success: false,
            code: 'ACCOUNT_PENDING',
            message: 'Your officer account is pending approval by the Center Administrator. Please wait for authorization.'
          });
        }

        if (user.status === 'REJECTED') {
          return sendJson(403, {
            success: false,
            code: 'ACCOUNT_REJECTED',
            message: 'Your account registration was rejected by administration. Please contact support.'
          });
        }

        if (user.status === 'INACTIVE') {
          return sendJson(403, {
            success: false,
            code: 'ACCOUNT_INACTIVE',
            message: 'Your account has been deactivated.'
          });
        }

        const session = await db.createSession(user);
        await db.logActivity('STAFF_LOGIN', { name: user.name, role: user.role }, { username: user.username, office: user.office });

        logInfo(`[AUTH] User "${user.username}" [${user.role}] logged in successfully.`);

        const cookieHeader = `ql_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
        return sendJson(200, {
          success: true,
          token: session.token,
          user: {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            status: user.status,
            office: user.office,
            counter: user.counter
          }
        }, { 'Set-Cookie': cookieHeader });
      }

      // POST /api/auth/logout -> Logout and revoke session
      if (pathname === '/api/auth/logout' && method === 'POST') {
        const token = auth.extractAuthToken(req);
        if (token) {
          await db.deleteSession(token);
        }
        const clearCookie = `ql_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
        return sendJson(200, { success: true, message: 'Logged out successfully.' }, { 'Set-Cookie': clearCookie });
      }

      // GET /api/auth/me -> Current session identity
      if (pathname === '/api/auth/me' && method === 'GET') {
        const session = await authenticateRequest();
        if (!session) {
          return sendJson(401, { success: false, message: 'Not authenticated.' });
        }
        return sendJson(200, { success: true, user: session });
      }

      // POST /api/auth/setup-admin -> Safe one-time administrator provisioning
      if (pathname === '/api/auth/setup-admin' && method === 'POST') {
        const body = await readBody();
        const { username = 'admin', password, name = 'System Administrator', setupKey } = body || {};

        if (!password || password.length < 6) {
          return sendJson(400, { success: false, message: 'Admin password must be at least 6 characters.' });
        }

        const existingAdmin = await db.getUserByRole('admin');
        const expectedKey = process.env.ADMIN_SETUP_KEY || 'QueueLessSetup2026';
        if (existingAdmin && setupKey !== expectedKey) {
          return sendJson(403, { success: false, message: 'Administrator already exists. Valid ADMIN_SETUP_KEY required.' });
        }

        const cred = auth.hashPassword(password);
        const adminUser = await db.createUser({
          username: username.trim().toLowerCase(),
          email: `${username.trim().toLowerCase()}@queueless.gov.in`,
          name: name.trim(),
          mobile: '9999999999',
          role: 'admin',
          status: 'APPROVED',
          office: 'All Offices',
          counter: 'All Counters',
          passwordHash: cred.hash,
          salt: cred.salt
        });

        return sendJson(201, {
          success: true,
          message: 'Administrator created successfully.',
          user: adminUser
        });
      }

      // ------------------------------------------
      // ADMIN DASHBOARD & GOVERNANCE ROUTES
      // ------------------------------------------

      // GET /api/admin/staff -> List all officers
      if (pathname === '/api/admin/staff' && method === 'GET') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const staff = await db.getUsers({ role: 'officer' });
        return sendJson(200, { success: true, staff });
      }

      // POST /api/admin/staff/approve -> Approve pending officer
      if (pathname === '/api/admin/staff/approve' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { userId } = body || {};
        if (!userId) return sendJson(400, { success: false, message: 'userId is required.' });

        const result = await db.approveStaff(userId, authCheck.session);
        return sendJson(200, result);
      }

      // POST /api/admin/staff/reject -> Reject officer
      if (pathname === '/api/admin/staff/reject' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { userId } = body || {};
        if (!userId) return sendJson(400, { success: false, message: 'userId is required.' });

        const result = await db.rejectStaff(userId, authCheck.session);
        return sendJson(200, result);
      }

      // POST /api/admin/staff/status -> Change officer status (e.g. INACTIVE)
      if (pathname === '/api/admin/staff/status' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { userId, status } = body || {};
        if (!userId || !status) return sendJson(400, { success: false, message: 'userId and status are required.' });

        const result = await db.setStaffStatus(userId, status, authCheck.session);
        return sendJson(200, result);
      }

      // GET /api/admin/offices -> Get all offices & counters
      if (pathname === '/api/admin/offices' && method === 'GET') {
        const offices = await db.getOffices();
        return sendJson(200, { success: true, offices });
      }

      // POST /api/admin/offices -> Add office
      if (pathname === '/api/admin/offices' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { name, tagline, district, services } = body || {};
        const office = await db.addOffice({ name, tagline, district, services });
        return sendJson(201, { success: true, office });
      }

      // POST /api/admin/services -> Add service to office
      if (pathname === '/api/admin/services' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { officeId, serviceName } = body || {};
        const resObj = await db.addServiceToOffice(officeId, serviceName);
        return sendJson(200, resObj);
      }

      // POST /api/admin/counters -> Add counter to office
      if (pathname === '/api/admin/counters' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { officeId, name, service } = body || {};
        const counter = await db.addCounterToOffice(officeId, { name, service });
        return sendJson(201, { success: true, counter });
      }

      // POST /api/admin/counters/assign -> Assign officer to counter
      if (pathname === '/api/admin/counters/assign' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { officeId, counterId, officerId, officerName } = body || {};
        const resObj = await db.assignCounterOfficer(officeId, counterId, officerId, officerName);
        return sendJson(200, resObj);
      }

      // GET /api/admin/queue-monitor -> Global queue inspection with filters
      if (pathname === '/api/admin/queue-monitor' && method === 'GET') {
        const authCheck = await requireRole(['admin', 'officer']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const office = reqUrl.searchParams.get('office');
        const service = reqUrl.searchParams.get('service');
        const counter = reqUrl.searchParams.get('counter');
        const status = reqUrl.searchParams.get('status');
        const date = reqUrl.searchParams.get('date');
        const limit = reqUrl.searchParams.get('limit') || 100;

        const [tokens, metrics] = await Promise.all([
          db.getAllTokensFiltered({ office, service, counter, status, date, limit }),
          db.getQueueMetrics(office)
        ]);

        return sendJson(200, { success: true, tokens, metrics });
      }

      // GET /api/admin/logs -> Audit activity logs
      if (pathname === '/api/admin/logs' && method === 'GET') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const limit = reqUrl.searchParams.get('limit') || 50;
        const action = reqUrl.searchParams.get('action');

        const logs = await db.getActivityLogs({ limit, action });
        return sendJson(200, { success: true, logs });
      }

      // POST /api/queue/seed -> Admin explicitly seeds demo tokens
      if (pathname === '/api/queue/seed' && method === 'POST') {
        const authCheck = await requireRole(['admin']);
        if (!authCheck.ok) return sendJson(authCheck.status, { success: false, message: authCheck.message });

        const body = await readBody();
        const { office, force } = body || {};
        const state = await db.seedDemoData({ office, force });
        logInfo(`[ADMIN] Demo queue data seeded explicitly by ${authCheck.session.username}`);
        return sendJson(200, { success: true, state, message: 'Demo queue seeded successfully.' });
      }

      // 4. POST /api/token -> Citizen generates online virtual token
      if (pathname === '/api/token' && method === 'POST') {
        const body = await readBody();
        const {
          service = 'Income Certificate',
          office = 'Rajkot District Service Center',
          mobile = '',
          customerName = 'Citizen',
          idToken = null
        } = body || {};

        // Phone Verification Check
        const fbConfig = getFirebaseClientConfig();

        if (fbConfig.configured) {
          // Firebase is configured: verify genuine Firebase ID token
          if (!idToken) {
            logError('POST /api/token', 'Missing Firebase ID token', { mobile });
            return sendJson(401, {
              success: false,
              code: 'AUTH_REQUIRED',
              message: 'Mobile verification required. Please complete Firebase SMS verification first.'
            });
          }

          const verification = await verifyFirebasePhoneToken(idToken, mobile);
          if (!verification.valid) {
            logError('POST /api/token', `Firebase verification failed: ${verification.message}`, { mobile });
            return sendJson(401, {
              success: false,
              code: verification.error || 'INVALID_VERIFICATION',
              message: verification.message
            });
          }

          logAuth('Firebase Phone Token Verified', {
            mobile,
            uid: verification.uid,
            status: 'SUCCESS'
          });
        } else {
          // If Firebase is not configured in .env, check whether token is supplied or warn
          if (!mobile || String(mobile).replace(/\D/g, '').length < 10) {
            return sendJson(400, {
              success: false,
              message: 'Valid 10-digit mobile number is required.'
            });
          }
          logAuth('Token request received (Firebase credentials pending in .env)', { mobile });
        }

        // Anti-abuse check
        const hasActive = await db.hasActiveTokenForService(mobile, service);
        if (hasActive) {
          logError('POST /api/token', 'Duplicate active token for service', { mobile, service });
          return sendJson(400, {
            success: false,
            message: `You already have an active token for ${service}. QueueLess limits 1 active token per service.`
          });
        }

        const { token, state } = await db.addToken({
          service,
          office,
          mobile,
          customerName,
          type: 'ONLINE'
        });

        const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
        const tokenIndex = waitingTokens.findIndex(t => t.id === token.id);
        const peopleAhead = tokenIndex >= 0 ? tokenIndex : 0;
        const waitMinutes = (peopleAhead + 1) * AVG_SERVICE_MINUTES;

        logToken(token, peopleAhead, waitMinutes);
        logQueueSnapshot(state);

        return sendJson(201, {
          success: true,
          token,
          metrics: {
            peopleAhead,
            estimatedMinutes: waitMinutes,
            status: 'WAITING'
          },
          state
        });
      }

      // 5. POST /api/officer/walk-in -> Officer adds physical walk-in to unified queue
      if (pathname === '/api/officer/walk-in' && method === 'POST') {
        const officerCheck = await verifyOfficerOrAdmin();
        if (!officerCheck.ok) {
          return sendJson(officerCheck.status, { success: false, message: officerCheck.message });
        }

        const body = await readBody();
        const {
          name = 'Rahul Patel',
          mobile = '9876543210',
          service = 'Income Certificate',
          office = 'Rajkot District Service Center'
        } = body || {};

        const { token, state } = await db.addToken({
          service,
          office,
          mobile,
          customerName: name || 'Walk-in Citizen',
          type: 'WALK-IN'
        });

        const waitingTokens = state.tokens.filter(t => t.status === 'WAITING');
        const queuePos = waitingTokens.length;
        const eta = queuePos * AVG_SERVICE_MINUTES;

        logWalkIn(token, queuePos, eta);
        logQueueSnapshot(state);

        return sendJson(201, {
          success: true,
          token,
          state
        });
      }

      // 6. POST /api/queue/call-next -> Officer calls next waiting token (or specific token)
      if (pathname === '/api/queue/call-next' && method === 'POST') {
        const officerCheck = await verifyOfficerOrAdmin();
        if (!officerCheck.ok) {
          return sendJson(officerCheck.status, { success: false, message: officerCheck.message });
        }

        const body = await readBody();
        const counter = (body && body.counter) || 'Counter 2';
        const targetTokenId = body && body.tokenId;

        const { calledToken, state } = await db.callNext(counter, targetTokenId);

        logQueueAction(calledToken, counter);
        logQueueSnapshot(state);

        return sendJson(200, {
          success: true,
          calledToken,
          state
        });
      }

      // 7. POST /api/queue/complete -> Officer completes current serving citizen
      if (pathname === '/api/queue/complete' && method === 'POST') {
        const officerCheck = await verifyOfficerOrAdmin();
        if (!officerCheck.ok) {
          return sendJson(officerCheck.status, { success: false, message: officerCheck.message });
        }

        const { completedToken, state } = await db.completeCurrent();

        const nextWaiting = state.tokens.find(t => t.status === 'WAITING');
        logServiceCompleted(completedToken, nextWaiting ? nextWaiting.id : null);
        logQueueSnapshot(state);

        return sendJson(200, {
          success: true,
          completedToken,
          state
        });
      }

      // 8. POST /api/queue/noshow -> Mark customer as no-show
      if (pathname === '/api/queue/noshow' && method === 'POST') {
        const officerCheck = await verifyOfficerOrAdmin();
        if (!officerCheck.ok) {
          return sendJson(officerCheck.status, { success: false, message: officerCheck.message });
        }

        const body = await readBody();
        const tokenId = body && body.tokenId;

        const { token, state } = await db.markNoShow(tokenId);

        logNoShow(token);
        logQueueSnapshot(state);

        return sendJson(200, {
          success: true,
          token,
          state
        });
      }

      // 9. POST /api/queue/cancel -> Cancel token
      if (pathname === '/api/queue/cancel' && method === 'POST') {
        const body = await readBody();
        const tokenId = body && body.tokenId;

        const { token, state } = await db.cancelToken(tokenId);

        logCancel(token);
        logQueueSnapshot(state);

        return sendJson(200, {
          success: true,
          token,
          state
        });
      }

      // 10. POST /api/appointment -> Create advance appointment in database
      if (pathname === '/api/appointment' && method === 'POST') {
        const body = await readBody();
        const { office, service, date, slot, name, mobile } = body || {};

        const appointment = await db.createAppointment({
          office,
          service,
          date,
          slot,
          name,
          mobile
        });

        logAppointment(appointment);
        return sendJson(201, { success: true, appointment });
      }

      // 11. GET /api/appointments -> Retrieve persisted appointments from database
      if (pathname === '/api/appointments' && method === 'GET') {
        const appointments = await db.getAppointments();
        return sendJson(200, { success: true, appointments });
      }

      // 12. POST /api/queue/reset -> Reset demo state to clean seed data
      if (pathname === '/api/queue/reset' && method === 'POST') {
        const state = await db.resetQueue();
        logInfo('QueueLess demo state reset to baseline (A-40 Serving, A-41 to A-43 Waiting).');
        logQueueSnapshot(state);
        return sendJson(200, { success: true, state });
      }

      return sendJson(404, { success: false, message: 'Endpoint not found' });
    } catch (err) {
      logError(pathname, err.message);
      return sendJson(400, { success: false, message: err.message });
    }
  }

  // ------------------------------------------
  // STATIC FILE SERVING
  // ------------------------------------------

  let reqPath = decodeURI(pathname);
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + reqPath);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// ==========================================
// Server Initialization
// ==========================================

async function startServer() {
  // Initialize Database
  console.log('[STARTUP] Connecting to database...');
  const dbStatus = await db.initDatabase();

  // Initialize Firebase Admin
  initFirebaseAdmin();
  const fbConfig = getFirebaseClientConfig();

  server.listen(PORT, HOST, () => {
    console.log(`\n==================================================`);
    console.log(`QUEUELESS SERVER`);
    console.log(`================`);
    console.log(`Server Status : RUNNING`);
    console.log(`Environment   : ${process.env.NODE_ENV || 'Development'}`);
    console.log(`Host          : ${HOST}`);
    console.log(`Port          : ${PORT}`);
    
    if (dbStatus.connected) {
      console.log(`Database      : MongoDB Atlas Connected (${dbStatus.dbName})`);
    } else {
      console.log(`Database      : Local File Persistence (Fallback — ${dbStatus.message})`);
    }

    if (fbConfig.configured) {
      console.log(`Firebase Auth : Configured (Project: ${fbConfig.config.projectId})`);
    } else {
      console.log(`Firebase Auth : Unconfigured (Missing: ${fbConfig.missingConfig.join(', ')})`);
    }

    console.log(`Started At    : ${formatDateStr()}`);
    console.log(`==================================================\n`);
    console.log(`QueueLess API is ready.\n`);
  });
}

startServer().catch(err => {
  console.error('[FATAL SERVER ERROR]', err);
  process.exit(1);
});
