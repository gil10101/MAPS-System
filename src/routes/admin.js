/**
 * Admin routes — clinic administrator management + reporting.
 * All routes require an authenticated user with role = 'admin'.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Gate the entire router behind admin auth.
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------------
// Doctors CRUD
// ---------------------------------------------------------------------------

/** GET /api/admin/doctors — all doctors (including inactive). */
router.get('/doctors', (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS specialty_name
       FROM doctors d LEFT JOIN specialties s ON s.id = d.specialty_id
       ORDER BY d.full_name`
    )
    .all();
  res.json({ doctors: rows });
});

/** POST /api/admin/doctors — add a doctor. */
router.post('/doctors', (req, res) => {
  const { full_name, specialty_id, email, phone, bio, room } = req.body || {};
  if (!full_name || !String(full_name).trim()) {
    return res.status(400).json({ error: 'Doctor name is required.' });
  }
  const info = db
    .prepare(
      `INSERT INTO doctors (full_name, specialty_id, email, phone, bio, room, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`
    )
    .run(String(full_name).trim(), specialty_id || null, email || null, phone || null,
         bio || null, room || null);
  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ doctor });
});

/** PUT /api/admin/doctors/:id — update a doctor. */
router.put('/doctors/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Doctor not found.' });

  const { full_name, specialty_id, email, phone, bio, room, active } = req.body || {};
  db.prepare(
    `UPDATE doctors
     SET full_name = COALESCE(?, full_name),
         specialty_id = ?,
         email = COALESCE(?, email),
         phone = COALESCE(?, phone),
         bio   = COALESCE(?, bio),
         room  = COALESCE(?, room),
         active = COALESCE(?, active)
     WHERE id = ?`
  ).run(
    full_name ? String(full_name).trim() : null,
    specialty_id === undefined ? doc.specialty_id : specialty_id || null,
    email ?? null,
    phone ?? null,
    bio ?? null,
    room ?? null,
    active === undefined ? null : active ? 1 : 0,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
  res.json({ doctor: updated });
});

/** DELETE /api/admin/doctors/:id — deactivate (soft delete) a doctor. */
router.delete('/doctors/:id', (req, res) => {
  const doc = db.prepare('SELECT * FROM doctors WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
  db.prepare('UPDATE doctors SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: 'Doctor deactivated.' });
});

// ---------------------------------------------------------------------------
// Specialties
// ---------------------------------------------------------------------------

router.get('/specialties', (req, res) => {
  res.json({ specialties: db.prepare('SELECT * FROM specialties ORDER BY name').all() });
});

router.post('/specialties', (req, res) => {
  const { name, description } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Specialty name is required.' });
  }
  try {
    const info = db
      .prepare('INSERT INTO specialties (name, description) VALUES (?, ?)')
      .run(String(name).trim(), description || null);
    res.status(201).json({
      specialty: db.prepare('SELECT * FROM specialties WHERE id = ?').get(info.lastInsertRowid),
    });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That specialty already exists.' });
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Appointment oversight
// ---------------------------------------------------------------------------

const ADMIN_APPT_SELECT = `
  SELECT a.*, d.full_name AS doctor_name, s.name AS specialty_name,
         u.full_name AS patient_name, u.email AS patient_email
  FROM appointments a
  JOIN doctors d  ON d.id = a.doctor_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  JOIN patients p ON p.id = a.patient_id
  JOIN users u    ON u.id = p.user_id
`;

/** GET /api/admin/appointments?status=&doctor_id=&date= */
router.get('/appointments', (req, res) => {
  const { status, doctor_id, date } = req.query;
  const clauses = [];
  const params = [];
  if (status) { clauses.push('a.status = ?'); params.push(status); }
  if (doctor_id) { clauses.push('a.doctor_id = ?'); params.push(doctor_id); }
  if (date) { clauses.push('a.appt_date = ?'); params.push(date); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${ADMIN_APPT_SELECT} ${where} ORDER BY a.appt_date DESC, a.appt_time DESC`)
    .all(...params);
  res.json({ appointments: rows });
});

/**
 * PATCH /api/admin/appointments/:id/status — approve/cancel/complete.
 * Body: { status: 'confirmed'|'cancelled'|'completed'|'pending', notes? }
 */
router.patch('/appointments/:id/status', (req, res) => {
  const valid = ['pending', 'confirmed', 'cancelled', 'completed'];
  const { status, notes } = req.body || {};
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

  try {
    db.prepare(
      `UPDATE appointments SET status = ?, notes = COALESCE(?, notes),
              updated_at = datetime('now') WHERE id = ?`
    ).run(status, notes ?? null, req.params.id);
  } catch (err) {
    // Reactivating a cancelled appointment could collide with the unique slot.
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That doctor/time slot is already taken.' });
    }
    throw err;
  }
  const updated = db.prepare(`${ADMIN_APPT_SELECT} WHERE a.id = ?`).get(req.params.id);
  res.json({ appointment: updated });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/reports/summary — headline operational metrics.
 */
router.get('/reports/summary', (req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'pending')   AS pending,
         SUM(status = 'confirmed') AS confirmed,
         SUM(status = 'completed') AS completed,
         SUM(status = 'cancelled') AS cancelled
       FROM appointments`
    )
    .get();

  const total = totals.total || 0;
  const cancelled = totals.cancelled || 0;
  const cancellationRate = total ? Math.round((cancelled / total) * 1000) / 10 : 0;

  const patients = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'patient'").get().n;
  const activeDoctors = db.prepare('SELECT COUNT(*) AS n FROM doctors WHERE active = 1').get().n;

  res.json({
    summary: {
      appointments: {
        total,
        pending: totals.pending || 0,
        confirmed: totals.confirmed || 0,
        completed: totals.completed || 0,
        cancelled,
      },
      cancellation_rate: cancellationRate,
      total_patients: patients,
      active_doctors: activeDoctors,
    },
  });
});

/**
 * GET /api/admin/reports/physician-utilization
 * Appointment counts per doctor (physician utilization).
 */
router.get('/reports/physician-utilization', (req, res) => {
  const rows = db
    .prepare(
      `SELECT d.id, d.full_name, s.name AS specialty_name,
              COUNT(a.id) AS total_appointments,
              SUM(a.status = 'completed') AS completed,
              SUM(a.status = 'cancelled') AS cancelled,
              SUM(a.status IN ('pending','confirmed')) AS upcoming
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN appointments a ON a.doctor_id = d.id
       WHERE d.active = 1
       GROUP BY d.id
       ORDER BY total_appointments DESC, d.full_name`
    )
    .all();
  res.json({ utilization: rows });
});

/**
 * GET /api/admin/reports/volume-by-specialty
 * Appointment volume grouped by specialty.
 */
router.get('/reports/volume-by-specialty', (req, res) => {
  const rows = db
    .prepare(
      `SELECT COALESCE(s.name, 'Unassigned') AS specialty_name,
              COUNT(a.id) AS total_appointments
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN specialties s ON s.id = d.specialty_id
       GROUP BY s.id
       ORDER BY total_appointments DESC`
    )
    .all();
  res.json({ volume: rows });
});

module.exports = router;
