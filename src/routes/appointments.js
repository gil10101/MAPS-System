/**
 * Appointment routes for patients: book, list own, view, cancel.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isSlotAvailable } = require('../utils/slots');

const router = express.Router();

/** Resolve the patient row for the logged-in user, or null. */
function patientForUser(userId) {
  return db.prepare('SELECT * FROM patients WHERE user_id = ?').get(userId);
}

const DETAIL_SELECT = `
  SELECT a.*, d.full_name AS doctor_name, d.room AS doctor_room,
         s.name AS specialty_name,
         u.full_name AS patient_name
  FROM appointments a
  JOIN doctors d   ON d.id = a.doctor_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  JOIN patients p  ON p.id = a.patient_id
  JOIN users u     ON u.id = p.user_id
`;

/**
 * GET /api/appointments — the current patient's appointments (newest first).
 * Optional query: status=upcoming|past|<status>
 */
router.get('/', requireAuth, requireRole('patient'), (req, res) => {
  const patient = patientForUser(req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

  const rows = db
    .prepare(`${DETAIL_SELECT} WHERE a.patient_id = ?
              ORDER BY a.appt_date DESC, a.appt_time DESC`)
    .all(patient.id);

  const { status } = req.query;
  let filtered = rows;
  if (status === 'upcoming') {
    filtered = rows.filter(
      (r) => r.status !== 'cancelled' && r.status !== 'completed'
    );
  } else if (status === 'past') {
    filtered = rows.filter((r) => r.status === 'completed' || r.status === 'cancelled');
  } else if (status) {
    filtered = rows.filter((r) => r.status === status);
  }

  res.json({ appointments: filtered });
});

/**
 * POST /api/appointments — book a new appointment.
 * Body: { doctor_id, appt_date, appt_time, reason }
 */
router.post('/', requireAuth, requireRole('patient'), (req, res) => {
  const patient = patientForUser(req.user.id);
  if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

  const { doctor_id, appt_date, appt_time, reason } = req.body || {};
  if (!doctor_id || !appt_date || !appt_time) {
    return res.status(400).json({ error: 'Doctor, date, and time are required.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appt_date) || !/^\d{2}:\d{2}$/.test(appt_time)) {
    return res.status(400).json({ error: 'Invalid date or time format.' });
  }

  const doctor = db.prepare('SELECT * FROM doctors WHERE id = ? AND active = 1').get(doctor_id);
  if (!doctor) return res.status(404).json({ error: 'Doctor not found or not accepting appointments.' });

  // Reject dates in the past (compare against today's date string).
  const today = new Date().toISOString().slice(0, 10);
  if (appt_date < today) {
    return res.status(400).json({ error: 'Cannot book an appointment in the past.' });
  }

  // Validate the slot is a real, open slot for this doctor/date.
  if (!isSlotAvailable(Number(doctor_id), appt_date, appt_time)) {
    return res.status(409).json({
      error: 'That time slot is no longer available. Please choose another.',
    });
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, reason, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`
      )
      .run(patient.id, doctor_id, appt_date, appt_time, reason || null);
    const appt = db.prepare(`${DETAIL_SELECT} WHERE a.id = ?`).get(info.lastInsertRowid);
    return res.status(201).json({ appointment: appt });
  } catch (err) {
    // Unique index violation = double booking race.
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'That time slot was just taken. Please choose another.' });
    }
    throw err;
  }
});

/**
 * GET /api/appointments/:id — a single appointment owned by the patient.
 */
router.get('/:id', requireAuth, requireRole('patient'), (req, res) => {
  const patient = patientForUser(req.user.id);
  const appt = db.prepare(`${DETAIL_SELECT} WHERE a.id = ?`).get(req.params.id);
  if (!appt || appt.patient_id !== patient.id) {
    return res.status(404).json({ error: 'Appointment not found.' });
  }
  res.json({ appointment: appt });
});

/**
 * PATCH /api/appointments/:id/cancel — patient cancels their own appointment.
 */
router.patch('/:id/cancel', requireAuth, requireRole('patient'), (req, res) => {
  const patient = patientForUser(req.user.id);
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt || appt.patient_id !== patient.id) {
    return res.status(404).json({ error: 'Appointment not found.' });
  }
  if (appt.status === 'cancelled') {
    return res.status(400).json({ error: 'Appointment is already cancelled.' });
  }
  if (appt.status === 'completed') {
    return res.status(400).json({ error: 'Completed appointments cannot be cancelled.' });
  }
  db.prepare(
    `UPDATE appointments SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
  ).run(appt.id);
  const updated = db.prepare(`${DETAIL_SELECT} WHERE a.id = ?`).get(appt.id);
  res.json({ appointment: updated });
});

module.exports = router;
