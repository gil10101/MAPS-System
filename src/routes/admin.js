/**
 * Admin routes — clinic administrator management + reporting.
 * All routes require an authenticated user with role = 'admin'.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Gate the entire router behind admin auth.
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------------
// Doctors CRUD
// ---------------------------------------------------------------------------

/** GET /api/admin/doctors — all doctors (including inactive). */
router.get(
  '/doctors',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT d.*, s.name AS specialty_name
       FROM doctors d LEFT JOIN specialties s ON s.id = d.specialty_id
       ORDER BY d.full_name`
    );
    res.json({ doctors: rows });
  })
);

/** POST /api/admin/doctors — add a doctor. */
router.post(
  '/doctors',
  wrap(async (req, res) => {
    const { full_name, specialty_id, email, phone, bio, room } = req.body || {};
    if (!full_name || !String(full_name).trim()) {
      return res.status(400).json({ error: 'Doctor name is required.' });
    }
    const doctor = await db.one(
      `INSERT INTO doctors (full_name, specialty_id, email, phone, bio, room, active)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [
        String(full_name).trim(),
        specialty_id || null,
        email || null,
        phone || null,
        bio || null,
        room || null,
      ]
    );
    res.status(201).json({ doctor });
  })
);

/** PUT /api/admin/doctors/:id — update a doctor (merge over current values). */
router.put(
  '/doctors/:id',
  wrap(async (req, res) => {
    const doc = await db.one('SELECT * FROM doctors WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });

    const body = req.body || {};
    const merged = {
      full_name: body.full_name ? String(body.full_name).trim() : doc.full_name,
      specialty_id:
        body.specialty_id === undefined ? doc.specialty_id : body.specialty_id || null,
      email: body.email !== undefined ? body.email : doc.email,
      phone: body.phone !== undefined ? body.phone : doc.phone,
      bio: body.bio !== undefined ? body.bio : doc.bio,
      room: body.room !== undefined ? body.room : doc.room,
      active: body.active === undefined ? doc.active : !!body.active,
    };

    const updated = await db.one(
      `UPDATE doctors
       SET full_name = $1, specialty_id = $2, email = $3, phone = $4,
           bio = $5, room = $6, active = $7
       WHERE id = $8 RETURNING *`,
      [
        merged.full_name,
        merged.specialty_id,
        merged.email,
        merged.phone,
        merged.bio,
        merged.room,
        merged.active,
        req.params.id,
      ]
    );
    res.json({ doctor: updated });
  })
);

/** DELETE /api/admin/doctors/:id — deactivate (soft delete) a doctor. */
router.delete(
  '/doctors/:id',
  wrap(async (req, res) => {
    const doc = await db.one('SELECT id FROM doctors WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Doctor not found.' });
    await db.query('UPDATE doctors SET active = false WHERE id = $1', [req.params.id]);
    res.json({ ok: true, message: 'Doctor deactivated.' });
  })
);

// ---------------------------------------------------------------------------
// Specialties
// ---------------------------------------------------------------------------

router.get(
  '/specialties',
  wrap(async (req, res) => {
    res.json({ specialties: await db.query('SELECT * FROM specialties ORDER BY name') });
  })
);

router.post(
  '/specialties',
  wrap(async (req, res) => {
    const { name, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Specialty name is required.' });
    }
    try {
      const specialty = await db.one(
        'INSERT INTO specialties (name, description) VALUES ($1, $2) RETURNING *',
        [String(name).trim(), description || null]
      );
      res.status(201).json({ specialty });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That specialty already exists.' });
      }
      throw err;
    }
  })
);

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
router.get(
  '/appointments',
  wrap(async (req, res) => {
    const { status, doctor_id, date } = req.query;
    const clauses = [];
    const params = [];
    if (status) {
      params.push(status);
      clauses.push(`a.status = $${params.length}`);
    }
    if (doctor_id) {
      params.push(doctor_id);
      clauses.push(`a.doctor_id = $${params.length}`);
    }
    if (date) {
      params.push(date);
      clauses.push(`a.appt_date = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.query(
      `${ADMIN_APPT_SELECT} ${where} ORDER BY a.appt_date DESC, a.appt_time DESC`,
      params
    );
    res.json({ appointments: rows });
  })
);

/**
 * PATCH /api/admin/appointments/:id/status — approve/cancel/complete.
 * Body: { status: 'confirmed'|'cancelled'|'completed'|'pending', notes? }
 */
router.patch(
  '/appointments/:id/status',
  wrap(async (req, res) => {
    const valid = ['pending', 'confirmed', 'cancelled', 'completed'];
    const { status, notes } = req.body || {};
    if (!valid.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const appt = await db.one('SELECT id FROM appointments WHERE id = $1', [req.params.id]);
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    try {
      await db.query(
        `UPDATE appointments
         SET status = $1, notes = COALESCE($2, notes), updated_at = now()
         WHERE id = $3`,
        [status, notes ?? null, req.params.id]
      );
    } catch (err) {
      // Reactivating a cancelled appointment could collide with the unique slot.
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That doctor/time slot is already taken.' });
      }
      throw err;
    }
    const updated = await db.one(`${ADMIN_APPT_SELECT} WHERE a.id = $1`, [req.params.id]);
    res.json({ appointment: updated });
  })
);

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/reports/summary — headline operational metrics.
 */
router.get(
  '/reports/summary',
  wrap(async (req, res) => {
    const totals = await db.one(
      `SELECT
         COUNT(*)                                     AS total,
         COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
         COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled
       FROM appointments`
    );

    const total = totals.total || 0;
    const cancelled = totals.cancelled || 0;
    const cancellationRate = total ? Math.round((cancelled / total) * 1000) / 10 : 0;

    const patients = (await db.one(`SELECT COUNT(*) AS n FROM users WHERE role = 'patient'`)).n;
    const activeDoctors = (
      await db.one('SELECT COUNT(*) AS n FROM doctors WHERE active = true')
    ).n;

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
  })
);

/**
 * GET /api/admin/reports/physician-utilization
 * Appointment counts per doctor (physician utilization).
 */
router.get(
  '/reports/physician-utilization',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT d.id, d.full_name, s.name AS specialty_name,
              COUNT(a.id)                                                    AS total_appointments,
              COUNT(a.id) FILTER (WHERE a.status = 'completed')              AS completed,
              COUNT(a.id) FILTER (WHERE a.status = 'cancelled')              AS cancelled,
              COUNT(a.id) FILTER (WHERE a.status IN ('pending','confirmed')) AS upcoming
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN appointments a ON a.doctor_id = d.id
       WHERE d.active = true
       GROUP BY d.id, s.name
       ORDER BY total_appointments DESC, d.full_name`
    );
    res.json({ utilization: rows });
  })
);

/**
 * GET /api/admin/reports/volume-by-specialty
 * Appointment volume grouped by specialty.
 */
router.get(
  '/reports/volume-by-specialty',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT COALESCE(s.name, 'Unassigned') AS specialty_name,
              COUNT(a.id) AS total_appointments
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN specialties s ON s.id = d.specialty_id
       GROUP BY s.id, s.name
       ORDER BY total_appointments DESC`
    );
    res.json({ volume: rows });
  })
);

module.exports = router;
