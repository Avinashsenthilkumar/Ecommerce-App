const jwt = require('jsonwebtoken');
const { db } = require('./db');
const config = require('./config');

const COOKIE = 'session';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function issueSession(res, user) {
  const token = jwt.sign({ uid: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

// Attaches req.user when a valid session cookie is present (never blocks).
function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    try {
      const { uid } = jwt.verify(token, config.jwtSecret);
      const user = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id = ?').get(uid);
      if (user) req.user = user;
    } catch { /* expired or tampered: treat as guest */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access only.' });
  next();
}

module.exports = { issueSession, clearSession, attachUser, requireAuth, requireAdmin };
