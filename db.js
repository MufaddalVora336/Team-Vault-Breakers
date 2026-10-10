/**
 * QueueLess — Database Access Layer (MongoDB Atlas with File Fallback)
 * Manages persistent tokens, status transitions, offices, counters,
 * user accounts, sessions, appointments, and audit activity logs.
 * Uses official MongoDB Node.js driver when configured, transparently
 * falling back to structured JSON file persistence.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const auth = require('./auth');

const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');
const OFFICES_FILE = path.join(DATA_DIR, 'offices.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

// Baseline Seed State
const DEFAULT_STATE = {
  currentServing: {
    id: 'A-40',
    type: 'ONLINE',
    service: 'Income Certificate',
    office: 'Rajkot District Service Center',
    customerName: 'Priya Sharma',
    mobile: '9812345678',
    status: 'SERVING',
    counter: 'Counter 2',
    calledAt: new Date(Date.now() - 3 * 60000).toISOString(),
    isDemo: true
  },
  tokens: [
    {
      id: 'A-41',
      type: 'ONLINE',
      service: 'Income Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Amit Verma',
      mobile: '9823456789',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 15 * 60000).toISOString(),
      isDemo: true
    },
    {
      id: 'A-42',
      type: 'WALK-IN',
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Suresh Mehta',
      mobile: '9834567890',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 10 * 60000).toISOString(),
      isDemo: true
    },
    {
      id: 'A-43',
      type: 'ONLINE',
      service: 'Birth Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Neha Gupta',
      mobile: '9845678901',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
      isDemo: true
    }
  ],
  completedTokens: [
    { id: 'A-38', type: 'ONLINE', service: 'Income Certificate', status: 'COMPLETED', isDemo: true },
    { id: 'A-39', type: 'WALK-IN', service: 'Caste Certificate', status: 'COMPLETED', isDemo: true }
  ],
  nextTokenNum: 44,
  completedCount: 24,
  walkinCount: 1,
  soundEnabled: true
};

const DEFAULT_OFFICES = [
  {
    id: 'OFF-01',
    name: 'Rajkot District Service Center',
    tagline: 'Jan Seva Kendra',
    district: 'Rajkot',
    services: [
      'Income Certificate',
      'Residence Certificate',
      'Birth Certificate',
      'Caste Certificate',
      'Land Records & RoR (7/12)'
    ],
    counters: [
      { id: 'C-01', name: 'Counter 1', service: 'Revenue Services', officerId: null, officerName: 'Standby' },
      { id: 'C-02', name: 'Counter 2', service: 'Certificates & Jan Seva', officerId: 'USR-OFFICER-01', officerName: 'Prakash Varma' },
      { id: 'C-03', name: 'Counter 3', service: 'Land & RoR', officerId: null, officerName: 'Standby' },
      { id: 'C-04', name: 'Counter 4', service: 'General Inquiries', officerId: null, officerName: 'Standby' }
    ]
  },
  {
    id: 'OFF-02',
    name: 'Ahmedabad Civic Center (East Zone)',
    tagline: 'East Zone Seva Kendra',
    district: 'Ahmedabad',
    services: [
      'Income Certificate',
      'Birth Certificate',
      'Caste Certificate'
    ],
    counters: [
      { id: 'C-05', name: 'Counter 1', service: 'Civic Certificates', officerId: null, officerName: 'Standby' },
      { id: 'C-06', name: 'Counter 2', service: 'Revenue Desk', officerId: null, officerName: 'Standby' }
    ]
  },
  {
    id: 'OFF-03',
    name: 'Surat Jan Seva Kendra',
    tagline: 'City Civic Center',
    district: 'Surat',
    services: [
      'Income Certificate',
      'Residence Certificate',
      'Birth Certificate'
    ],
    counters: [
      { id: 'C-07', name: 'Counter 1', service: 'General Services', officerId: null, officerName: 'Standby' }
    ]
  },
  {
    id: 'OFF-04',
    name: 'Vadodara Collectorate Office',
    tagline: 'Collectorate Jan Seva',
    district: 'Vadodara',
    services: [
      'Income Certificate',
      'Caste Certificate',
      'Land Records & RoR (7/12)'
    ],
    counters: [
      { id: 'C-08', name: 'Counter 1', service: 'Revenue & Land', officerId: null, officerName: 'Standby' }
    ]
  }
];

let mongoClient = null;
let mongoDb = null;
let isMongoConnected = false;
let dbStatusInfo = {
  mode: 'file_fallback',
  connected: false,
  dbName: null,
  message: 'MONGODB_URI not configured in .env; running in local file persistence fallback mode'
};

// ==========================================
// File Persistence Helpers
// ==========================================

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFile(filePath, defaultData) {
  ensureDataDir();
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      console.warn(`[STORAGE WARNING] Corrupted file ${path.basename(filePath)}, resetting.`);
    }
  }
  const initial = typeof defaultData === 'function' ? defaultData() : JSON.parse(JSON.stringify(defaultData));
  saveFile(filePath, initial);
  return initial;
}

function saveFile(filePath, data) {
  ensureDataDir();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[STORAGE ERROR] Failed writing ${path.basename(filePath)}: ${e.message}`);
  }
}

// In-Memory Cached File Tables
let fileState = loadFile(QUEUE_FILE, DEFAULT_STATE);
let fileAppointments = loadFile(APPOINTMENTS_FILE, []);
let fileOffices = loadFile(OFFICES_FILE, DEFAULT_OFFICES);
let fileUsers = loadFile(USERS_FILE, () => {
  // Initial demo officer, pending officer, and admin
  const officerCred = auth.hashPassword('officer123');
  const pendingCred = auth.hashPassword('staff123');
  const adminCred = auth.hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234');
  return [
    {
      id: 'USR-ADMIN-01',
      username: process.env.ADMIN_USERNAME || 'admin',
      email: `${process.env.ADMIN_USERNAME || 'admin'}@queueless.gov.in`,
      name: 'System Administrator',
      mobile: '9999999999',
      role: 'admin',
      status: 'APPROVED',
      office: 'All Offices',
      counter: 'All Counters',
      passwordHash: adminCred.hash,
      salt: adminCred.salt,
      createdAt: new Date().toISOString(),
      approvedBy: 'System Auto-Provision',
      approvedAt: new Date().toISOString()
    },
    {
      id: 'USR-OFFICER-01',
      username: 'officer1',
      email: 'officer1@queueless.gov.in',
      name: 'Prakash Varma',
      mobile: '9876500001',
      role: 'officer',
      status: 'APPROVED',
      office: 'Rajkot District Service Center',
      counter: 'Counter 2',
      passwordHash: officerCred.hash,
      salt: officerCred.salt,
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      approvedBy: 'System Auto-Seed',
      approvedAt: new Date(Date.now() - 86400000).toISOString()
    },
    {
      id: 'USR-OFFICER-02',
      username: 'sneha_patel',
      email: 'sneha.patel@queueless.gov.in',
      name: 'Sneha Patel',
      mobile: '9876500002',
      role: 'officer',
      status: 'PENDING',
      office: 'Ahmedabad Civic Center (East Zone)',
      counter: 'Counter 1',
      passwordHash: pendingCred.hash,
      salt: pendingCred.salt,
      createdAt: new Date().toISOString(),
      approvedBy: null,
      approvedAt: null
    }
  ];
});
let fileSessions = loadFile(SESSIONS_FILE, {});
let fileActivityLogs = loadFile(ACTIVITY_FILE, () => [
  {
    id: 'LOG-001',
    timestamp: new Date().toISOString(),
    action: 'SYSTEM_STARTUP',
    actor: { name: 'System', role: 'system' },
    details: 'QueueLess civic-tech server initialized.'
  }
]);

// ==========================================
// Database Initialization
// ==========================================

async function initDatabase() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'queueless';

  if (!uri || !uri.trim()) {
    isMongoConnected = false;
    dbStatusInfo = {
      mode: 'file_fallback',
      connected: false,
      dbName: null,
      missingConfig: ['MONGODB_URI'],
      message: 'MONGODB_URI is not set in environment or .env. Running on local file persistence fallback.'
    };
    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  }

  try {
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);

    // Verify connection
    await mongoDb.command({ ping: 1 });

    // Ensure collections and unique indexes
    const tokensCol = mongoDb.collection('tokens');
    const appointmentsCol = mongoDb.collection('appointments');
    const officesCol = mongoDb.collection('offices');
    const usersCol = mongoDb.collection('users');
    const sessionsCol = mongoDb.collection('sessions');
    const activityCol = mongoDb.collection('activity');
    const metadataCol = mongoDb.collection('metadata');

    await tokensCol.createIndex({ id: 1 }, { unique: true });
    await tokensCol.createIndex({ status: 1 });
    await tokensCol.createIndex({ office: 1 });
    await tokensCol.createIndex({ createdAt: 1 });
    await appointmentsCol.createIndex({ id: 1 }, { unique: true });
    await usersCol.createIndex({ username: 1 }, { unique: true });
    await usersCol.createIndex({ email: 1 }, { unique: true, sparse: true });
    await sessionsCol.createIndex({ token: 1 }, { unique: true });
    await sessionsCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // Preserve existing records or initialize if fresh
    const existingTokens = await tokensCol.countDocuments();
    if (existingTokens === 0) {
      console.log('[MONGODB] Initializing fresh database with baseline state...');
      const seedTokens = [
        DEFAULT_STATE.currentServing,
        ...DEFAULT_STATE.tokens,
        ...DEFAULT_STATE.completedTokens
      ];
      await tokensCol.insertMany(seedTokens);
      await metadataCol.updateOne(
        { _id: 'queue_meta' },
        {
          $set: {
            nextTokenNum: DEFAULT_STATE.nextTokenNum,
            completedCount: DEFAULT_STATE.completedCount,
            walkinCount: DEFAULT_STATE.walkinCount,
            soundEnabled: true
          }
        },
        { upsert: true }
      );
    }

    const existingOffices = await officesCol.countDocuments();
    if (existingOffices === 0) {
      await officesCol.insertMany(DEFAULT_OFFICES);
    }

    isMongoConnected = true;
    dbStatusInfo = {
      mode: 'mongodb',
      connected: true,
      dbName,
      message: `Successfully connected to MongoDB Atlas database "${dbName}".`
    };

    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  } catch (err) {
    isMongoConnected = false;
    dbStatusInfo = {
      mode: 'file_fallback',
      connected: false,
      dbName: null,
      error: err.message,
      message: `Failed to connect to MongoDB Atlas (${err.message}). Falling back to file persistence.`
    };
    console.warn(`[MONGODB WARNING] ${dbStatusInfo.message}`);
    await provisionInitialAdminIfConfigured();
    return dbStatusInfo;
  }
}

function getDatabaseStatus() {
  return dbStatusInfo;
}

// ==========================================
// Admin Account Provisioning
// ==========================================

async function provisionInitialAdminIfConfigured() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234';

  const existingAdmin = await getUserByRole('admin');
  if (existingAdmin) {
    return; // Administrator already exists
  }

  if (adminPassword && adminPassword.trim()) {
    const cred = auth.hashPassword(adminPassword.trim());
    const adminUser = {
      id: 'USR-ADMIN-01',
      username: adminUsername,
      email: `${adminUsername}@queueless.gov.in`,
      name: 'System Administrator',
      mobile: '9999999999',
      role: 'admin',
      status: 'APPROVED',
      office: 'All Offices',
      counter: 'All Counters',
      passwordHash: cred.hash,
      salt: cred.salt,
      createdAt: new Date().toISOString(),
      approvedBy: 'Auto-Provisioned (.env)',
      approvedAt: new Date().toISOString()
    };
    await createUser(adminUser);
    console.log(`[AUTH] Initial administrator account "${adminUsername}" provisioned from .env.`);
  }
}

// ==========================================
// Queue State & Mutations (Single Source of Truth)
// ==========================================

async function getQueueState(office = null) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const servingQuery = { status: 'SERVING' };
    const waitingQuery = { status: 'WAITING' };
    const completedQuery = { status: 'COMPLETED' };
    if (office && office !== 'All Offices') {
      servingQuery.office = office;
      waitingQuery.office = office;
      completedQuery.office = office;
    }

    const [currentServing, waitingTokens, completedTokens, meta] = await Promise.all([
      tokensCol.findOne(servingQuery),
      tokensCol.find(waitingQuery).sort({ createdAt: 1 }).toArray(),
      tokensCol.find(completedQuery).sort({ completedAt: -1, createdAt: -1 }).limit(15).toArray(),
      metadataCol.findOne({ _id: 'queue_meta' })
    ]);

    const nextTokenNum = (meta && meta.nextTokenNum) || 44;
    const completedCount = (meta && meta.completedCount) || 24;
    const walkinCount = (meta && meta.walkinCount) || 1;
    const soundEnabled = meta ? meta.soundEnabled !== false : true;

    return {
      currentServing: currentServing || null,
      tokens: waitingTokens,
      completedTokens,
      nextTokenNum,
      completedCount,
      walkinCount,
      soundEnabled
    };
  }

  // File persistence: filter by office if specified
  if (office && office !== 'All Offices') {
    const isServingOffice = fileState.currentServing && fileState.currentServing.office === office;
    return {
      currentServing: isServingOffice ? fileState.currentServing : null,
      tokens: fileState.tokens.filter(t => t.office === office),
      completedTokens: fileState.completedTokens.filter(t => t.office === office),
      nextTokenNum: fileState.nextTokenNum,
      completedCount: fileState.completedCount,
      walkinCount: fileState.walkinCount,
      soundEnabled: fileState.soundEnabled
    };
  }

  return fileState;
}

async function getStats(office = null) {
  const state = await getQueueState(office);
  const waiting = state.tokens.filter(t => t.status === 'WAITING').length;
  const serving = (state.currentServing && state.currentServing.status === 'SERVING') ? 1 : 0;
  return {
    waiting,
    serving,
    completed: state.completedCount,
    walkins: state.walkinCount,
    currentServingId: state.currentServing ? state.currentServing.id : 'None',
    currentServingToken: state.currentServing
  };
}

async function hasActiveTokenForService(mobile, service) {
  if (!mobile) return false;
  const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
  if (!cleanMobile) return false;

  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const existing = await tokensCol.findOne({
      service,
      status: { $in: ['WAITING', 'CALLED', 'SERVING'] },
      $or: [
        { mobile: cleanMobile },
        { mobile: { $regex: cleanMobile + '$' } }
      ]
    });
    return !!existing;
  }

  const inWaiting = fileState.tokens.some(t => {
    const tMobile = String(t.mobile || '').replace(/\D/g, '').slice(-10);
    return tMobile === cleanMobile && t.service === service && (t.status === 'WAITING' || t.status === 'CALLED');
  });

  const inServing = fileState.currentServing &&
    String(fileState.currentServing.mobile || '').replace(/\D/g, '').slice(-10) === cleanMobile &&
    fileState.currentServing.service === service &&
    fileState.currentServing.status === 'SERVING';

  return inWaiting || inServing;
}

// Atomic Token Creation
async function addToken({
  service = 'Income Certificate',
  office = 'Rajkot District Service Center',
  mobile = '',
  customerName = 'Citizen',
  type = 'ONLINE',
  isDemo = false
}) {
  const isWalkin = type.toUpperCase() === 'WALK-IN';
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);

  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const updateFields = { nextTokenNum: 1 };
    if (isWalkin) updateFields.walkinCount = 1;

    const metaResult = await metadataCol.findOneAndUpdate(
      { _id: 'queue_meta' },
      { $inc: updateFields },
      { returnDocument: 'after', upsert: true }
    );

    const tokenNum = metaResult.nextTokenNum - 1;
    const tokenId = `A-${tokenNum}`;

    const newToken = {
      id: tokenId,
      type: isWalkin ? 'WALK-IN' : 'ONLINE',
      service,
      office,
      customerName: customerName || (isWalkin ? 'Walk-in Citizen' : 'Citizen'),
      mobile: cleanMobile,
      status: 'WAITING',
      isDemo: !!isDemo,
      createdAt: new Date().toISOString()
    };

    await tokensCol.insertOne(newToken);
    await logActivity('TOKEN_CREATED', { name: customerName || 'Citizen', role: isWalkin ? 'officer' : 'citizen' }, {
      tokenId,
      type: newToken.type,
      service,
      office
    });

    const updatedState = await getQueueState(office);
    return { token: newToken, state: updatedState };
  }

  // File persistence with in-memory atomic sequence
  const tokenId = `A-${fileState.nextTokenNum}`;
  fileState.nextTokenNum += 1;
  if (isWalkin) fileState.walkinCount += 1;

  const newToken = {
    id: tokenId,
    type: isWalkin ? 'WALK-IN' : 'ONLINE',
    service,
    office,
    customerName: customerName || (isWalkin ? 'Walk-in Citizen' : 'Citizen'),
    mobile: cleanMobile,
    status: 'WAITING',
    isDemo: !!isDemo,
    createdAt: new Date().toISOString()
  };

  fileState.tokens.push(newToken);
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_CREATED', { name: customerName || 'Citizen', role: isWalkin ? 'officer' : 'citizen' }, {
    tokenId,
    type: newToken.type,
    service,
    office
  });

  return { token: newToken, state: fileState };
}

// Call Next Waiting Token
async function callNext(counter = 'Counter 2', targetTokenId = null, actor = { name: 'Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    let targetToken = null;
    if (targetTokenId) {
      targetToken = await tokensCol.findOne({ id: targetTokenId, status: 'WAITING' });
    } else {
      targetToken = await tokensCol.findOne({ status: 'WAITING' }, { sort: { createdAt: 1 } });
    }

    if (!targetToken) {
      throw new Error('No eligible waiting customer in queue.');
    }

    // Complete current serving if present
    const currentServing = await tokensCol.findOne({ status: 'SERVING' });
    if (currentServing) {
      await tokensCol.updateOne(
        { id: currentServing.id },
        {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date().toISOString()
          }
        }
      );
      await metadataCol.updateOne({ _id: 'queue_meta' }, { $inc: { completedCount: 1 } });
    }

    // Call target token
    const now = new Date().toISOString();
    await tokensCol.updateOne(
      { id: targetToken.id },
      {
        $set: {
          status: 'SERVING',
          counter: counter || 'Counter 2',
          calledAt: now,
          servedBy: actor.name
        }
      }
    );

    targetToken.status = 'SERVING';
    targetToken.counter = counter || 'Counter 2';
    targetToken.calledAt = now;

    await logActivity('TOKEN_CALLED', actor, {
      tokenId: targetToken.id,
      counter: counter || 'Counter 2',
      service: targetToken.service
    });

    const state = await getQueueState();
    return { calledToken: targetToken, state };
  }

  // File persistence
  let targetIndex = -1;
  if (targetTokenId) {
    targetIndex = fileState.tokens.findIndex(t => t.id === targetTokenId);
  } else {
    targetIndex = fileState.tokens.findIndex(t => t.status === 'WAITING');
  }

  if (targetIndex === -1) {
    throw new Error('No waiting customers in queue.');
  }

  if (fileState.currentServing && fileState.currentServing.status === 'SERVING') {
    const prev = fileState.currentServing;
    prev.status = 'COMPLETED';
    prev.completedAt = new Date().toISOString();
    fileState.completedTokens.unshift(prev);
    fileState.completedCount += 1;
  }

  const [calledToken] = fileState.tokens.splice(targetIndex, 1);
  calledToken.status = 'SERVING';
  calledToken.counter = counter || 'Counter 2';
  calledToken.calledAt = new Date().toISOString();
  calledToken.servedBy = actor.name;

  fileState.currentServing = calledToken;
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_CALLED', actor, {
    tokenId: calledToken.id,
    counter: counter || 'Counter 2',
    service: calledToken.service
  });

  return { calledToken, state: fileState };
}

// Complete Current Serving Token
async function completeCurrent(actor = { name: 'Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const currentServing = await tokensCol.findOne({ status: 'SERVING' });
    if (!currentServing) {
      throw new Error('No customer currently being served.');
    }

    const completedAt = new Date().toISOString();
    await tokensCol.updateOne(
      { id: currentServing.id },
      {
        $set: {
          status: 'COMPLETED',
          completedAt
        }
      }
    );
    await metadataCol.updateOne({ _id: 'queue_meta' }, { $inc: { completedCount: 1 } });

    currentServing.status = 'COMPLETED';
    currentServing.completedAt = completedAt;

    await logActivity('TOKEN_COMPLETED', actor, {
      tokenId: currentServing.id,
      counter: currentServing.counter || 'Counter 2'
    });

    const state = await getQueueState();
    return { completedToken: currentServing, state };
  }

  if (!fileState.currentServing || fileState.currentServing.status !== 'SERVING') {
    throw new Error('No customer currently being served.');
  }

  const completed = {
    ...fileState.currentServing,
    status: 'COMPLETED',
    completedAt: new Date().toISOString()
  };
  fileState.completedTokens.unshift(completed);
  fileState.completedCount += 1;
  fileState.currentServing = null;
  saveFile(QUEUE_FILE, fileState);

  await logActivity('TOKEN_COMPLETED', actor, {
    tokenId: completed.id,
    counter: completed.counter || 'Counter 2'
  });

  return { completedToken: completed, state: fileState };
}

// Mark No-Show
async function markNoShow(tokenId, actor = { name: 'Officer', role: 'officer' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const token = await tokensCol.findOne({ id: tokenId });
    if (!token) {
      throw new Error(`Token ${tokenId} not found.`);
    }

    await tokensCol.updateOne(
      { id: tokenId },
      { $set: { status: 'NO_SHOW', updatedAt: new Date().toISOString() } }
    );
    token.status = 'NO_SHOW';

    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    const state = await getQueueState();
    return { token, state };
  }

  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const finished = { ...fileState.currentServing, status: 'NO_SHOW' };
    fileState.currentServing = null;
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    return { token: finished, state: fileState };
  }

  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'NO_SHOW';
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_NOSHOW', actor, { tokenId });
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found.`);
}

// Cancel Token
async function cancelToken(tokenId, actor = { name: 'Citizen', role: 'citizen' }) {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const token = await tokensCol.findOne({ id: tokenId });
    if (!token) {
      throw new Error(`Token ${tokenId} not found in waiting queue.`);
    }

    await tokensCol.updateOne(
      { id: tokenId },
      { $set: { status: 'CANCELLED', updatedAt: new Date().toISOString() } }
    );
    token.status = 'CANCELLED';

    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    const state = await getQueueState();
    return { token, state };
  }

  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'CANCELLED';
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    return { token: t, state: fileState };
  }

  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const t = fileState.currentServing;
    t.status = 'CANCELLED';
    fileState.currentServing = null;
    saveFile(QUEUE_FILE, fileState);
    await logActivity('TOKEN_CANCELLED', actor, { tokenId });
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found in waiting queue.`);
}

// Explicit Demo Queue Seeder (Never auto-wipes existing user data!)
async function seedDemoData({ office = 'Rajkot District Service Center', force = false } = {}) {
  const current = await getQueueState(office);
  const waitingCount = current.tokens.filter(t => t.status === 'WAITING').length;

  if (waitingCount >= 3 && !force) {
    return {
      seeded: false,
      message: `Queue already contains ${waitingCount} waiting tokens. Seeding skipped to prevent duplicates.`,
      state: current
    };
  }

  const demoBatch = [
    { name: 'Amit Verma', service: 'Income Certificate', type: 'ONLINE', mobile: '9823456789' },
    { name: 'Suresh Mehta', service: 'Residence Certificate', type: 'WALK-IN', mobile: '9834567890' },
    { name: 'Neha Gupta', service: 'Birth Certificate', type: 'ONLINE', mobile: '9845678901' },
    { name: 'Ramesh Dave', service: 'Caste Certificate', type: 'ONLINE', mobile: '9856789012' }
  ];

  for (const item of demoBatch) {
    await addToken({
      service: item.service,
      office,
      mobile: item.mobile,
      customerName: item.name,
      type: item.type,
      isDemo: true
    });
  }

  await logActivity('DEMO_SEEDED', { name: 'Demo Runner', role: 'admin' }, { office, count: demoBatch.length });
  const updatedState = await getQueueState(office);
  return {
    seeded: true,
    count: demoBatch.length,
    state: updatedState
  };
}

// Global Filtered Tokens for Admin Queue Monitor
async function getAllTokensFiltered({
  office = '',
  service = '',
  counter = '',
  status = '',
  date = '',
  limit = 100
} = {}) {
  let allTokens = [];

  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const query = {};
    if (office && office !== 'All Offices') query.office = office;
    if (service && service !== 'All Services') query.service = service;
    if (counter && counter !== 'All Counters') query.counter = counter;
    if (status && status !== 'All Statuses') query.status = status;
    if (date) {
      query.createdAt = { $regex: '^' + date };
    }
    allTokens = await tokensCol.find(query).sort({ createdAt: -1 }).limit(Number(limit)).toArray();
  } else {
    // Collect from file state
    const pool = [
      ...(fileState.currentServing ? [fileState.currentServing] : []),
      ...fileState.tokens,
      ...fileState.completedTokens
    ];

    allTokens = pool.filter(t => {
      if (office && office !== 'All Offices' && t.office !== office) return false;
      if (service && service !== 'All Services' && t.service !== service) return false;
      if (counter && counter !== 'All Counters' && t.counter !== counter) return false;
      if (status && status !== 'All Statuses' && t.status !== status) return false;
      if (date && t.createdAt && !t.createdAt.startsWith(date)) return false;
      return true;
    });

    allTokens = allTokens.slice(0, Number(limit));
  }

  return allTokens;
}

// Calculate Queue Metrics
async function getQueueMetrics(office = null) {
  const state = await getQueueState(office);
  const officesList = await getOffices();
  const selectedOffice = officesList.find(o => o.name === office) || officesList[0];

  const waitingCount = state.tokens.filter(t => t.status === 'WAITING').length;
  const servingCount = state.currentServing ? 1 : 0;
  const activeCountersCount = selectedOffice ? selectedOffice.counters.filter(c => c.officerId).length : 1;
  const effectiveCounters = Math.max(1, activeCountersCount);

  // Dynamic Average Waiting Time (Minutes)
  const avgWaitTimeMinutes = Math.round((waitingCount * 5) / effectiveCounters);

  return {
    waitingCount,
    servingCount,
    completedToday: state.completedCount,
    walkinsToday: state.walkinCount,
    activeCounters: activeCountersCount,
    avgWaitTimeMinutes: avgWaitTimeMinutes || 5
  };
}

// Reset Queue Demo Baseline
async function resetQueue() {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    await tokensCol.deleteMany({});
    const seedTokens = [
      DEFAULT_STATE.currentServing,
      ...DEFAULT_STATE.tokens,
      ...DEFAULT_STATE.completedTokens
    ];
    await tokensCol.insertMany(seedTokens);

    await metadataCol.updateOne(
      { _id: 'queue_meta' },
      {
        $set: {
          nextTokenNum: DEFAULT_STATE.nextTokenNum,
          completedCount: DEFAULT_STATE.completedCount,
          walkinCount: DEFAULT_STATE.walkinCount,
          soundEnabled: true
        }
      },
      { upsert: true }
    );

    return await getQueueState();
  }

  fileState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveFile(QUEUE_FILE, fileState);
  return fileState;
}

// ==========================================
// Appointment Management
// ==========================================

async function createAppointment({
  office = 'Rajkot District Service Center',
  service = 'Income Certificate',
  date = new Date().toISOString().split('T')[0],
  slot = '10:00 AM – 10:30 AM',
  name = 'Citizen',
  mobile = ''
}) {
  const aptId = `APT-${Math.floor(1000 + Math.random() * 9000)}`;
  const cleanMobile = String(mobile || '').replace(/\D/g, '').slice(-10);
  const appointment = {
    id: aptId,
    office,
    service,
    date,
    slot,
    name: name || 'Citizen',
    mobile: cleanMobile,
    status: 'CONFIRMED',
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    await appointmentsCol.insertOne(appointment);
  } else {
    fileAppointments.unshift(appointment);
    saveFile(APPOINTMENTS_FILE, fileAppointments);
  }

  await logActivity('APPOINTMENT_BOOKED', { name: name || 'Citizen', role: 'citizen' }, {
    aptId,
    office,
    service,
    slot,
    date
  });

  return appointment;
}

async function getAppointments() {
  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    return await appointmentsCol.find().sort({ createdAt: -1 }).toArray();
  }
  return fileAppointments;
}

// ==========================================
// Office, Service & Counter Management
// ==========================================

async function getOffices() {
  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    return await officesCol.find().toArray();
  }
  return fileOffices;
}

async function addOffice({ name, tagline, district, services = [] }) {
  if (!name || !name.trim()) throw new Error('Office name is required.');
  const id = `OFF-${String(Date.now()).slice(-4)}`;
  const newOffice = {
    id,
    name: name.trim(),
    tagline: tagline ? tagline.trim() : 'District Seva Kendra',
    district: district ? district.trim() : 'Gujarat',
    services: services.length ? services : ['Income Certificate', 'Residence Certificate'],
    counters: [
      { id: `C-${id}-01`, name: 'Counter 1', service: 'General Inquiries', officerId: null, officerName: 'Standby' }
    ]
  };

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.insertOne(newOffice);
  } else {
    fileOffices.push(newOffice);
    saveFile(OFFICES_FILE, fileOffices);
  }

  await logActivity('OFFICE_ADDED', { name: 'Administrator', role: 'admin' }, { officeId: id, name });
  return newOffice;
}

async function addServiceToOffice(officeId, serviceName) {
  if (!serviceName || !serviceName.trim()) throw new Error('Service name is required.');
  const sName = serviceName.trim();

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne({ id: officeId }, { $addToSet: { services: sName } });
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (!off) throw new Error('Office not found.');
    if (!off.services.includes(sName)) {
      off.services.push(sName);
      saveFile(OFFICES_FILE, fileOffices);
    }
  }

  await logActivity('SERVICE_ADDED', { name: 'Administrator', role: 'admin' }, { officeId, service: sName });
  return { success: true, service: sName };
}

async function addCounterToOffice(officeId, { name, service }) {
  if (!name || !name.trim()) throw new Error('Counter name is required.');
  const cId = `C-${Date.now().toString().slice(-4)}`;
  const counterObj = {
    id: cId,
    name: name.trim(),
    service: service ? service.trim() : 'General Services',
    officerId: null,
    officerName: 'Standby'
  };

  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne({ id: officeId }, { $push: { counters: counterObj } });
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (!off) throw new Error('Office not found.');
    off.counters.push(counterObj);
    saveFile(OFFICES_FILE, fileOffices);
  }

  await logActivity('COUNTER_ADDED', { name: 'Administrator', role: 'admin' }, { officeId, counterId: cId, name });
  return counterObj;
}

async function assignCounterOfficer(officeId, counterId, officerId, officerName) {
  if (isMongoConnected && mongoDb) {
    const officesCol = mongoDb.collection('offices');
    await officesCol.updateOne(
      { id: officeId, 'counters.id': counterId },
      {
        $set: {
          'counters.$.officerId': officerId || null,
          'counters.$.officerName': officerName || 'Standby'
        }
      }
    );
  } else {
    const off = fileOffices.find(o => o.id === officeId);
    if (off) {
      const c = off.counters.find(cnt => cnt.id === counterId);
      if (c) {
        c.officerId = officerId || null;
        c.officerName = officerName || 'Standby';
        saveFile(OFFICES_FILE, fileOffices);
      }
    }
  }

  await logActivity('COUNTER_ASSIGNED', { name: 'Administrator', role: 'admin' }, {
    officeId,
    counterId,
    officerId,
    officerName
  });
  return { success: true };
}

// ==========================================
// User & Staff Management
// ==========================================

async function getUsers(filter = {}) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.find(filter, { projection: { passwordHash: 0, salt: 0 } }).toArray();
  }
  return fileUsers.map(u => {
    const { passwordHash, salt, ...safe } = u;
    return safe;
  }).filter(u => {
    if (filter.role && u.role !== filter.role) return false;
    if (filter.status && u.status !== filter.status) return false;
    return true;
  });
}

async function getUserById(id) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({ id });
  }
  return fileUsers.find(u => u.id === id) || null;
}

async function getUserByIdentifier(identifier) {
  if (!identifier) return null;
  const clean = identifier.trim().toLowerCase();

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({
      $or: [
        { username: { $regex: `^${clean}$`, $options: 'i' } },
        { email: { $regex: `^${clean}$`, $options: 'i' } }
      ]
    });
  }

  return fileUsers.find(u =>
    (u.username && u.username.toLowerCase() === clean) ||
    (u.email && u.email.toLowerCase() === clean)
  ) || null;
}

async function getUserByRole(role) {
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    return await usersCol.findOne({ role });
  }
  return fileUsers.find(u => u.role === role) || null;
}

async function createUser(userData) {
  const existing = await getUserByIdentifier(userData.username || userData.email);
  if (existing) {
    throw new Error('Username or email is already registered.');
  }

  const id = userData.id || `USR-${Date.now().toString().slice(-6)}`;
  const newUser = {
    ...userData,
    id,
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.insertOne(newUser);
  } else {
    fileUsers.push(newUser);
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_REGISTERED', { name: newUser.name, role: newUser.role }, {
    userId: id,
    status: newUser.status,
    office: newUser.office
  });

  const { passwordHash, salt, ...safeUser } = newUser;
  return safeUser;
}

async function approveStaff(userId, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  const now = new Date().toISOString();
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne(
      { id: userId },
      { $set: { status: 'APPROVED', approvedBy: adminActor.name, approvedAt: now } }
    );
  } else {
    user.status = 'APPROVED';
    user.approvedBy = adminActor.name;
    user.approvedAt = now;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_APPROVED', adminActor, {
    staffId: userId,
    staffName: user.name,
    office: user.office
  });

  return { success: true, user: { ...user, status: 'APPROVED' } };
}

async function rejectStaff(userId, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  const now = new Date().toISOString();
  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne(
      { id: userId },
      { $set: { status: 'REJECTED', rejectedBy: adminActor.name, rejectedAt: now } }
    );
  } else {
    user.status = 'REJECTED';
    user.rejectedBy = adminActor.name;
    user.rejectedAt = now;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_REJECTED', adminActor, {
    staffId: userId,
    staffName: user.name
  });

  return { success: true, user: { ...user, status: 'REJECTED' } };
}

async function setStaffStatus(userId, status, adminActor) {
  const user = await getUserById(userId);
  if (!user) throw new Error('Staff member not found.');

  if (isMongoConnected && mongoDb) {
    const usersCol = mongoDb.collection('users');
    await usersCol.updateOne({ id: userId }, { $set: { status } });
  } else {
    user.status = status;
    saveFile(USERS_FILE, fileUsers);
  }

  await logActivity('STAFF_STATUS_CHANGED', adminActor, {
    staffId: userId,
    newStatus: status
  });

  return { success: true, user: { ...user, status } };
}

// ==========================================
// Session Management
// ==========================================

async function createSession(user) {
  const token = auth.generateToken();
  const session = {
    token,
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    status: user.status || 'APPROVED',
    office: user.office,
    counter: user.counter,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString() // 24 Hours
  };

  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    await sessionsCol.insertOne(session);
  } else {
    fileSessions[token] = session;
    saveFile(SESSIONS_FILE, fileSessions);
  }

  return session;
}

async function getSession(token) {
  if (!token) return null;

  let session = null;
  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    session = await sessionsCol.findOne({ token });
  } else {
    session = fileSessions[token] || null;
  }

  if (!session) return null;

  if (new Date(session.expiresAt) < new Date()) {
    await deleteSession(token);
    return null;
  }

  // Real-time synchronization with current user profile
  if (session.userId) {
    const user = await getUserById(session.userId);
    if (user && user.status) {
      session.status = user.status;
    }
  }

  return session;
}

async function deleteSession(token) {
  if (!token) return;
  if (isMongoConnected && mongoDb) {
    const sessionsCol = mongoDb.collection('sessions');
    await sessionsCol.deleteOne({ token });
  } else {
    delete fileSessions[token];
    saveFile(SESSIONS_FILE, fileSessions);
  }
}

// ==========================================
// Audit & Activity Logs
// ==========================================

async function logActivity(action, actor = { name: 'System', role: 'system' }, details = {}) {
  const logItem = {
    id: `LOG-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    action,
    actor: {
      name: actor.name || 'Unknown',
      role: actor.role || 'system'
    },
    details
  };

  if (isMongoConnected && mongoDb) {
    try {
      const activityCol = mongoDb.collection('activity');
      await activityCol.insertOne(logItem);
    } catch (e) {}
  } else {
    fileActivityLogs.unshift(logItem);
    if (fileActivityLogs.length > 500) {
      fileActivityLogs = fileActivityLogs.slice(0, 500); // keep most recent 500
    }
    saveFile(ACTIVITY_FILE, fileActivityLogs);
  }

  return logItem;
}

async function getActivityLogs({ limit = 50, action = null } = {}) {
  if (isMongoConnected && mongoDb) {
    const activityCol = mongoDb.collection('activity');
    const query = action ? { action } : {};
    return await activityCol.find(query).sort({ timestamp: -1 }).limit(Number(limit)).toArray();
  }

  let logs = fileActivityLogs;
  if (action) {
    logs = logs.filter(l => l.action === action);
  }
  return logs.slice(0, Number(limit));
}

// Close connection
async function closeDatabase() {
  if (mongoClient) {
    await mongoClient.close();
    isMongoConnected = false;
  }
}

module.exports = {
  initDatabase,
  getDatabaseStatus,
  getQueueState,
  getStats,
  hasActiveTokenForService,
  addToken,
  callNext,
  completeCurrent,
  markNoShow,
  cancelToken,
  seedDemoData,
  resetQueue,
  getAllTokensFiltered,
  getQueueMetrics,
  createAppointment,
  getAppointments,
  getOffices,
  addOffice,
  addServiceToOffice,
  addCounterToOffice,
  assignCounterOfficer,
  getUsers,
  getUserById,
  getUserByIdentifier,
  getUserByRole,
  createUser,
  approveStaff,
  rejectStaff,
  setStaffStatus,
  createSession,
  getSession,
  deleteSession,
  logActivity,
  getActivityLogs,
  closeDatabase,
  DEFAULT_STATE,
  DEFAULT_OFFICES
};
