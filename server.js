const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10 * 1024 * 1024
});

const JWT_SECRET = process.env.JWT_SECRET || 'echolink-secret-key-2024';
const PORT = process.env.PORT || 3000;
const isServerlessRuntime = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const runtimeWritableBase = isServerlessRuntime ? (process.env.TMPDIR || os.tmpdir()) : process.cwd();
const resolvedDbDir = process.env.DB_DIR || path.join(runtimeWritableBase, 'db');
const resolvedUploadsDir = process.env.UPLOADS_DIR || path.join(runtimeWritableBase, 'uploads');
const resolvedPublicDir = process.env.PUBLIC_DIR || path.join(__dirname, 'public');
const DB_PATH = process.env.DB_PATH || path.join(resolvedDbDir, 'echolink.db');

// #region agent log
function debugLog(runId, hypothesisId, location, message, data = {}) {
  if (typeof fetch !== 'function') return;
  fetch('http://127.0.0.1:7641/ingest/6335803e-2b2e-47cc-9cf2-ec6bc8bd9ef5', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ac1dc5' },
    body: JSON.stringify({ sessionId: 'ac1dc5', runId, hypothesisId, location, message, data, timestamp: Date.now() })
  }).catch(() => {});
}
// #endregion

// Ensure directories
try {
  [resolvedDbDir, resolvedUploadsDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
} catch (err) {
  // #region agent log
  debugLog('post-fix', 'H2', 'server.js:35', 'Directory ensure failed', {
    dbDir: resolvedDbDir,
    uploadsDir: resolvedUploadsDir,
    cwd: process.cwd(),
    error: err.message
  });
  // #endregion
  throw err;
}
// #region agent log
debugLog('initial', 'H2', 'server.js:36', 'Startup paths resolved', {
  cwd: process.cwd(),
  nodeEnv: process.env.NODE_ENV || 'unset',
  dbPath: DB_PATH,
  dbDir: resolvedDbDir,
  uploadsDir: resolvedUploadsDir,
  publicDir: resolvedPublicDir,
  serverlessRuntime: isServerlessRuntime
});
// #endregion

// Database setup
const dbRaw = new sqlite3.Database(DB_PATH, (err) => {
  // #region agent log
  debugLog('initial', err ? 'H1' : 'H5', 'server.js:44', 'SQLite open result', {
    ok: !err,
    error: err ? err.message : null
  });
  // #endregion
});
const db = {
  run: (sql, params = []) => new Promise((res, rej) => dbRaw.run(sql, params, function(err) {
    if (err) {
      // #region agent log
      debugLog('initial', 'H1', 'server.js:56', 'DB run failed', { sqlStart: String(sql).trim().slice(0, 120), error: err.message });
      // #endregion
      rej(err);
    } else res(this);
  })),
  get: (sql, params = []) => new Promise((res, rej) => dbRaw.get(sql, params, (err, row) => {
    if (err) {
      // #region agent log
      debugLog('initial', 'H1', 'server.js:65', 'DB get failed', { sqlStart: String(sql).trim().slice(0, 120), error: err.message });
      // #endregion
      rej(err);
    } else res(row);
  })),
  all: (sql, params = []) => new Promise((res, rej) => dbRaw.all(sql, params, (err, rows) => {
    if (err) {
      // #region agent log
      debugLog('initial', 'H1', 'server.js:74', 'DB all failed', { sqlStart: String(sql).trim().slice(0, 120), error: err.message });
      // #endregion
      rej(err);
    } else res(rows);
  })),
  exec: (sql) => new Promise((res, rej) => dbRaw.exec(sql, err => {
    if (err) {
      // #region agent log
      debugLog('initial', 'H3', 'server.js:83', 'DB exec failed during init', { sqlStart: String(sql).trim().slice(0, 120), error: err.message });
      // #endregion
      rej(err);
    } else res();
  })),
};

// Initialization
(async () => {
  try {
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA foreign_keys = ON');

  // Schema
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_type TEXT DEFAULT 'initial',
      avatar_value TEXT,
      status TEXT DEFAULT 'offline',
      custom_status TEXT DEFAULT '',
      privacy_settings TEXT DEFAULT '{"requests":"everyone"}',
      last_seen INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      contact_id TEXT NOT NULL,
      nickname TEXT,
      group_name TEXT DEFAULT 'Friends',
      is_favorite INTEGER DEFAULT 0,
      is_blocked INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (contact_id) REFERENCES users(id),
      UNIQUE(user_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS connection_requests (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      message TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at INTEGER DEFAULT (unixepoch()),
      responded_at INTEGER,
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS direct_messages (
      id TEXT PRIMARY KEY,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      message TEXT,
      message_type TEXT DEFAULT 'text',
      file_url TEXT,
      file_size INTEGER,
      file_name TEXT,
      is_read INTEGER DEFAULT 0,
      is_delivered INTEGER DEFAULT 0,
      reply_to_id TEXT,
      reactions TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (from_user_id) REFERENCES users(id),
      FOREIGN KEY (to_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      joined_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS group_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      from_user_id TEXT NOT NULL,
      message TEXT,
      message_type TEXT DEFAULT 'text',
      file_url TEXT,
      file_size INTEGER,
      file_name TEXT,
      reactions TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (group_id) REFERENCES groups(id),
      FOREIGN KEY (from_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      companion_type TEXT DEFAULT 'desktop',
      capabilities_json TEXT DEFAULT '{}',
      is_online INTEGER DEFAULT 0,
      last_seen_at INTEGER DEFAULT (unixepoch()),
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS support_sessions (
      id TEXT PRIMARY KEY,
      requester_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      target_device_id TEXT,
      session_type TEXT DEFAULT 'desktop_support',
      status TEXT DEFAULT 'waiting_for_local_approval',
      metadata_json TEXT DEFAULT '{}',
      requested_at INTEGER DEFAULT (unixepoch()),
      approved_at INTEGER,
      started_at INTEGER,
      ended_at INTEGER,
      denied_at INTEGER,
      revoked_at INTEGER,
      ended_by_user_id TEXT,
      last_heartbeat_at INTEGER,
      FOREIGN KEY (requester_user_id) REFERENCES users(id),
      FOREIGN KEY (target_user_id) REFERENCES users(id),
      FOREIGN KEY (target_device_id) REFERENCES devices(id),
      FOREIGN KEY (ended_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS support_session_events (
      id TEXT PRIMARY KEY,
      support_session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at INTEGER DEFAULT (unixepoch()),
      FOREIGN KEY (support_session_id) REFERENCES support_sessions(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );
  `);
    // #region agent log
    debugLog('initial', 'H3', 'server.js:238', 'Database initialization completed', { ok: true });
    // #endregion
  } catch (err) {
    // #region agent log
    debugLog('initial', 'H3', 'server.js:242', 'Database initialization failed', { error: err.message });
    // #endregion
  }
})();

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, resolvedUploadsDir),
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(resolvedPublicDir));
app.use('/uploads', express.static(resolvedUploadsDir));
app.get('/', (req, res) => {
  const indexPath = path.join(resolvedPublicDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  // #region agent log
  debugLog('initial', 'H6', 'server.js:278', 'Root index file missing', {
    indexPath,
    publicDirExists: fs.existsSync(resolvedPublicDir)
  });
  // #endregion
  return res.status(404).send('Frontend bundle missing on host');
});
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      // #region agent log
      debugLog('initial', 'H4', 'server.js:258', 'HTTP 5xx response observed', {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode
      });
      // #endregion
    }
  });
  next();
});

// Auth middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: 'Invalid token' }); }
};

// Socket auth middleware
const socketAuth = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    // #region agent log
    debugLog('initial', 'H12', 'server.js:323', 'Socket auth failed', {
      hasToken: Boolean(token),
      transport: socket.conn?.transport?.name || 'unknown'
    });
    // #endregion
    next(new Error('Invalid token'));
  }
};

// Connected users map: userId -> socketId
const onlineUsers = new Map();
const ACTIVE_SUPPORT_SESSION_STATUSES = ['waiting_for_local_approval', 'approved', 'connecting', 'active', 'paused'];

function emitToUser(userId, event, payload) {
  const socketId = onlineUsers.get(userId);
  if (socketId) io.to(socketId).emit(event, payload);
}

async function logSupportSessionEvent(sessionId, eventType, actorUserId = null, metadata = {}) {
  await db.run(
    'INSERT INTO support_session_events (id, support_session_id, event_type, actor_user_id, metadata_json) VALUES (?, ?, ?, ?, ?)',
    [uuidv4(), sessionId, eventType, actorUserId, JSON.stringify(metadata || {})]
  );
}

async function getSupportSessionById(sessionId) {
  return db.get(`
    SELECT
      ss.*,
      ru.display_name AS requester_display_name,
      ru.username AS requester_username,
      tu.display_name AS target_display_name,
      tu.username AS target_username,
      d.device_name AS target_device_name,
      d.platform AS target_device_platform
    FROM support_sessions ss
    JOIN users ru ON ru.id = ss.requester_user_id
    JOIN users tu ON tu.id = ss.target_user_id
    LEFT JOIN devices d ON d.id = ss.target_device_id
    WHERE ss.id = ?
  `, [sessionId]);
}

async function getSupportSessionForUser(sessionId, userId) {
  const session = await getSupportSessionById(sessionId);
  if (!session) return null;
  if (session.requester_user_id !== userId && session.target_user_id !== userId) return null;
  return session;
}

function mapSupportSessionForUser(session, userId) {
  if (!session) return null;
  const isRequester = session.requester_user_id === userId;
  return {
    ...session,
    is_requester: isRequester,
    peer_user_id: isRequester ? session.target_user_id : session.requester_user_id,
    peer_display_name: isRequester ? session.target_display_name : session.requester_display_name,
    peer_username: isRequester ? session.target_username : session.requester_username,
  };
}

// ========================
// AUTH ROUTES
// ========================
app.post('/api/auth/register', async (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: 'All fields required' });
  if (username.length < 3) return res.status(400).json({ error: 'Username too short' });
  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'Username taken' });
    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const avatarValue = display_name.charAt(0).toUpperCase();
    await db.run('INSERT INTO users (id, username, password_hash, display_name, avatar_value) VALUES (?, ?, ?, ?, ?)', 
      [id, username.toLowerCase(), hash, display_name, avatarValue]);
    const createdUser = await db.get('SELECT id, username, status, custom_status FROM users WHERE id = ?', [id]);
    // #region agent log
    debugLog('initial', 'H9', 'server.js:401', 'Register persisted user status', {
      userId: id,
      username: createdUser?.username || username.toLowerCase(),
      status: createdUser?.status || null
    });
    // #endregion
    const token = jwt.sign({ id, username: username.toLowerCase() }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username: username.toLowerCase(), display_name, avatar_type: 'initial', avatar_value: avatarValue, status: 'offline', custom_status: '' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username?.toLowerCase()]);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
    // #region agent log
    debugLog('initial', 'H10', 'server.js:421', 'Login returning user presence snapshot', {
      userId: user.id,
      username: user.username,
      status: user.status,
      customStatus: user.custom_status || ''
    });
    // #endregion
    res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, avatar_type: user.avatar_type, avatar_value: user.avatar_value, status: user.status, custom_status: user.custom_status } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// USER ROUTES
// ========================
app.get('/api/users/search', authMiddleware, async (req, res) => {
  const q = req.query.q?.toLowerCase();
  if (!q || q.length < 2) return res.json([]);
  try {
    const users = await db.all(`SELECT id, username, display_name, avatar_type, avatar_value, status, custom_status FROM users WHERE username LIKE ? AND id != ? LIMIT 10`, [`%${q}%`, req.user.id]);
    const results = [];
    for (const u of users) {
      const contact = await db.get('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?', [req.user.id, u.id]);
      const request = await db.get('SELECT * FROM connection_requests WHERE ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)) AND status = "pending"', [req.user.id, u.id, u.id, req.user.id]);
      results.push({ ...u, relationship: contact ? (contact.is_blocked ? 'blocked' : 'contact') : request ? (request.from_user_id === req.user.id ? 'request_sent' : 'request_received') : 'none', request_id: request?.id });
    }
    // #region agent log
    debugLog('initial', 'H11', 'server.js:447', 'User search result summary', {
      requesterUserId: req.user.id,
      query: q,
      resultCount: results.length,
      statuses: results.map(r => ({ userId: r.id, status: r.status, relationship: r.relationship }))
    });
    // #endregion
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/suggested', authMiddleware, async (req, res) => {
  try {
    const users = await db.all(`SELECT id, username, display_name, avatar_type, avatar_value, status FROM users WHERE id != ? AND status != 'offline' ORDER BY last_seen DESC LIMIT 10`, [req.user.id]);
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/profile', authMiddleware, async (req, res) => {
  const { display_name, avatar_value, custom_status, status } = req.body;
  try {
    await db.run('UPDATE users SET display_name = COALESCE(?, display_name), avatar_value = COALESCE(?, avatar_value), custom_status = COALESCE(?, custom_status), status = COALESCE(?, status) WHERE id = ?',
      [display_name, avatar_value, custom_status, status, req.user.id]);
    const user = await db.get('SELECT id, username, display_name, avatar_type, avatar_value, status, custom_status FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// CONTACT ROUTES
// ========================
app.post('/api/contacts/request', authMiddleware, async (req, res) => {
  const { to_user_id, message } = req.body;
  try {
    const target = await db.get('SELECT privacy_settings FROM users WHERE id = ?', [to_user_id]);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const privacy = JSON.parse(target.privacy_settings || '{}');
    if (privacy.requests === 'no_one') return res.status(403).json({ error: 'User not accepting requests' });
    const existing = await db.get('SELECT * FROM connection_requests WHERE from_user_id = ? AND to_user_id = ? AND status = "pending"', [req.user.id, to_user_id]);
    if (existing) return res.status(409).json({ error: 'Request already sent' });
    const contact = await db.get('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ?', [req.user.id, to_user_id]);
    if (contact) return res.status(409).json({ error: 'Already contacts' });
    const id = uuidv4();
    await db.run('INSERT INTO connection_requests (id, from_user_id, to_user_id, message) VALUES (?, ?, ?, ?)', [id, req.user.id, to_user_id, message || '']);
    const targetSocket = onlineUsers.get(to_user_id);
    if (targetSocket) {
      const fromUser = await db.get('SELECT id, username, display_name, avatar_type, avatar_value FROM users WHERE id = ?', [req.user.id]);
      io.to(targetSocket).emit('connection-request', { id, from_user: fromUser, message });
    }
    res.json({ success: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/accept/:requestId', authMiddleware, async (req, res) => {
  try {
    const request = await db.get('SELECT * FROM connection_requests WHERE id = ? AND to_user_id = ? AND status = "pending"', [req.params.requestId, req.user.id]);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    await db.run('UPDATE connection_requests SET status = "accepted", responded_at = (strftime(\'%s\',\'now\')) WHERE id = ?', [request.id]);
    await db.run('INSERT OR IGNORE INTO contacts (id, user_id, contact_id) VALUES (?, ?, ?)', [uuidv4(), req.user.id, request.from_user_id]);
    await db.run('INSERT OR IGNORE INTO contacts (id, user_id, contact_id) VALUES (?, ?, ?)', [uuidv4(), request.from_user_id, req.user.id]);
    const senderSocket = onlineUsers.get(request.from_user_id);
    if (senderSocket) {
      const accepter = await db.get('SELECT id, username, display_name, avatar_type, avatar_value, status FROM users WHERE id = ?', [req.user.id]);
      io.to(senderSocket).emit('request-response', { type: 'accepted', user: accepter });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/reject/:requestId', authMiddleware, async (req, res) => {
  try {
    const request = await db.get('SELECT * FROM connection_requests WHERE id = ? AND to_user_id = ? AND status = "pending"', [req.params.requestId, req.user.id]);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    await db.run('UPDATE connection_requests SET status = "rejected", responded_at = (strftime(\'%s\',\'now\')) WHERE id = ?', [request.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/contacts/block/:userId', authMiddleware, async (req, res) => {
  try {
    await db.run('UPDATE contacts SET is_blocked = 1 WHERE user_id = ? AND contact_id = ?', [req.user.id, req.params.userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/contacts/:contactId', authMiddleware, async (req, res) => {
  try {
    await db.run('DELETE FROM contacts WHERE (user_id = ? AND contact_id = ?) OR (user_id = ? AND contact_id = ?)', [req.user.id, req.params.contactId, req.params.contactId, req.user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts/list', authMiddleware, async (req, res) => {
  try {
    const contacts = await db.all(`
      SELECT c.*, u.username, u.display_name, u.avatar_type, u.avatar_value, u.status, u.custom_status, u.last_seen
        , (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.companion_type = 'desktop') AS desktop_device_count
        , (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.companion_type = 'desktop' AND d.is_online = 1) AS desktop_device_online_count
      FROM contacts c JOIN users u ON c.contact_id = u.id
      WHERE c.user_id = ? AND c.is_blocked = 0
      ORDER BY c.is_favorite DESC, u.display_name ASC
    `, [req.user.id]);
    res.json(contacts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/contacts/requests/pending', authMiddleware, async (req, res) => {
  try {
    const requests = await db.all(`
      SELECT cr.*, u.username, u.display_name, u.avatar_type, u.avatar_value
      FROM connection_requests cr JOIN users u ON cr.from_user_id = u.id
      WHERE cr.to_user_id = ? AND cr.status = 'pending'
      ORDER BY cr.created_at DESC
    `, [req.user.id]);
    res.json(requests);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/contacts/:contactId', authMiddleware, async (req, res) => {
  const { nickname, group_name, is_favorite } = req.body;
  try {
    await db.run('UPDATE contacts SET nickname = COALESCE(?, nickname), group_name = COALESCE(?, group_name), is_favorite = COALESCE(?, is_favorite) WHERE user_id = ? AND contact_id = ?',
      [nickname, group_name, is_favorite, req.user.id, req.params.contactId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// DESKTOP SUPPORT ROUTES
// ========================
app.get('/api/devices', authMiddleware, async (req, res) => {
  try {
    const devices = await db.all(`
      SELECT id, device_name, platform, companion_type, capabilities_json, is_online, last_seen_at, created_at, updated_at
      FROM devices
      WHERE user_id = ?
      ORDER BY is_online DESC, last_seen_at DESC, created_at DESC
    `, [req.user.id]);
    res.json(devices.map(device => ({
      ...device,
      capabilities: JSON.parse(device.capabilities_json || '{}')
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/register', authMiddleware, async (req, res) => {
  const {
    device_id,
    device_name,
    platform,
    companion_type = 'desktop',
    capabilities = {}
  } = req.body;

  if (!device_name || !platform) return res.status(400).json({ error: 'device_name and platform are required' });

  try {
    const id = device_id || uuidv4();
    const existing = await db.get('SELECT id FROM devices WHERE id = ? AND user_id = ?', [id, req.user.id]);

    if (existing) {
      await db.run(`
        UPDATE devices
        SET device_name = ?, platform = ?, companion_type = ?, capabilities_json = ?, is_online = 1,
            last_seen_at = (strftime('%s','now')), updated_at = (strftime('%s','now'))
        WHERE id = ? AND user_id = ?
      `, [device_name, platform, companion_type, JSON.stringify(capabilities || {}), id, req.user.id]);
    } else {
      await db.run(`
        INSERT INTO devices (id, user_id, device_name, platform, companion_type, capabilities_json, is_online, last_seen_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, (strftime('%s','now')), (strftime('%s','now')))
      `, [id, req.user.id, device_name, platform, companion_type, JSON.stringify(capabilities || {})]);
    }

    const device = await db.get(`
      SELECT id, device_name, platform, companion_type, capabilities_json, is_online, last_seen_at, created_at, updated_at
      FROM devices WHERE id = ? AND user_id = ?
    `, [id, req.user.id]);
    const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [req.user.id]);
    contacts.forEach(contact => emitToUser(contact.contact_id, 'desktop-device-status', { userId: req.user.id }));

    res.json({
      ...device,
      capabilities: JSON.parse(device.capabilities_json || '{}')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:id/heartbeat', authMiddleware, async (req, res) => {
  try {
    const existing = await db.get('SELECT id, capabilities_json FROM devices WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Device not found' });

    await db.run(`
      UPDATE devices
      SET is_online = 1, last_seen_at = (strftime('%s','now')), updated_at = (strftime('%s','now'))
      WHERE id = ? AND user_id = ?
    `, [req.params.id, req.user.id]);

    const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [req.user.id]);
    contacts.forEach(contact => emitToUser(contact.contact_id, 'desktop-device-status', { userId: req.user.id }));

    const device = await db.get(`
      SELECT id, device_name, platform, companion_type, capabilities_json, is_online, last_seen_at, created_at, updated_at
      FROM devices WHERE id = ? AND user_id = ?
    `, [req.params.id, req.user.id]);

    res.json({
      ...device,
      capabilities: JSON.parse(device.capabilities_json || '{}')
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/devices/:id/offline', authMiddleware, async (req, res) => {
  try {
    const existing = await db.get('SELECT id FROM devices WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!existing) return res.status(404).json({ error: 'Device not found' });

    await db.run(`
      UPDATE devices
      SET is_online = 0, last_seen_at = (strftime('%s','now')), updated_at = (strftime('%s','now'))
      WHERE id = ? AND user_id = ?
    `, [req.params.id, req.user.id]);

    const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [req.user.id]);
    contacts.forEach(contact => emitToUser(contact.contact_id, 'desktop-device-status', { userId: req.user.id }));

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:userId/support-availability', authMiddleware, async (req, res) => {
  try {
    const relationship = await db.get('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ? AND is_blocked = 0', [req.user.id, req.params.userId]);
    if (!relationship) return res.status(403).json({ error: 'You can only view desktop support availability for contacts' });

    const devices = await db.all(`
      SELECT id, device_name, platform, companion_type, is_online, last_seen_at
      FROM devices
      WHERE user_id = ? AND companion_type = 'desktop'
      ORDER BY is_online DESC, last_seen_at DESC, created_at DESC
    `, [req.params.userId]);

    res.json({
      user_id: req.params.userId,
      online_device_count: devices.filter(device => device.is_online).length,
      total_device_count: devices.length,
      devices
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/support-sessions', authMiddleware, async (req, res) => {
  const contactId = req.query.contact_id;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

  try {
    let params = [req.user.id, req.user.id];
    let sql = `
      SELECT
        ss.*,
        ru.display_name AS requester_display_name,
        ru.username AS requester_username,
        tu.display_name AS target_display_name,
        tu.username AS target_username,
        d.device_name AS target_device_name,
        d.platform AS target_device_platform
      FROM support_sessions ss
      JOIN users ru ON ru.id = ss.requester_user_id
      JOIN users tu ON tu.id = ss.target_user_id
      LEFT JOIN devices d ON d.id = ss.target_device_id
      WHERE (ss.requester_user_id = ? OR ss.target_user_id = ?)
    `;

    if (contactId) {
      sql += ' AND ((ss.requester_user_id = ? AND ss.target_user_id = ?) OR (ss.requester_user_id = ? AND ss.target_user_id = ?))';
      params.push(req.user.id, contactId, contactId, req.user.id);
    }

    sql += ' ORDER BY ss.requested_at DESC LIMIT ?';
    params.push(limit);

    const sessions = await db.all(sql, params);
    res.json(sessions.map(session => mapSupportSessionForUser(session, req.user.id)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/support-sessions/:id', authMiddleware, async (req, res) => {
  try {
    const session = await getSupportSessionForUser(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Support session not found' });
    res.json(mapSupportSessionForUser(session, req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/support-sessions', authMiddleware, async (req, res) => {
  const { target_user_id, target_device_id = null, metadata = {} } = req.body;
  if (!target_user_id) return res.status(400).json({ error: 'target_user_id is required' });
  if (target_user_id === req.user.id) return res.status(400).json({ error: 'You cannot request desktop support from yourself' });

  try {
    const contact = await db.get('SELECT id FROM contacts WHERE user_id = ? AND contact_id = ? AND is_blocked = 0', [req.user.id, target_user_id]);
    if (!contact) return res.status(403).json({ error: 'Desktop support can only be requested from contacts' });

    const existingActive = await db.get(`
      SELECT id FROM support_sessions
      WHERE requester_user_id = ? AND target_user_id = ? AND status IN (${ACTIVE_SUPPORT_SESSION_STATUSES.map(() => '?').join(', ')})
      ORDER BY requested_at DESC LIMIT 1
    `, [req.user.id, target_user_id, ...ACTIVE_SUPPORT_SESSION_STATUSES]);
    if (existingActive) return res.status(409).json({ error: 'An active desktop support request already exists for this contact' });

    let targetDevice = null;
    if (target_device_id) {
      targetDevice = await db.get('SELECT * FROM devices WHERE id = ? AND user_id = ? AND companion_type = "desktop"', [target_device_id, target_user_id]);
    } else {
      targetDevice = await db.get(`
        SELECT * FROM devices
        WHERE user_id = ? AND companion_type = 'desktop' AND is_online = 1
        ORDER BY last_seen_at DESC
        LIMIT 1
      `, [target_user_id]);
    }

    if (!targetDevice) return res.status(409).json({ error: 'Desktop Companion Required. The contact has no online desktop companion.' });

    const sessionId = uuidv4();
    await db.run(`
      INSERT INTO support_sessions (id, requester_user_id, target_user_id, target_device_id, status, metadata_json, last_heartbeat_at)
      VALUES (?, ?, ?, ?, 'waiting_for_local_approval', ?, (strftime('%s','now')))
    `, [sessionId, req.user.id, target_user_id, targetDevice.id, JSON.stringify(metadata || {})]);

    await logSupportSessionEvent(sessionId, 'requested', req.user.id, { target_device_id: targetDevice.id });

    const session = await getSupportSessionById(sessionId);
    const mapped = mapSupportSessionForUser(session, req.user.id);

    emitToUser(target_user_id, 'desktop-support-requested', mapSupportSessionForUser(session, target_user_id));
    emitToUser(req.user.id, 'desktop-support-updated', mapped);

    res.status(201).json(mapped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/support-sessions/:id/approve', authMiddleware, async (req, res) => {
  try {
    const session = await getSupportSessionForUser(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Support session not found' });
    if (session.target_user_id !== req.user.id) return res.status(403).json({ error: 'Only the supported user can approve this session' });
    if (session.status !== 'waiting_for_local_approval') return res.status(409).json({ error: 'This session is no longer awaiting approval' });

    await db.run(`
      UPDATE support_sessions
      SET status = 'approved', approved_at = (strftime('%s','now')), last_heartbeat_at = (strftime('%s','now'))
      WHERE id = ?
    `, [req.params.id]);
    await logSupportSessionEvent(req.params.id, 'approved', req.user.id);

    const updated = await getSupportSessionById(req.params.id);
    emitToUser(updated.requester_user_id, 'desktop-support-approved', mapSupportSessionForUser(updated, updated.requester_user_id));
    emitToUser(updated.target_user_id, 'desktop-support-updated', mapSupportSessionForUser(updated, updated.target_user_id));

    res.json(mapSupportSessionForUser(updated, req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/support-sessions/:id/deny', authMiddleware, async (req, res) => {
  try {
    const session = await getSupportSessionForUser(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Support session not found' });
    if (session.target_user_id !== req.user.id) return res.status(403).json({ error: 'Only the supported user can deny this session' });
    if (!ACTIVE_SUPPORT_SESSION_STATUSES.includes(session.status)) return res.status(409).json({ error: 'This session cannot be denied in its current state' });

    await db.run(`
      UPDATE support_sessions
      SET status = 'denied', denied_at = (strftime('%s','now')), ended_at = (strftime('%s','now')), ended_by_user_id = ?
      WHERE id = ?
    `, [req.user.id, req.params.id]);
    await logSupportSessionEvent(req.params.id, 'denied', req.user.id);

    const updated = await getSupportSessionById(req.params.id);
    emitToUser(updated.requester_user_id, 'desktop-support-denied', mapSupportSessionForUser(updated, updated.requester_user_id));
    emitToUser(updated.target_user_id, 'desktop-support-updated', mapSupportSessionForUser(updated, updated.target_user_id));

    res.json(mapSupportSessionForUser(updated, req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/support-sessions/:id/revoke', authMiddleware, async (req, res) => {
  try {
    const session = await getSupportSessionForUser(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Support session not found' });
    if (!ACTIVE_SUPPORT_SESSION_STATUSES.includes(session.status)) return res.status(409).json({ error: 'This session is not active or pending' });

    await db.run(`
      UPDATE support_sessions
      SET status = 'revoked', revoked_at = (strftime('%s','now')), ended_at = (strftime('%s','now')), ended_by_user_id = ?
      WHERE id = ?
    `, [req.user.id, req.params.id]);
    await logSupportSessionEvent(req.params.id, 'revoked', req.user.id);

    const updated = await getSupportSessionById(req.params.id);
    emitToUser(updated.requester_user_id, 'desktop-support-revoked', mapSupportSessionForUser(updated, updated.requester_user_id));
    emitToUser(updated.target_user_id, 'desktop-support-revoked', mapSupportSessionForUser(updated, updated.target_user_id));

    res.json(mapSupportSessionForUser(updated, req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/support-sessions/:id/heartbeat', authMiddleware, async (req, res) => {
  try {
    const session = await getSupportSessionForUser(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: 'Support session not found' });

    await db.run('UPDATE support_sessions SET last_heartbeat_at = (strftime(\'%s\',\'now\')) WHERE id = ?', [req.params.id]);
    await logSupportSessionEvent(req.params.id, 'heartbeat', req.user.id);

    const updated = await getSupportSessionById(req.params.id);
    res.json(mapSupportSessionForUser(updated, req.user.id));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// MESSAGES ROUTES
// ========================
app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  const { page = 0, limit = 40 } = req.query;
  try {
    const msgs = await db.all(`
      SELECT dm.*, u.display_name, u.avatar_value, u.avatar_type
      FROM direct_messages dm JOIN users u ON dm.from_user_id = u.id
      WHERE (dm.from_user_id = ? AND dm.to_user_id = ?) OR (dm.from_user_id = ? AND dm.to_user_id = ?)
      ORDER BY dm.created_at DESC LIMIT ? OFFSET ?
    `, [req.user.id, req.params.userId, req.params.userId, req.user.id, parseInt(limit), parseInt(page) * parseInt(limit)]);
    await db.run('UPDATE direct_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0', [req.params.userId, req.user.id]);
    res.json(msgs.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/unread/counts', authMiddleware, async (req, res) => {
  try {
    const counts = await db.all(`SELECT from_user_id, COUNT(*) as count FROM direct_messages WHERE to_user_id = ? AND is_read = 0 GROUP BY from_user_id`, [req.user.id]);
    res.json(counts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/messages/:messageId', authMiddleware, async (req, res) => {
  console.log('[DEBUG] DELETE /api/messages/' + req.params.messageId);
  try {
    const msg = await db.get('SELECT to_user_id FROM direct_messages WHERE id = ? AND from_user_id = ?', [req.params.messageId, req.user.id]);
    if (msg) {
      await db.run('DELETE FROM direct_messages WHERE id = ?', [req.params.messageId]);
      const targetSocket = onlineUsers.get(msg.to_user_id);
      if (targetSocket) io.to(targetSocket).emit('message-deleted', { messageId: req.params.messageId, chatId: req.user.id });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/groups/:groupId/messages/:messageId', authMiddleware, async (req, res) => {
  console.log('[DEBUG] DELETE /api/groups/' + req.params.groupId + '/messages/' + req.params.messageId);
  try {
    await db.run('DELETE FROM group_messages WHERE id = ? AND from_user_id = ? AND group_id = ?', [req.params.messageId, req.user.id, req.params.groupId]);
    io.to(`group:${req.params.groupId}`).emit('message-deleted', { messageId: req.params.messageId, groupId: req.params.groupId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// GROUP ROUTES
// ========================
app.post('/api/groups/create', authMiddleware, async (req, res) => {
  const { name, member_ids } = req.body;
  if (!name || !member_ids?.length) return res.status(400).json({ error: 'Name and members required' });
  try {
    const id = uuidv4();
    await db.run('INSERT INTO groups (id, name, avatar, created_by) VALUES (?, ?, ?, ?)', [id, name, name.charAt(0).toUpperCase(), req.user.id]);
    await db.run('INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)', [uuidv4(), id, req.user.id, 'admin']);
    for (const uid of member_ids) {
      await db.run('INSERT OR IGNORE INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)', [uuidv4(), id, uid]);
    }
    const group = await db.get('SELECT * FROM groups WHERE id = ?', [id]);
    res.json(group);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/groups', authMiddleware, async (req, res) => {
  try {
    const groups = await db.all(`SELECT g.* FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ?`, [req.user.id]);
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/groups/:groupId/messages', authMiddleware, async (req, res) => {
  const { page = 0, limit = 40 } = req.query;
  try {
    const msgs = await db.all(`
      SELECT gm.*, u.display_name, u.avatar_value, u.avatar_type
      FROM group_messages gm JOIN users u ON gm.from_user_id = u.id
      WHERE gm.group_id = ?
      ORDER BY gm.created_at DESC LIMIT ? OFFSET ?
    `, [req.params.groupId, parseInt(limit), parseInt(page) * parseInt(limit)]);
    res.json(msgs.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/groups/:groupId/members', authMiddleware, async (req, res) => {
  try {
    const members = await db.all(`
      SELECT gm.role, gm.joined_at, u.id, u.username, u.display_name, u.avatar_type, u.avatar_value, u.status
      FROM group_members gm JOIN users u ON gm.user_id = u.id
      WHERE gm.group_id = ?
    `, [req.params.groupId]);
    res.json(members);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/groups/:groupId/members/add', authMiddleware, async (req, res) => {
  const { user_id } = req.body;
  try {
    await db.run('INSERT OR IGNORE INTO group_members (id, group_id, user_id) VALUES (?, ?, ?)', [uuidv4(), req.params.groupId, user_id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========================
// FILE UPLOAD
// ========================
app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size, type: req.file.mimetype });
});

// ========================
// HEALTH
// ========================
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ========================
// SOCKET.IO
// ========================
io.use(socketAuth);

io.on('connection', async (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  // #region agent log
  debugLog('initial', 'H12', 'server.js:986', 'Socket connected for user', {
    userId,
    socketId: socket.id,
    transport: socket.conn?.transport?.name || 'unknown'
  });
  // #endregion

  try {
    // Update status to online
    await db.run('UPDATE users SET status = ?, last_seen = (strftime(\'%s\',\'now\')) WHERE id = ?', ['online', userId]);
    const userPresence = await db.get('SELECT id, status, last_seen FROM users WHERE id = ?', [userId]);
    // #region agent log
    debugLog('initial', 'H10', 'server.js:997', 'Presence set to online after socket connect', {
      userId,
      status: userPresence?.status || null,
      lastSeen: userPresence?.last_seen || null
    });
    // #endregion

    // Notify contacts of online status
    const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [userId]);
    contacts.forEach(c => {
      const socketId = onlineUsers.get(c.contact_id);
      if (socketId) io.to(socketId).emit('presence', { userId, status: 'online' });
    });

    // Join group rooms
    const groups = await db.all('SELECT group_id FROM group_members WHERE user_id = ?', [userId]);
    groups.forEach(g => socket.join(`group:${g.group_id}`));

    // Direct message
    socket.on('message', async (data) => {
      const { to, message, type = 'text', file_url, file_name, file_size, reply_to_id, tempId } = data;
      try {
        const contact = await db.get('SELECT * FROM contacts WHERE user_id = ? AND contact_id = ? AND is_blocked = 0', [userId, to]);
        if (!contact) return socket.emit('error', { msg: 'Not connected to this user' });
        const id = uuidv4();
        await db.run('INSERT INTO direct_messages (id, from_user_id, to_user_id, message, message_type, file_url, file_name, file_size, reply_to_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, userId, to, message, type, file_url, file_name, file_size, reply_to_id]);
        const sender = await db.get('SELECT display_name, avatar_type, avatar_value FROM users WHERE id = ?', [userId]);
        const msgObj = { id, from_user_id: userId, to_user_id: to, message, message_type: type, file_url, file_name, file_size, reply_to_id, created_at: Math.floor(Date.now()/1000), is_read: 0, is_delivered: 0, ...sender, tempId };
        socket.emit('message-sent', { ...msgObj });
        const toSocket = onlineUsers.get(to);
        if (toSocket) {
          io.to(toSocket).emit('message', msgObj);
          await db.run('UPDATE direct_messages SET is_delivered = 1 WHERE id = ?', [id]);
        }
      } catch (e) { socket.emit('error', { msg: e.message }); }
    });

    // Group message
    socket.on('group-message', async (data) => {
      const { groupId, message, type = 'text', file_url, file_name, file_size } = data;
      try {
        const member = await db.get('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        if (!member) return;
        const id = uuidv4();
        await db.run('INSERT INTO group_messages (id, group_id, from_user_id, message, message_type, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, groupId, userId, message, type, file_url, file_name, file_size]);
        const sender = await db.get('SELECT display_name, avatar_type, avatar_value FROM users WHERE id = ?', [userId]);
        const msgObj = { id, group_id: groupId, from_user_id: userId, message, message_type: type, file_url, file_name, file_size, created_at: Math.floor(Date.now()/1000), ...sender };
        io.to(`group:${groupId}`).emit('group-message', msgObj);
      } catch (e) { console.error(e); }
    });

    // Message reactions
    socket.on('reaction', async ({ messageId, reaction, to, groupId }) => {
      try {
        if (groupId) {
          const msg = await db.get('SELECT reactions FROM group_messages WHERE id = ?', [messageId]);
          if (msg) {
            const reactions = JSON.parse(msg.reactions || '{}');
            if (!reactions[reaction]) reactions[reaction] = [];
            const idx = reactions[reaction].indexOf(userId);
            if (idx > -1) reactions[reaction].splice(idx, 1); else reactions[reaction].push(userId);
            await db.run('UPDATE group_messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), messageId]);
            io.to(`group:${groupId}`).emit('reaction', { messageId, reactions, groupId });
          }
        } else {
          const msg = await db.get('SELECT reactions FROM direct_messages WHERE id = ?', [messageId]);
          if (msg) {
            const reactions = JSON.parse(msg.reactions || '{}');
            if (!reactions[reaction]) reactions[reaction] = [];
            const idx = reactions[reaction].indexOf(userId);
            if (idx > -1) reactions[reaction].splice(idx, 1); else reactions[reaction].push(userId);
            await db.run('UPDATE direct_messages SET reactions = ? WHERE id = ?', [JSON.stringify(reactions), messageId]);
            const toSocket = onlineUsers.get(to);
            if (toSocket) io.to(toSocket).emit('reaction', { messageId, reactions });
            socket.emit('reaction', { messageId, reactions });
          }
        }
      } catch (e) { console.error(e); }
    });

    // Seen receipt
    socket.on('seen', async ({ from }) => {
      try {
        await db.run('UPDATE direct_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ?', [from, userId]);
        const fromSocket = onlineUsers.get(from);
        if (fromSocket) io.to(fromSocket).emit('seen', { by: userId });
      } catch (e) { console.error(e); }
    });

    // Status update
    socket.on('status-update', async ({ status, custom_status }) => {
      try {
        await db.run('UPDATE users SET status = ?, custom_status = COALESCE(?, custom_status) WHERE id = ?', [status, custom_status, userId]);
        const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [userId]);
        contacts.forEach(c => {
          const sId = onlineUsers.get(c.contact_id);
          if (sId) io.to(sId).emit('presence', { userId, status, custom_status });
        });
      } catch (e) { console.error(e); }
    });

    // Disconnect
    socket.on('disconnect', async () => {
      onlineUsers.delete(userId);
      try {
        await db.run('UPDATE users SET status = "offline", last_seen = (strftime(\'%s\',\'now\')) WHERE id = ?', [userId]);
        const contacts = await db.all('SELECT contact_id FROM contacts WHERE user_id = ? AND is_blocked = 0', [userId]);
        contacts.forEach(c => {
          const sId = onlineUsers.get(c.contact_id);
          if (sId) io.to(sId).emit('presence', { userId, status: 'offline' });
        });
      } catch (e) { console.error(e); }
    });
    
    // Typing and WebRTC (no DB needed)
    socket.on('typing', ({ to, isTyping }) => {
      const toSocket = onlineUsers.get(to);
      if (toSocket) io.to(toSocket).emit('typing', { from: userId, isTyping });
    });
    socket.on('group-typing', ({ groupId, isTyping }) => {
      socket.to(`group:${groupId}`).emit('group-typing', { from: userId, groupId, isTyping });
    });
    socket.on('call-offer', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('call-offer', { ...data, from: userId });
    });
    socket.on('call-answer', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('call-answer', { ...data, from: userId });
    });
    socket.on('ice-candidate', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('ice-candidate', { ...data, from: userId });
    });
    socket.on('call-end', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('call-end', { from: userId });
    });
    socket.on('call-reject', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('call-reject', { from: userId });
    });
    socket.on('file-chunk', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('file-chunk', { ...data, from: userId });
    });

    // Remote Support Sockets
    socket.on('remote-support-request', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('remote-support-request', { from: userId });
    });
    socket.on('remote-support-granted', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('remote-support-granted', { from: userId });
    });
    socket.on('remote-support-denied', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('remote-support-denied', { from: userId });
    });
    socket.on('remote-support-ended', (data) => {
      const toSocket = onlineUsers.get(data.to);
      if (toSocket) io.to(toSocket).emit('remote-support-ended', { from: userId });
    });

  } catch (e) { console.error(e); }
});

server.listen(PORT, () => {
  // #region agent log
  debugLog('initial', 'H5', 'server.js:1085', 'Server listen started', { port: PORT });
  // #endregion
  console.log(`EchoLink running on http://localhost:${PORT}`);
});
