/**
 * Auth routes: register (patient), login, and current-user lookup.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/auth/register
 * Public patient self-registration.
 */
router.post('/register', (req, res) => {
  const { full_name, email, password, date_of_birth, phone, gender, address, insurance_provider } =
    req.body || {};

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(String(password), 10);

  const createPatient = db.transaction(() => {
    const uInfo = db
      .prepare(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES (?, ?, 'patient', ?)`
      )
      .run(email.toLowerCase(), passwordHash, full_name.trim());
    db.prepare(
      `INSERT INTO patients (user_id, date_of_birth, phone, gender, address, insurance_provider)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      uInfo.lastInsertRowid,
      date_of_birth || null,
      phone || null,
      gender || null,
      address || null,
      insurance_provider || null
    );
    return uInfo.lastInsertRowid;
  });

  const userId = createPatient();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const token = signToken(user);
  return res.status(201).json({ token, user: publicUser(user) });
});

/**
 * POST /api/auth/login
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = signToken(user);
  return res.json({ token, user: publicUser(user) });
});

/**
 * GET /api/auth/me — return the current user (and patient profile if any).
 */
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const result = publicUser(user);
  if (user.role === 'patient') {
    result.patient = db.prepare('SELECT * FROM patients WHERE user_id = ?').get(user.id);
  }
  return res.json({ user: result });
});

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
}

module.exports = router;
