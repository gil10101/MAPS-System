/**
 * Auth routes: patient self-registration, login, and current-user lookup.
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
const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];

/**
 * The user object every endpoint hands back. Built by hand rather than by
 * spreading the row so password_hash cannot escape through a `SELECT *`, and
 * full_name is read from the generated column so the display form can never
 * disagree with first_name/last_name.
 */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: user.full_name,
    phone: user.phone,
    notify_email: user.notify_email,
    notify_sms: user.notify_sms,
  };
}

/** Optional text: missing or blank is stored as NULL, never as ''. */
function textOrNull(value) {
  return String(value ?? '').trim() || null;
}

/** Optional flag: absent means "leave it at the default", not "false". */
function flagOr(value, fallback) {
  return value === undefined || value === null ? fallback : Boolean(value);
}

/**
 * POST /api/auth/register
 * Public patient self-registration. Body:
 *   { first_name, last_name, email, password, phone?, date_of_birth?, gender?,
 *     address?, insurance_provider?, notify_email?, notify_sms? }
 *
 * The users row and its patients row are written in ONE transaction: an
 * account with no patient profile could log in but not book anything, and the
 * patient has no way to repair it — registration would have to be done again
 * under a different email because the first one is now taken.
 */
router.post(
  '/register',
  wrap(async (req, res) => {
    const {
      first_name, last_name, email, password, phone, date_of_birth, gender,
      address, insurance_provider, notify_email, notify_sms,
    } = req.body || {};

    const firstName = String(first_name ?? '').trim();
    const lastName = String(last_name ?? '').trim();

    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    if (!email || !EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    if (gender && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await db.one('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const passwordHash = bcrypt.hashSync(String(password), 10);

    let user;
    try {
      user = await db.tx(async (c) => {
        // full_name is a generated column — inserting it is an error.
        const inserted = await c.query(
          `INSERT INTO users
             (email, password_hash, role, first_name, last_name, phone,
              notify_email, notify_sms)
           VALUES ($1, $2, 'patient', $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            normalizedEmail,
            passwordHash,
            firstName,
            lastName,
            textOrNull(phone),
            // Mirrors the users table defaults: email reminders on, SMS off.
            flagOr(notify_email, true),
            flagOr(notify_sms, false),
          ]
        );
        const row = inserted.rows[0];
        await c.query(
          `INSERT INTO patients (user_id, date_of_birth, gender, address, insurance_provider)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            row.id,
            textOrNull(date_of_birth),
            textOrNull(gender),
            textOrNull(address),
            textOrNull(insurance_provider),
          ]
        );
        return row;
      });
    } catch (err) {
      // Unique violation: another request claimed the email between the check
      // above and this insert.
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw err;
    }

    return res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

/**
 * POST /api/auth/login
 * A wrong email and a wrong password give the same message so the endpoint
 * cannot be used to discover which addresses have accounts.
 */
router.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const user = await db.one('SELECT * FROM users WHERE email = $1', [
      String(email).trim().toLowerCase(),
    ]);
    if (!user || !bcrypt.compareSync(String(password), user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    return res.json({ token: signToken(user), user: publicUser(user) });
  })
);

/**
 * GET /api/auth/me — the current user, re-read from the database rather than
 * decoded from the token so a profile edit shows up without re-logging in.
 * Patient demographics live behind /api/patients/me.
 */
router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = await db.one('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user: publicUser(user) });
  })
);

module.exports = router;
