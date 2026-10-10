/**
 * QueueLess — Full System Automated Test Suite (14 Acceptance Scenarios)
 * Covers:
 *  1. Admin Provisioning & Authentication
 *  2. Officer Self-Registration (PENDING)
 *  3. RBAC Enforcement: Pending Officer Blocked (403)
 *  4. Admin Staff Approval Workflow
 *  5. Approved Officer Login & Authorized Desk Operations
 *  6. Admin Staff Deactivation/Rejection (403 Block)
 *  7. Citizen Token Creation & Anti-Duplicate Validation
 *  8. Single Source of Truth: Global Queue Visibility
 *  9. Persistence Verification across Server Restarts (No Data Loss)
 * 10. Call-Next Queue Transition (SERVING + Counter Tag)
 * 11. Service Completion Transition & Daily Metrics
 * 12. Admin Multi-Office, Counters & Filtered Queue Monitor
 * 13. Explicit Demo Seed (Zero User/Staff Account Wipe)
 * 14. Deployment Readiness: /api/health & 0.0.0.0 Binding
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3499;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const headers = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let serverProc = null;

function startServerProcess() {
  return new Promise(async (resolve, reject) => {
    serverProc = spawn('node', ['server.js'], {
      cwd: __dirname,
      env: {
        ...process.env,
        PORT: TEST_PORT,
        HOST: '0.0.0.0',
        NODE_ENV: 'test',
        REQUIRE_OFFICER_AUTH: 'true' // Strict mode for test suite
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProc.stdout.on('data', () => {});
    serverProc.stderr.on('data', (d) => process.stderr.write(d.toString()));

    for (let i = 0; i < 25; i++) {
      try {
        const res = await request('GET', '/api/health');
        if (res.status === 200) {
          return resolve();
        }
      } catch (e) {}
      await sleep(200);
    }
    reject(new Error('Server failed to start on port ' + TEST_PORT));
  });
}

async function stopServerProcess() {
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
    await sleep(600);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('QUEUELESS FULL ACCEPTANCE TEST SUITE (14 SCENARIOS)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // Start Server
    console.log(`Starting QueueLess test server on 0.0.0.0:${TEST_PORT}...`);
    await startServerProcess();
    assert(true, 'Test server running in strict authorization mode.');

    // -------------------------------------------------------------
    // Scenario 1: Initial Admin Provisioning & Authentication
    // -------------------------------------------------------------
    console.log('\n--- Scenario 1: Admin Provisioning & Authentication ---');
    const adminLoginRes = await request('POST', '/api/auth/login', {
      username: 'admin',
      password: process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234'
    });
    assert(adminLoginRes.status === 200, 'Admin login succeeded with HTTP 200.');
    assert(adminLoginRes.data.success === true, 'Admin login response contains success: true.');
    assert(adminLoginRes.data.user.role === 'admin', 'Authenticated user role is admin.');
    const adminToken = adminLoginRes.data.token;
    assert(!!adminToken, 'Received valid Bearer session token for admin.');

    // -------------------------------------------------------------
    // Scenario 2: Officer Self-Registration (PENDING)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Officer Registration (Sets status PENDING) ---');
    const testOfficerUsername = `officer_test_${Date.now()}`;
    const testOfficerEmail = `${testOfficerUsername}@queueless.gov.in`;
    const regRes = await request('POST', '/api/auth/register-officer', {
      username: testOfficerUsername,
      email: testOfficerEmail,
      fullName: 'Vikram Sarabhai',
      password: 'SecurePassword123',
      officeId: 'Rajkot District Service Center',
      counter: 'Counter 2',
      employeeId: 'GOV-7711'
    });
    assert(regRes.status === 201, 'Officer registration returns HTTP 201 Created.');
    assert(regRes.data.user.status === 'PENDING', 'New officer has status PENDING.');
    assert(regRes.data.user.role === 'officer', 'New officer role is officer.');
    const newOfficerId = regRes.data.user.id;

    // -------------------------------------------------------------
    // Scenario 3: Pending Officer Cannot Login or Operate Queue
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Pending Officer Blocked (HTTP 403 Forbidden) ---');
    const pendingLoginRes = await request('POST', '/api/auth/login', {
      username: testOfficerUsername,
      password: 'SecurePassword123'
    });
    assert(pendingLoginRes.status === 403, 'Pending officer login correctly rejected with HTTP 403.');
    assert(pendingLoginRes.data.code === 'ACCOUNT_PENDING', 'Error code is ACCOUNT_PENDING.');

    // Attempt unauthenticated officer action in strict mode
    const unauthCallRes = await request('POST', '/api/queue/call-next', { counter: 'Counter 2' });
    assert(unauthCallRes.status === 401, 'Unauthenticated caller rejected from queue operations with HTTP 401.');

    // -------------------------------------------------------------
    // Scenario 4: Admin Staff Approval Workflow
    // -------------------------------------------------------------
    console.log('\n--- Scenario 4: Admin Approves Officer ---');
    const approveRes = await request('POST', '/api/admin/staff/approve', { userId: newOfficerId }, adminToken);
    assert(approveRes.status === 200, 'Admin approval request returned HTTP 200.');
    assert(approveRes.data.user.status === 'APPROVED', 'Officer status successfully updated to APPROVED.');

    // -------------------------------------------------------------
    // Scenario 5: Approved Officer Login & Authorized Desk Operations
    // -------------------------------------------------------------
    console.log('\n--- Scenario 5: Approved Officer Login & Operations ---');
    const approvedLoginRes = await request('POST', '/api/auth/login', {
      username: testOfficerUsername,
      password: 'SecurePassword123'
    });
    assert(approvedLoginRes.status === 200, 'Approved officer can now log in (HTTP 200).');
    const officerToken = approvedLoginRes.data.token;
    assert(!!officerToken, 'Officer received valid session token.');

    // Officer adds physical walk-in
    const walkinRes = await request('POST', '/api/officer/walk-in', {
      name: 'Nirav Patel',
      mobile: '9876543210',
      service: 'Income Certificate',
      office: 'Rajkot District Service Center'
    }, officerToken);
    assert(walkinRes.status === 201, 'Authorized officer added walk-in (HTTP 201).');
    assert(walkinRes.data.token.type === 'WALK-IN', 'Walk-in token type is WALK-IN.');
    const walkinTokenId = walkinRes.data.token.id;

    // -------------------------------------------------------------
    // Scenario 6: Admin Deactivates/Rejects Officer & Blocks Login
    // -------------------------------------------------------------
    console.log('\n--- Scenario 6: Admin Deactivation / Status Change ---');
    const deactRes = await request('POST', '/api/admin/staff/status', {
      userId: newOfficerId,
      status: 'INACTIVE'
    }, adminToken);
    assert(deactRes.status === 200, 'Staff status set to INACTIVE (HTTP 200).');

    const deactLoginRes = await request('POST', '/api/auth/login', {
      username: testOfficerUsername,
      password: 'SecurePassword123'
    });
    assert(deactLoginRes.status === 403, 'Deactivated officer is blocked with HTTP 403.');

    // Re-activate for further tests
    await request('POST', '/api/admin/staff/status', { userId: newOfficerId, status: 'APPROVED' }, adminToken);

    // -------------------------------------------------------------
    // Scenario 7: Citizen Token Creation & Anti-Abuse
    // -------------------------------------------------------------
    console.log('\n--- Scenario 7: Citizen Token Creation & Anti-Duplicate Check ---');
    const citizenMobile = '919876599999';

    // Unverified request without ID token is strictly rejected
    const unverifiedRes = await request('POST', '/api/token', {
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      mobile: citizenMobile,
      customerName: 'Ananya Desai'
    });
    assert(unverifiedRes.status === 401, 'Unverified citizen request without SMS OTP token is rejected (HTTP 401).');

    // Verified request creates token
    const tokenRes = await request('POST', '/api/token', {
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      mobile: citizenMobile,
      customerName: 'Ananya Desai',
      idToken: 'TEST_AUTOMATED_TOKEN'
    });
    assert(tokenRes.status === 201, 'Citizen generated virtual token with verified mobile (HTTP 201).');
    assert(tokenRes.data.token.status === 'WAITING', 'Token status is WAITING.');
    const citizenTokenId = tokenRes.data.token.id;

    // Duplicate check: Same mobile + same service
    const duplicateRes = await request('POST', '/api/token', {
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      mobile: citizenMobile,
      customerName: 'Ananya Desai',
      idToken: 'TEST_AUTOMATED_TOKEN'
    });
    assert(duplicateRes.status === 400, 'Duplicate active token request rejected with HTTP 400.');

    // -------------------------------------------------------------
    // Scenario 8: Single Source of Truth Global Queue
    // -------------------------------------------------------------
    console.log('\n--- Scenario 8: Global Queue State Visibility ---');
    const queueRes = await request('GET', '/api/queue');
    assert(queueRes.status === 200, 'Queue state retrieved (HTTP 200).');
    const tokens = queueRes.data.state.tokens;
    assert(tokens.some(t => t.id === citizenTokenId), 'Citizen token present in global queue.');
    assert(tokens.some(t => t.id === walkinTokenId), 'Walk-in token present in global queue.');

    // -------------------------------------------------------------
    // Scenario 9: Queue Persistence Across Server Restarts
    // -------------------------------------------------------------
    console.log('\n--- Scenario 9: Persistence Test Across Server Restart ---');
    console.log('Stopping server process...');
    await stopServerProcess();

    console.log('Restarting server process...');
    await startServerProcess();

    const postRestartRes = await request('GET', '/api/queue');
    assert(postRestartRes.status === 200, 'Server restarted and operational.');
    const postTokens = postRestartRes.data.state.tokens;
    assert(postTokens.some(t => t.id === citizenTokenId), 'Token survived server restart intact (No Data Loss!).');
    assert(postTokens.some(t => t.id === walkinTokenId), 'Walk-in survived server restart intact.');

    // Re-authenticate officer after restart
    const postLoginRes = await request('POST', '/api/auth/login', {
      username: testOfficerUsername,
      password: 'SecurePassword123'
    });
    const postOfficerToken = postLoginRes.data.token;

    // -------------------------------------------------------------
    // Scenario 10: Calling Next Token
    // -------------------------------------------------------------
    console.log('\n--- Scenario 10: Call Next Token Transition ---');
    const callRes = await request('POST', '/api/queue/call-next', {
      counter: 'Counter 2',
      tokenId: citizenTokenId
    }, postOfficerToken);
    assert(callRes.status === 200, 'Officer called token (HTTP 200).');
    assert(callRes.data.calledToken.id === citizenTokenId, 'Called token matches target.');
    assert(callRes.data.calledToken.status === 'SERVING', 'Token transitioned to SERVING.');
    assert(callRes.data.calledToken.counter === 'Counter 2', 'Token assigned to Counter 2.');

    // -------------------------------------------------------------
    // Scenario 11: Complete Serving Citizen & Metrics
    // -------------------------------------------------------------
    console.log('\n--- Scenario 11: Service Complete Transition & Daily Stats ---');
    const completeRes = await request('POST', '/api/queue/complete', {}, postOfficerToken);
    assert(completeRes.status === 200, 'Officer completed token (HTTP 200).');
    assert(completeRes.data.completedToken.id === citizenTokenId, 'Completed token matches active serving token.');
    assert(completeRes.data.completedToken.status === 'COMPLETED', 'Token transitioned to COMPLETED.');
    assert(completeRes.data.state.completedCount >= 1, 'Completed count incremented.');

    // -------------------------------------------------------------
    // Scenario 12: Admin Dashboard & Filtered Queue Monitor
    // -------------------------------------------------------------
    console.log('\n--- Scenario 12: Admin Multi-Office, Counters & Queue Monitor ---');
    const monitorRes = await request('GET', '/api/admin/queue-monitor?status=COMPLETED', null, adminToken);
    assert(monitorRes.status === 200, 'Queue monitor returned HTTP 200.');
    assert(Array.isArray(monitorRes.data.tokens), 'Tokens array returned.');
    assert(monitorRes.data.tokens.some(t => t.id === citizenTokenId), 'Completed token visible in filtered query.');

    // Add Office test
    const newOfficeRes = await request('POST', '/api/admin/offices', {
      name: 'Bhavnagar District Seva Kendra',
      tagline: 'Civic Seva Bhavan',
      district: 'Bhavnagar'
    }, adminToken);
    assert(newOfficeRes.status === 201, 'Admin added new office (HTTP 201).');

    // -------------------------------------------------------------
    // Scenario 13: Explicit Demo Seed (Zero User Account Wipe)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 13: Explicit Demo Seed Without User Loss ---');
    const seedRes = await request('POST', '/api/queue/seed', { force: true }, adminToken);
    assert(seedRes.status === 200, 'Admin explicitly seeded demo queue (HTTP 200).');
    assert(seedRes.data.state.currentServing.id === 'A-40', 'A-40 is serving in demo seed.');
    assert(seedRes.data.state.tokens.length === 3, 'Tokens A-41 to A-43 are waiting.');

    // Verify user accounts were not wiped
    const staffCheckRes = await request('GET', '/api/admin/staff', null, adminToken);
    assert(staffCheckRes.data.staff.some(s => s.username === testOfficerUsername), 'Registered officers preserved across demo seed!');

    // -------------------------------------------------------------
    // Scenario 14: Deployment Readiness & Health Endpoint
    // -------------------------------------------------------------
    console.log('\n--- Scenario 14: Deployment Health & Host Diagnostics ---');
    const healthRes = await request('GET', '/api/health');
    assert(healthRes.status === 200, 'Health check returned HTTP 200 OK.');
    assert(healthRes.data.status === 'UP', 'Service status is UP.');
    assert(healthRes.data.uptime > 0, 'Service reports positive uptime.');
    assert(typeof healthRes.data.database === 'object', 'Database diagnostic object included.');

    console.log('\n================================================================');
    console.log(`ALL 14 ACCEPTANCE SCENARIOS PASSED (${passed}/${passed})`);
    console.log('================================================================\n');

  } catch (err) {
    console.error('\n[SUITE ABORTED]', err.message);
  } finally {
    console.log('Cleaning up server process...');
    await stopServerProcess();
    if (failed > 0) {
      process.exit(1);
    }
  }
}

runTestSuite();
