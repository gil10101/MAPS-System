/**
 * Patient self-service profile routes.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const PROFILE_SELECT = `
  SELECT u.id AS user_id, u.email, u.full_name,
         p.id AS patient_id, p.date_of_birth, p.phone, p.gender,
         p.address, p.insurance_provider
  FROM users u JOIN patients p ON p.user_id = u.id
  WHERE u.id = $1
`;

/**
 * GET /api/patients/me — full profile for the logged-in patient.
 */
router.get(
  '/me',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const row = await db.one(PROFILE_SELECT, [req.user.id]);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile: row });
  })
);

/**
 * PUT /api/patients/me — update the logged-in patient's profile.
 */
router.put(
  '/me',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const { full_name, date_of_birth, phone, gender, address, insurance_provider } =
      req.body || {};

    if (full_name !== undefined && !String(full_name).trim()) {
      return res.status(400).json({ error: 'Full name cannot be empty.' });
    }
    const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }

    await db.tx(async (c) => {
      if (full_name !== undefined) {
        await c.query('UPDATE users SET full_name = $1 WHERE id = $2', [
          String(full_name).trim(),
          req.user.id,
        ]);
      }
      await c.query(
        `UPDATE patients
         SET date_of_birth      = COALESCE($1, date_of_birth),
             phone              = COALESCE($2, phone),
             gender             = COALESCE($3, gender),
             address            = COALESCE($4, address),
             insurance_provider = COALESCE($5, insurance_provider)
         WHERE user_id = $6`,
        [
          date_of_birth ?? null,
          phone ?? null,
          gender ?? null,
          address ?? null,
          insurance_provider ?? null,
          req.user.id,
        ]
      );
    });

    const row = await db.one(PROFILE_SELECT, [req.user.id]);
    res.json({ profile: row });
  })
);

module.exports = router;
