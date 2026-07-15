/**
 * Auth routes: register (patient), login, and current-user lookup.
 *
 * Authentication model (JWT + bcrypt) — see README "How authentication works".
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
}

/**
 * POST /api/auth/register
 * Public patient self-registration.
 */
router.post(
  '/register',
  wrap(async (req, res) => {
    const {
      full_name, email, password, date_of_birth, phone, gender, address, insurance_provider,
    } = req.body || {};

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: 'Full name, email, and password are required.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = await db.one('SELECT id FROM users WHERE email = $1', [
      email.toLowerCase(),
    ]);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = bcrypt.hashSync(String(password), 10);

    let userId;
    try {
      userId = await db.tx(async (c) => {
        const u = await c.query(
          `INSERT INTO users (email, password_hash, role, full_name)
           VALUES ($1, $2, 'patient', $3) RETURNING id`,
          [email.toLowerCase(), passwordHash, full_name.trim()]
        );
        await c.query(
          `INSERT INTO patients (user_id, date_of_birth, phone, gender, address, insurance_provider)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            u.rows[0].id,
            date_of_birth || null,
            phone || null,
            gender || null,
            address || null,
            insurance_provider || null,
          ]
        );
        return u.rows[0].id;
      });
    } catch (err) {
      // Unique violation (email race between the check above and the insert).
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw err;
    }

    const user = await db.one('SELECT * FROM users WHERE id = $1', [userId]);
    const token = signToken(user);
    return res.status(201).json({ token, user: publicUser(user) });
  })
);

/**
 * POST /api/auth/login
 */
router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await db.one('SELECT * FROM users WHERE email = $1', [
      String(email).toLowerCase(),
    ]);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = signToken(user);
    return res.json({ token, user: publicUser(user) });
  })
);

/**
 * GET /api/auth/me — return the current user (and patient profile if any).
 */
router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const result = publicUser(user);
    if (user.role === 'patient') {
      result.patient = await db.one('SELECT * FROM patients WHERE user_id = $1', [user.id]);
    }
    return res.json({ user: result });
  })
);

module.exports = router;
