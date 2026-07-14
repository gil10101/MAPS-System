/**
 * Patient self-service profile routes.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/patients/me — full profile for the logged-in patient.
 */
router.get('/me', requireAuth, requireRole('patient'), (req, res) => {
  const row = db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.full_name,
              p.id AS patient_id, p.date_of_birth, p.phone, p.gender,
              p.address, p.insurance_provider
       FROM users u JOIN patients p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(req.user.id);
  if (!row) return res.status(404).json({ error: 'Profile not found.' });
  res.json({ profile: row });
});

/**
 * PUT /api/patients/me — update the logged-in patient's profile.
 */
router.put('/me', requireAuth, requireRole('patient'), (req, res) => {
  const { full_name, date_of_birth, phone, gender, address, insurance_provider } = req.body || {};

  if (full_name !== undefined && !String(full_name).trim()) {
    return res.status(400).json({ error: 'Full name cannot be empty.' });
  }
  const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
  if (gender && !validGenders.includes(gender)) {
    return res.status(400).json({ error: 'Invalid gender value.' });
  }

  const update = db.transaction(() => {
    if (full_name !== undefined) {
      db.prepare('UPDATE users SET full_name = ? WHERE id = ?').run(
        String(full_name).trim(),
        req.user.id
      );
    }
    db.prepare(
      `UPDATE patients
       SET date_of_birth = COALESCE(?, date_of_birth),
           phone = COALESCE(?, phone),
           gender = COALESCE(?, gender),
           address = COALESCE(?, address),
           insurance_provider = COALESCE(?, insurance_provider)
       WHERE user_id = ?`
    ).run(
      date_of_birth ?? null,
      phone ?? null,
      gender ?? null,
      address ?? null,
      insurance_provider ?? null,
      req.user.id
    );
  });
  update();

  const row = db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.full_name,
              p.id AS patient_id, p.date_of_birth, p.phone, p.gender,
              p.address, p.insurance_provider
       FROM users u JOIN patients p ON p.user_id = u.id
       WHERE u.id = ?`
    )
    .get(req.user.id);
  res.json({ profile: row });
});

module.exports = router;
