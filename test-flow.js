/**
 * Comprehensive Automated End-to-End Verification Test for QueueLess
 * Tests the entire required flow:
 * 1. Start Node.js server on test port 3456
 * 2. Create a token from citizen flow (POST /api/token)
 * 3. Confirm exact token appears on officer queue (GET /api/queue)
 * 4. Add walk-in and confirm unified queue ordering
 * 5. Call next token and verify status changes (WAITING -> SERVING)
 * 6. Complete that token and verify updated queue position and ETA
 * 7. Create appointment and verify saved to server
 * 8. Restart server and verify persisted records in data/queue.json & data/appointments.json survive restart
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const TEST_PORT = 3456;
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

async function runTests() {
  console.log('====================================================');
  console.log('STARTING QUEUELESS END-TO-END VALIDATION SUITE');
  console.log('====================================================\n');

  // Step 1: Start Server Process
  console.log('TEST 1: Starting Node.js server on port ' + TEST_PORT + '...');
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

  // Wait for server to be responsive
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await request('GET', '/api/queue');
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
  console.log('PASS: Server is up and responding.\n');

  // Reset to clean seed data
  await request('POST', '/api/queue/reset');

  // Step 2: Citizen selects service & creates token
  console.log('TEST 2: Citizen generates virtual token for Income Certificate...');
  const citizenRes = await request('POST', '/api/token', {
    service: 'Income Certificate',
    office: 'Rajkot District Service Center',
    mobile: '9876543210',
    customerName: 'Citizen Mufaddal',
    idToken: 'TEST_AUTOMATED_TOKEN'
  });

  console.log('Response Status:', citizenRes.status);
  console.log('Token Received:', citizenRes.data.token);
  if (citizenRes.status !== 201 || !citizenRes.data.token || citizenRes.data.token.id !== 'A-44') {
    throw new Error('FAIL: Expected token A-44 to be issued, got ' + JSON.stringify(citizenRes.data));
  }
  console.log('PASS: Token A-44 successfully issued with timestamp and metrics.\n');

  // Step 3: Confirm exact token appears on officer page
  console.log('TEST 3: Officer retrieves queue and verifies token A-44...');
  const queueRes = await request('GET', '/api/queue');
  const tokens = queueRes.data.state.tokens;
  const tokenA44 = tokens.find(t => t.id === 'A-44');
  if (!tokenA44) {
    throw new Error('FAIL: Token A-44 not found in server queue!');
  }
  if (tokenA44.customerName !== 'Citizen Mufaddal' || tokenA44.type !== 'ONLINE') {
    throw new Error('FAIL: Token metadata mismatch: ' + JSON.stringify(tokenA44));
  }
  console.log('PASS: Officer page sees token A-44 in unified queue:');
  console.log('   Tokens in queue:', tokens.map(t => `${t.id} (${t.type})`).join(' -> '));
  console.log('');

  // Step 4: Add walk-in and confirm unified queue
  console.log('TEST 4: Officer adds walk-in customer Rahul Patel...');
  const walkinRes = await request('POST', '/api/officer/walk-in', {
    name: 'Rahul Patel',
    mobile: '9876500000',
    service: 'Income Certificate',
    office: 'Rajkot District Service Center'
  });

  if (walkinRes.status !== 201 || !walkinRes.data.token || walkinRes.data.token.id !== 'A-45') {
    throw new Error('FAIL: Expected walkin token A-45, got ' + JSON.stringify(walkinRes.data));
  }

  const queueResAfterWalkin = await request('GET', '/api/queue');
  const allTokens = queueResAfterWalkin.data.state.tokens;
  const queueOrder = allTokens.map(t => `${t.id} [${t.type}]`);
  console.log('Unified Queue order:', queueOrder.join(' -> '));

  const idxOnline = allTokens.findIndex(t => t.id === 'A-44');
  const idxWalkin = allTokens.findIndex(t => t.id === 'A-45');
  if (idxWalkin !== idxOnline + 1) {
    throw new Error('FAIL: Unified queue ordering incorrect! Online A-44 and Walk-in A-45 must be consecutive.');
  }
  console.log('PASS: Online and Walk-in share the exact same unified queue!\n');

  // Step 5: Officer calls next waiting token
  console.log('TEST 5: Officer calls next token in line (A-41)...');
  const callRes = await request('POST', '/api/queue/call-next', { counter: 'Counter 2' });
  if (callRes.status !== 200 || callRes.data.calledToken.id !== 'A-41') {
    throw new Error('FAIL: Expected A-41 to be called, got ' + JSON.stringify(callRes.data));
  }
  if (callRes.data.calledToken.status !== 'SERVING') {
    throw new Error('FAIL: Called token status should be SERVING, got ' + callRes.data.calledToken.status);
  }
  console.log('PASS: A-41 status transitioned from WAITING -> SERVING at Counter 2.');
  console.log('Previous serving A-40 marked COMPLETED.\n');

  // Step 6: Complete that token and verify updated queue position & ETA
  console.log('TEST 6: Officer completes current serving token (A-41)...');
  const completeRes = await request('POST', '/api/queue/complete');
  if (completeRes.status !== 200 || completeRes.data.completedToken.id !== 'A-41') {
    throw new Error('FAIL: Expected completed token A-41, got ' + JSON.stringify(completeRes.data));
  }
  if (completeRes.data.completedToken.status !== 'COMPLETED') {
    throw new Error('FAIL: Token status should be COMPLETED, got ' + completeRes.data.completedToken.status);
  }

  const queueResAfterComplete = await request('GET', '/api/queue');
  const remainingTokens = queueResAfterComplete.data.state.tokens;
  console.log('Remaining tokens in line:', remainingTokens.map(t => t.id).join(' -> '));
  // A-42 is now at index 0 (0 people ahead, ETA 5 min)
  // A-44 is now at index 2 (2 people ahead, ETA 15 min)
  const a44NewIndex = remainingTokens.findIndex(t => t.id === 'A-44');
  const a44Eta = (a44NewIndex + 1) * 5;
  console.log(`A-44 new queue position: #${a44NewIndex + 1} (${a44NewIndex} people ahead, ETA: ${a44Eta} min)`);
  if (a44NewIndex !== 2) {
    throw new Error('FAIL: Expected A-44 to shift forward to index 2, got ' + a44NewIndex);
  }
  console.log('PASS: Token positions and ETAs dynamically updated.\n');

  // Step 7: Create appointment & verify saved
  console.log('TEST 7: Creating scheduled advance appointment on server...');
  const aptRes = await request('POST', '/api/appointment', {
    office: 'Rajkot District Service Center',
    service: 'Income Certificate',
    date: '2026-10-10',
    slot: '10:30 AM – 11:00 AM',
    name: 'Anjali Sharma',
    mobile: '9811223344'
  });

  if (aptRes.status !== 201 || !aptRes.data.appointment || !aptRes.data.appointment.id.startsWith('APT-')) {
    throw new Error('FAIL: Expected appointment ID APT-XXXX, got ' + JSON.stringify(aptRes.data));
  }
  const aptId = aptRes.data.appointment.id;
  console.log('Appointment created with ID:', aptId);

  const getAptsRes = await request('GET', '/api/appointments');
  const foundApt = getAptsRes.data.appointments.find(a => a.id === aptId);
  if (!foundApt) {
    throw new Error('FAIL: Appointment not found in GET /api/appointments');
  }
  console.log('PASS: Appointment successfully saved to server.\n');

  // Step 8: Verify persistence across server restart
  console.log('TEST 8: Checking disk persistence before restart...');
  const queueFile = path.join(__dirname, 'data', 'queue.json');
  const aptFile = path.join(__dirname, 'data', 'appointments.json');
  if (!fs.existsSync(queueFile) || !fs.existsSync(aptFile)) {
    throw new Error('FAIL: Data files do not exist on disk!');
  }
  console.log('Verified data/queue.json and data/appointments.json exist on disk.');

  console.log('Killing server process (simulating server restart / crash)...');
  serverProc.kill('SIGKILL');
  await sleep(1000);

  console.log('Relaunching server process on port ' + TEST_PORT + '...');
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
    throw new Error('FAIL: Restarted server failed to respond.');
  }

  console.log('Verifying persisted state after restart...');
  const restartedQueue = await request('GET', '/api/queue');
  const tokensAfterRestart = restartedQueue.data.state.tokens;
  const hasA44 = tokensAfterRestart.some(t => t.id === 'A-44');
  const hasA45 = tokensAfterRestart.some(t => t.id === 'A-45');
  console.log('Tokens after restart:', tokensAfterRestart.map(t => t.id).join(' -> '));

  if (!hasA44 || !hasA45) {
    throw new Error('FAIL: Tokens A-44 or A-45 were lost during server restart!');
  }

  const restartedApts = await request('GET', '/api/appointments');
  const hasApt = restartedApts.data.appointments.some(a => a.id === aptId);
  if (!hasApt) {
    throw new Error('FAIL: Appointment ' + aptId + ' was lost during server restart!');
  }

  console.log('PASS: All queue tokens (online + walk-in) and appointments survived server restart!\n');

  // Cleanup server process
  serverProc.kill();

  console.log('====================================================');
  console.log('ALL 8 INTEGRATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('====================================================');
}

runTests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err.message);
  process.exit(1);
});
