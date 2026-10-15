const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db } = require('../db');
const { issueSession, clearSession, requireAuth } = require('../auth');
const { str, isEmail, normPhone, validateAddress } = require('../validate');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' } });

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

router.post('/register', authLimiter, (req, res) => {
  const name = str(req.body.name, 80);
  const email = str(req.body.email, 120).toLowerCase();
  const phone = normPhone(req.body.phone);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const errors = {};
  if (name.length < 2) errors.name = 'Enter your name';
  if (!isEmail(email)) errors.email = 'Enter a valid email';
  if (!phone) errors.phone = 'Enter a valid 10-digit mobile number';
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    errors.password = 'Use at least 8 characters with letters and numbers';
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', errors });

  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    return res.status(409).json({ error: 'An account with this email already exists. Try logging in.', errors: { email: 'Already registered' } });

  const info = db.prepare('INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)')
    .run(name, email, phone, bcrypt.hashSync(password, 10));
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);

  // Link earlier guest orders placed with the same email
  db.prepare('UPDATE orders SET user_id = ? WHERE user_id IS NULL AND email = ?').run(user.id, email);

  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Incorrect email or password.' });
  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });

router.get('/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

router.patch('/me', requireAuth, (req, res) => {
  const name = str(req.body.name, 80);
  const phone = normPhone(req.body.phone);
  if (name.length < 2 || !phone) return res.status(400).json({ error: 'Enter a valid name and mobile number.' });
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.user.id);
  res.json({ user: publicUser({ ...req.user, name, phone }) });
});

router.post('/me/password', requireAuth, authLimiter, (req, res) => {
  const { current, next } = req.body || {};
  const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (typeof next !== 'string' || next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next))
    return res.status(400).json({ error: 'New password needs 8+ characters with letters and numbers.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(next, 10), req.user.id);
  res.json({ ok: true });
});

// Saved addresses
router.get('/addresses', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY id DESC').all(req.user.id));
});
router.post('/addresses', requireAuth, (req, res) => {
  const { addr, errors, ok } = validateAddress(req.body);
  if (!ok) return res.status(400).json({ error: 'Please fix the address.', errors });
  const info = db.prepare(`INSERT INTO addresses (user_id,name,phone,line1,line2,city,state,pincode) VALUES (?,?,?,?,?,?,?,?)`)
    .run(req.user.id, addr.name, addr.phone, addr.line1, addr.line2, addr.city, addr.state, addr.pincode);
  res.status(201).json(db.prepare('SELECT * FROM addresses WHERE id=?').get(info.lastInsertRowid));
});
router.delete('/addresses/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
