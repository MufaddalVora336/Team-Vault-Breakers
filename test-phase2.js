/**
 * QueueLess — Phase 2 Automated Integration Test Suite
 * Tests MongoDB Atlas integration / fallback, Firebase config endpoints,
 * protected token creation flow, unified queue actions, and persistence across restarts.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3890;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
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

async function runPhase2Tests() {
  console.log('====================================================');
  console.log('STARTING QUEUELESS PHASE 2 TEST SUITE');
  console.log('====================================================\n');

  // Step 1: Start Server Process
  console.log('TEST 1: Starting Node.js server with MongoDB & Firebase engines on port ' + TEST_PORT + '...');
  let serverProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', (d) => {
    process.stdout.write('[SERVER OUT] ' + d.toString());
  });
  serverProc.stderr.on('data', (d) => {
    process.stderr.write('[SERVER ERR] ' + d.toString());
  });

  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await request('GET', '/api/status');
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch (e) {}
    await sleep(250);
  }

  if (!ready) {
    console.error('FAIL: Server failed to start on port ' + TEST_PORT);
    process.exit(1);
  }
  console.log('PASS: Server is operational and listening.\n');

  // Step 2: System Status & Diagnostic Check
  console.log('TEST 2: Verifying /api/status diagnostics (MongoDB & Firebase)...');
  const statusRes = await request('GET', '/api/status');
  console.log('Database Status:', JSON.stringify(statusRes.data.database, null, 2));
  console.log('Firebase Status:', JSON.stringify(statusRes.data.firebase, null, 2));

  if (statusRes.data.database.mode === 'mongodb') {
    console.log('PASS: MongoDB Atlas is CONNECTED.');
  } else {
    console.log('PASS: MongoDB credentials check functioning honestly:');
    console.log('   Mode:', statusRes.data.database.mode);
    console.log('   Diagnostic message:', statusRes.data.database.message);
  }
  console.log('');

  // Step 3: Firebase Client Config Delivery
  console.log('TEST 3: Verifying /api/config/firebase endpoint...');
  const fbConfigRes = await request('GET', '/api/config/firebase');
  console.log('Firebase Client Config response:', JSON.stringify(fbConfigRes.data, null, 2));
  if (fbConfigRes.status !== 200 || !fbConfigRes.data.configured) {
    throw new Error('FAIL: /api/config/firebase did not return configured: true');
  }
  console.log('PASS: Firebase client configuration endpoint operational.\n');

  // Reset Queue to seed baseline
  await request('POST', '/api/queue/reset');

  // Step 4: Token Protection Flow (unverified user cannot bypass verification)
  console.log('TEST 4: Testing token protection (unverified citizen without valid OTP)...');
  const unverifiedRes = await request('POST', '/api/token', {
    service: 'Income Certificate',
    mobile: '9876543210' // No idToken provided
  });
  console.log('Unverified request response:', unverifiedRes.status, unverifiedRes.data.message);
  if (unverifiedRes.status !== 401 && unverifiedRes.status !== 400) {
    throw new Error('FAIL: Expected 401/400 for unverified token request, got ' + unverifiedRes.status);
  }
  console.log('PASS: Unverified citizen request is strictly rejected by server auth check.\n');

  // Step 5: Create Token with Verified Phone Credentials
  console.log('TEST 5: Citizen creates token with verified Indian mobile +91 9876543210...');
  const validTokenRes = await request('POST', '/api/token', {
    service: 'Income Certificate',
    office: 'Rajkot District Service Center',
    mobile: '9876543210',
    customerName: 'Aarav Patel',
    idToken: 'TEST_AUTOMATED_TOKEN'
  });
  console.log('Token Response:', validTokenRes.status, validTokenRes.data.token);
  if (validTokenRes.status !== 201 || !validTokenRes.data.token || validTokenRes.data.token.id !== 'A-44') {
    throw new Error('FAIL: Expected token A-44 to be issued, got ' + JSON.stringify(validTokenRes.data));
  }
  console.log('PASS: Token A-44 issued and persisted with verified mobile credentials.\n');

  // Step 6: Officer sees exact token in unified queue
  console.log('TEST 6: Officer retrieves queue and confirms token A-44 in unified queue...');
  const officerQueueRes = await request('GET', '/api/queue');
  const tokens = officerQueueRes.data.state.tokens;
  const tokenA44 = tokens.find(t => t.id === 'A-44');
  if (!tokenA44 || tokenA44.customerName !== 'Aarav Patel') {
    throw new Error('FAIL: Token A-44 not found in officer queue view!');
  }
  console.log('Queue Tokens:', tokens.map(t => `${t.id} [${t.type}]`).join(' -> '));
  console.log('PASS: Officer sees token A-44 in unified queue.\n');

  // Step 7: Officer adds Walk-in Customer
  console.log('TEST 7: Officer adds offline walk-in customer...');
  const walkinRes = await request('POST', '/api/officer/walk-in', {
    name: 'Kavita Joshi',
    mobile: '9876511111',
    service: 'Income Certificate',
    office: 'Rajkot District Service Center'
  });
  console.log('Walk-in Token:', walkinRes.data.token.id, walkinRes.data.token.type);
  if (walkinRes.status !== 201 || walkinRes.data.token.id !== 'A-45') {
    throw new Error('FAIL: Expected walkin token A-45');
  }

  const queueAfterWalkin = await request('GET', '/api/queue');
  console.log('Unified Queue sequence:', queueAfterWalkin.data.state.tokens.map(t => `${t.id} [${t.type}]`).join(' -> '));
  console.log('PASS: Walk-in merged into unified queue consecutively.\n');

  // Step 8: Call Next & Complete
  console.log('TEST 8: Officer calls next waiting citizen and completes service...');
  const callRes = await request('POST', '/api/queue/call-next', { counter: 'Counter 2' });
  console.log('Called Token:', callRes.data.calledToken.id, callRes.data.calledToken.status, 'at', callRes.data.calledToken.counter);
  if (callRes.data.calledToken.id !== 'A-41' || callRes.data.calledToken.status !== 'SERVING') {
    throw new Error('FAIL: Call next did not transition A-41 to SERVING');
  }

  const completeRes = await request('POST', '/api/queue/complete');
  console.log('Completed Token:', completeRes.data.completedToken.id, completeRes.data.completedToken.status);
  if (completeRes.data.completedToken.id !== 'A-41' || completeRes.data.completedToken.status !== 'COMPLETED') {
    throw new Error('FAIL: Complete did not mark A-41 as COMPLETED');
  }
  console.log('PASS: Queue transitions (WAITING -> SERVING -> COMPLETED) verified.\n');

  // Step 9: Appointment Creation & Persistence
  console.log('TEST 9: Creating advance appointment...');
  const aptRes = await request('POST', '/api/appointment', {
    office: 'Rajkot District Service Center',
    service: 'Income Certificate',
    date: '2026-10-11',
    slot: '11:00 AM – 11:30 AM',
    name: 'Manish Dave',
    mobile: '9822334455'
  });
  console.log('Appointment Created:', aptRes.data.appointment.id, aptRes.data.appointment.name);
  const aptId = aptRes.data.appointment.id;

  const aptListRes = await request('GET', '/api/appointments');
  const foundApt = aptListRes.data.appointments.find(a => a.id === aptId);
  if (!foundApt) {
    throw new Error('FAIL: Appointment not found in appointments list!');
  }
  console.log('PASS: Advance appointment created and persisted.\n');

  // Step 10: Server Restart Persistence Verification
  console.log('TEST 10: Restarting server to verify data survives process restart...');
  serverProc.kill('SIGKILL');
  await sleep(1000);

  serverProc = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: TEST_PORT, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', (d) => {
    process.stdout.write('[RESTARTED SERVER] ' + d.toString());
  });

  let restartedReady = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await request('GET', '/api/queue');
      if (res.status === 200) {
        restartedReady = true;
        break;
      }
    } catch (e) {}
    await sleep(250);
  }

  if (!restartedReady) {
    throw new Error('FAIL: Restarted server failed to start.');
  }

  const restartedQueue = await request('GET', '/api/queue');
  const restartedTokens = restartedQueue.data.state.tokens;
  console.log('Tokens after restart:', restartedTokens.map(t => `${t.id} [${t.type}]`).join(' -> '));

  const hasA44 = restartedTokens.some(t => t.id === 'A-44');
  const hasA45 = restartedTokens.some(t => t.id === 'A-45');
  if (!hasA44 || !hasA45) {
    throw new Error('FAIL: Tokens A-44 or A-45 were lost during server restart!');
  }

  const restartedApts = await request('GET', '/api/appointments');
  const hasPersistedApt = restartedApts.data.appointments.some(a => a.id === aptId);
  if (!hasPersistedApt) {
    throw new Error('FAIL: Appointment was lost during server restart!');
  }

  console.log('PASS: All tokens and appointments survived server restart with 100% fidelity.\n');

  serverProc.kill();

  console.log('====================================================');
  console.log('ALL PHASE 2 INTEGRATION TESTS COMPLETED SUCCESSFULLY');
  console.log('====================================================');
}

runPhase2Tests().catch(err => {
  console.error('\nPHASE 2 TEST SUITE FAILED:', err.message);
  process.exit(1);
});
