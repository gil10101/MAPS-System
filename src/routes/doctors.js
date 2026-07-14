/**
 * Doctor + specialty browsing routes (read-only for patients).
 * Admin management of doctors lives in routes/admin.js.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
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
router.get('/', requireAuth, (req, res) => {
  const { q, specialty } = req.query;
  const clauses = ['d.active = 1'];
  const params = [];

  if (q) {
    clauses.push('LOWER(d.full_name) LIKE ?');
    params.push(`%${String(q).toLowerCase()}%`);
  }
  if (specialty) {
    clauses.push('d.specialty_id = ?');
    params.push(specialty);
  }

  const rows = db
    .prepare(
      `SELECT d.id, d.full_name, d.email, d.phone, d.bio, d.room,
              d.specialty_id, s.name AS specialty_name
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.full_name`
    )
    .all(...params);

  res.json({ doctors: rows });
});

/**
 * GET /api/doctors/specialties — list all specialties (for filter dropdowns).
 */
router.get('/specialties', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM specialties ORDER BY name').all();
  res.json({ specialties: rows });
});

/**
 * GET /api/doctors/:id — single doctor detail.
 */
router.get('/:id', requireAuth, (req, res) => {
  const doc = db
    .prepare(
      `SELECT d.*, s.name AS specialty_name
       FROM doctors d LEFT JOIN specialties s ON s.id = d.specialty_id
       WHERE d.id = ?`
    )
    .get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
  res.json({ doctor: doc });
});

/**
 * GET /api/doctors/:id/availability?date=YYYY-MM-DD
 * Returns open slot start times for that doctor on that date.
 */
router.get('/:id/availability', requireAuth, (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
  }
  const doc = db.prepare('SELECT id FROM doctors WHERE id = ? AND active = 1').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Doctor not found.' });

  const slots = getAvailableSlots(Number(req.params.id), date);
  res.json({ date, slots });
});

module.exports = router;
