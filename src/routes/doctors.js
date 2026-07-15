/**
 * Doctor + specialty browsing routes (read-only for patients).
 * Admin management of doctors lives in routes/admin.js.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth } = require('../middleware/auth');
const { getAvailableSlots } = require('../utils/slots');

const router = express.Router();

/**
 * GET /api/doctors
 * Optional query params:
 *   q         - search text matched against doctor name
 *   specialty - specialty id to filter by
 * Returns active doctors joined with their specialty name.
 */
router.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const { q, specialty } = req.query;
    const clauses = ['d.active = true'];
    const params = [];

    if (q) {
      params.push(`%${String(q)}%`);
      clauses.push(`d.full_name ILIKE $${params.length}`);
    }
    if (specialty) {
      params.push(specialty);
      clauses.push(`d.specialty_id = $${params.length}`);
    }

    const rows = await db.query(
      `SELECT d.id, d.full_name, d.email, d.phone, d.bio, d.room,
              d.specialty_id, s.name AS specialty_name
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.full_name`,
      params
    );

    res.json({ doctors: rows });
  })
);

/**
 * GET /api/doctors/specialties — list all specialties (for filter dropdowns).
 */
router.get(
  '/specialties',
  requireAuth,
  wrap(async (req, res) => {
    const rows = await db.query('SELECT * FROM specialties ORDER BY name');
    res.json({ specialties: rows });
  })
);

/**
 * GET /api/doctors/:id — single doctor detail.
 */
router.get(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const doc = await db.one(
      `SELECT d.*, s.name AS specialty_name
       FROM doctors d LEFT JOIN specialties s ON s.id = d.specialty_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
    res.json({ doctor: doc });
  })
);

/**
 * GET /api/doctors/:id/availability?date=YYYY-MM-DD
 * Returns open slot start times for that doctor on that date.
 */
router.get(
  '/:id/availability',
  requireAuth,
  wrap(async (req, res) => {
    const { date } = req.query;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }
    const doc = await db.one('SELECT id FROM doctors WHERE id = $1 AND active = true', [
      req.params.id,
    ]);
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });

    const slots = await getAvailableSlots(Number(req.params.id), date);
    res.json({ date, slots });
  })
);

module.exports = router;
