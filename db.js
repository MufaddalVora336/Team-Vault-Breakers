/**
 * QueueLess — Database Access Layer (MongoDB Atlas with File Fallback)
 * Manages persistent tokens, status transitions, and appointment records.
 * Uses official MongoDB Node.js driver.
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const APPOINTMENTS_FILE = path.join(DATA_DIR, 'appointments.json');

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
    calledAt: new Date(Date.now() - 3 * 60000).toISOString()
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
      createdAt: new Date(Date.now() - 15 * 60000).toISOString()
    },
    {
      id: 'A-42',
      type: 'WALK-IN',
      service: 'Residence Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Suresh Mehta',
      mobile: '9834567890',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 10 * 60000).toISOString()
    },
    {
      id: 'A-43',
      type: 'ONLINE',
      service: 'Birth Certificate',
      office: 'Rajkot District Service Center',
      customerName: 'Neha Gupta',
      mobile: '9845678901',
      status: 'WAITING',
      createdAt: new Date(Date.now() - 5 * 60000).toISOString()
    }
  ],
  completedTokens: [
    { id: 'A-38', type: 'ONLINE', service: 'Income Certificate', status: 'COMPLETED' },
    { id: 'A-39', type: 'WALK-IN', service: 'Caste Certificate', status: 'COMPLETED' }
  ],
  nextTokenNum: 44,
  completedCount: 24,
  walkinCount: 1,
  soundEnabled: true
};

let mongoClient = null;
let mongoDb = null;
let isMongoConnected = false;
let dbStatusInfo = {
  mode: 'file_fallback',
  connected: false,
  dbName: null,
  message: 'MONGODB_URI not configured in .env; running in local file persistence fallback mode'
};

// File Persistence Helpers
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFileQueue() {
  ensureDataDir();
  if (fs.existsSync(QUEUE_FILE)) {
    try {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed && Array.isArray(parsed.tokens)) {
        return parsed;
      }
    } catch (e) {}
  }
  const initial = JSON.parse(JSON.stringify(DEFAULT_STATE));
  saveFileQueue(initial);
  return initial;
}

function saveFileQueue(stateToSave) {
  ensureDataDir();
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(stateToSave, null, 2), 'utf8');
  } catch (e) {
    console.error(`[STORAGE ERROR] Failed writing queue.json: ${e.message}`);
  }
}

function loadFileAppointments() {
  ensureDataDir();
  if (fs.existsSync(APPOINTMENTS_FILE)) {
    try {
      const data = fs.readFileSync(APPOINTMENTS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {}
  }
  const initial = [];
  saveFileAppointments(initial);
  return initial;
}

function saveFileAppointments(apptsToSave) {
  ensureDataDir();
  try {
    fs.writeFileSync(APPOINTMENTS_FILE, JSON.stringify(apptsToSave, null, 2), 'utf8');
  } catch (e) {
    console.error(`[STORAGE ERROR] Failed writing appointments.json: ${e.message}`);
  }
}

let fileState = loadFileQueue();
let fileAppointments = loadFileAppointments();

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
    return dbStatusInfo;
  }

  try {
    mongoClient = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });

    await mongoClient.connect();
    mongoDb = mongoClient.db(dbName);

    // Verify with ping
    await mongoDb.command({ ping: 1 });

    // Ensure collections and unique indexes
    const tokensCol = mongoDb.collection('tokens');
    const appointmentsCol = mongoDb.collection('appointments');
    const metadataCol = mongoDb.collection('metadata');

    await tokensCol.createIndex({ id: 1 }, { unique: true });
    await tokensCol.createIndex({ status: 1 });
    await tokensCol.createIndex({ createdAt: 1 });
    await appointmentsCol.createIndex({ id: 1 }, { unique: true });

    // Check if initial seed is needed (never overwrite existing user data!)
    const existingTokensCount = await tokensCol.countDocuments();
    if (existingTokensCount === 0) {
      console.log('[MONGODB] Initializing fresh database with seed state...');
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
    } else {
      console.log(`[MONGODB] Found ${existingTokensCount} existing token records in MongoDB Atlas. Preserving existing data.`);
    }

    isMongoConnected = true;
    dbStatusInfo = {
      mode: 'mongodb',
      connected: true,
      dbName,
      message: `Successfully connected to MongoDB Atlas database "${dbName}".`
    };
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
    return dbStatusInfo;
  }
}

function getDatabaseStatus() {
  return dbStatusInfo;
}

// ==========================================
// Queue State Retrieval
// ==========================================

async function getQueueState() {
  if (isMongoConnected && mongoDb) {
    const tokensCol = mongoDb.collection('tokens');
    const metadataCol = mongoDb.collection('metadata');

    const [currentServing, waitingTokens, completedTokens, meta] = await Promise.all([
      tokensCol.findOne({ status: 'SERVING' }),
      tokensCol.find({ status: 'WAITING' }).sort({ createdAt: 1 }).toArray(),
      tokensCol.find({ status: 'COMPLETED' }).sort({ completedAt: -1, createdAt: -1 }).limit(10).toArray(),
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

  // File fallback
  return fileState;
}

async function getStats() {
  const state = await getQueueState();
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

// Anti-abuse: Check if citizen has active token for service
async function hasActiveTokenForService(mobile, service) {
  if (!mobile) return false;
  const cleanMobile = String(mobile).replace(/\D/g, '');
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
    const tMobile = String(t.mobile || '').replace(/\D/g, '');
    return tMobile === cleanMobile && t.service === service && (t.status === 'WAITING' || t.status === 'CALLED');
  });

  const inServing = fileState.currentServing &&
    String(fileState.currentServing.mobile || '').replace(/\D/g, '') === cleanMobile &&
    fileState.currentServing.service === service &&
    fileState.currentServing.status === 'SERVING';

  return inWaiting || inServing;
}

// ==========================================
// Token Creation & Queue Mutations
// ==========================================

async function addToken({
  service = 'Income Certificate',
  office = 'Rajkot District Service Center',
  mobile = '',
  customerName = 'Citizen',
  type = 'ONLINE'
}) {
  const isWalkin = type.toUpperCase() === 'WALK-IN';

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
      mobile: String(mobile || ''),
      status: 'WAITING',
      createdAt: new Date().toISOString()
    };

    await tokensCol.insertOne(newToken);
    const updatedState = await getQueueState();
    return { token: newToken, state: updatedState };
  }

  // File fallback
  const tokenId = `A-${fileState.nextTokenNum}`;
  fileState.nextTokenNum += 1;
  if (isWalkin) fileState.walkinCount += 1;

  const newToken = {
    id: tokenId,
    type: isWalkin ? 'WALK-IN' : 'ONLINE',
    service,
    office,
    customerName: customerName || (isWalkin ? 'Walk-in Citizen' : 'Citizen'),
    mobile: String(mobile || ''),
    status: 'WAITING',
    createdAt: new Date().toISOString()
  };

  fileState.tokens.push(newToken);
  saveFileQueue(fileState);
  return { token: newToken, state: fileState };
}

async function callNext(counter = 'Counter 2', targetTokenId = null) {
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
          calledAt: now
        }
      }
    );

    targetToken.status = 'SERVING';
    targetToken.counter = counter || 'Counter 2';
    targetToken.calledAt = now;

    const state = await getQueueState();
    return { calledToken: targetToken, state };
  }

  // File fallback
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

  fileState.currentServing = calledToken;
  saveFileQueue(fileState);
  return { calledToken, state: fileState };
}

async function completeCurrent() {
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

    const state = await getQueueState();
    return { completedToken: currentServing, state };
  }

  // File fallback
  if (!fileState.currentServing || fileState.currentServing.status !== 'SERVING') {
    throw new Error('No customer currently being served.');
  }

  const completed = { ...fileState.currentServing, status: 'COMPLETED', completedAt: new Date().toISOString() };
  fileState.completedTokens.unshift(completed);
  fileState.completedCount += 1;
  fileState.currentServing = null;
  saveFileQueue(fileState);
  return { completedToken: completed, state: fileState };
}

async function markNoShow(tokenId) {
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
    const state = await getQueueState();
    return { token, state };
  }

  // File fallback
  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const finished = { ...fileState.currentServing, status: 'NO_SHOW' };
    fileState.currentServing = null;
    saveFileQueue(fileState);
    return { token: finished, state: fileState };
  }

  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'NO_SHOW';
    saveFileQueue(fileState);
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found.`);
}

async function cancelToken(tokenId) {
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
    const state = await getQueueState();
    return { token, state };
  }

  // File fallback
  const idx = fileState.tokens.findIndex(t => t.id === tokenId);
  if (idx !== -1) {
    const [t] = fileState.tokens.splice(idx, 1);
    t.status = 'CANCELLED';
    saveFileQueue(fileState);
    return { token: t, state: fileState };
  }

  if (fileState.currentServing && fileState.currentServing.id === tokenId) {
    const t = fileState.currentServing;
    t.status = 'CANCELLED';
    fileState.currentServing = null;
    saveFileQueue(fileState);
    return { token: t, state: fileState };
  }
  throw new Error(`Token ${tokenId} not found in waiting queue.`);
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
  const appointment = {
    id: aptId,
    office,
    service,
    date,
    slot,
    name: name || 'Citizen',
    mobile: String(mobile || ''),
    status: 'CONFIRMED',
    createdAt: new Date().toISOString()
  };

  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    await appointmentsCol.insertOne(appointment);
    return appointment;
  }

  // File fallback
  fileAppointments.unshift(appointment);
  saveFileAppointments(fileAppointments);
  return appointment;
}

async function getAppointments() {
  if (isMongoConnected && mongoDb) {
    const appointmentsCol = mongoDb.collection('appointments');
    return await appointmentsCol.find().sort({ createdAt: -1 }).toArray();
  }
  return fileAppointments;
}

// Reset Queue
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
  saveFileQueue(fileState);
  return fileState;
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
  createAppointment,
  getAppointments,
  resetQueue,
  closeDatabase,
  DEFAULT_STATE
};
