/**
 * Appointment routes for patients: book, list own, view, cancel.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isSlotAvailable } = require('../utils/slots');

const router = express.Router();

/** Resolve the patient row for the logged-in user, or null. */
function patientForUser(userId) {
  return db.one('SELECT * FROM patients WHERE user_id = $1', [userId]);
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
router.get(
  '/',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const rows = await db.query(
      `${DETAIL_SELECT} WHERE a.patient_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [patient.id]
    );

    const { status } = req.query;
    let filtered = rows;
    if (status === 'upcoming') {
      filtered = rows.filter((r) => r.status === 'booked');
    } else if (status === 'past') {
      filtered = rows.filter((r) => r.status !== 'booked');
    } else if (status) {
      filtered = rows.filter((r) => r.status === status);
    }

    res.json({ appointments: filtered });
  })
);

/**
 * POST /api/appointments — book a new appointment.
 * Body: { doctor_id, appt_date, appt_time, reason }
 */
router.post(
  '/',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const { doctor_id, appt_date, appt_time, reason } = req.body || {};
    if (!doctor_id || !appt_date || !appt_time) {
      return res.status(400).json({ error: 'Doctor, date, and time are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appt_date) || !/^\d{2}:\d{2}$/.test(appt_time)) {
      return res.status(400).json({ error: 'Invalid date or time format.' });
    }

    const doctor = await db.one('SELECT * FROM doctors WHERE id = $1 AND active = true', [
      doctor_id,
    ]);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found or not accepting appointments.' });
    }

    // Reject dates in the past (compare against today's date string).
    const today = new Date().toISOString().slice(0, 10);
    if (appt_date < today) {
      return res.status(400).json({ error: 'Cannot book an appointment in the past.' });
    }

    // Validate the slot is a real, open slot for this doctor/date.
    if (!(await isSlotAvailable(Number(doctor_id), appt_date, appt_time))) {
      return res.status(409).json({
        error: 'That time slot is no longer available. Please choose another.',
      });
    }

    try {
      // Booked immediately — no approval queue. The slot is held the moment the
      // patient takes it; the clinic does not vet the booking afterwards.
      // The patient has not yet acknowledged a reminder, so confirmation starts
      // at 'unconfirmed' on its own axis.
      const inserted = await db.one(
        `INSERT INTO appointments
           (patient_id, doctor_id, appt_date, appt_time, reason, status, confirmation_status)
         VALUES ($1, $2, $3, $4, $5, 'booked', 'unconfirmed') RETURNING id`,
        [patient.id, doctor_id, appt_date, appt_time, reason || null]
      );
      const appt = await db.one(`${DETAIL_SELECT} WHERE a.id = $1`, [inserted.id]);
      return res.status(201).json({ appointment: appt });
    } catch (err) {
      // Partial unique index violation = double-booking race.
      if (err.code === '23505') {
        return res
          .status(409)
          .json({ error: 'That time slot was just taken. Please choose another.' });
      }
      throw err;
    }
  })
);

/**
 * GET /api/appointments/:id — a single appointment owned by the patient.
 */
router.get(
  '/:id',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    const appt = await db.one(`${DETAIL_SELECT} WHERE a.id = $1`, [req.params.id]);
    if (!patient || !appt || appt.patient_id !== patient.id) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    res.json({ appointment: appt });
  })
);

/**
 * PATCH /api/appointments/:id/confirm — the patient confirms they will attend.
 *
 * This is the real meaning of "confirmed" in a clinic system: the patient
 * responded to a reminder. In production this would be driven by an SMS/email
 * reply; here the patient taps a button. Either way the actor is the patient,
 * never staff — which is why it lives on the patient router and moves
 * confirmation_status only, leaving the lifecycle status untouched.
 */
router.patch(
  '/:id/confirm',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    const appt = await db.one('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
    if (!patient || !appt || appt.patient_id !== patient.id) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (appt.status !== 'booked') {
      return res.status(400).json({ error: 'Only an upcoming appointment can be confirmed.' });
    }
    await db.query(
      `UPDATE appointments
       SET confirmation_status = 'confirmed', confirmed_at = now(), updated_at = now()
       WHERE id = $1`,
      [appt.id]
    );
    res.json({ appointment: await db.one(`${DETAIL_SELECT} WHERE a.id = $1`, [appt.id]) });
  })
);

/**
 * PATCH /api/appointments/:id/cancel — patient cancels their own appointment.
 * Body: { reason? }
 *
 * Records who cancelled and why. Cancellation is terminal and not undoable —
 * matching Epic, where "you cannot undo an appointment cancellation... you must
 * create a new appointment to replace it". Re-opening a cancelled row would
 * also race the partial unique index if the slot were taken meanwhile.
 */
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    const appt = await db.one('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
    if (!patient || !appt || appt.patient_id !== patient.id) {
      return res.status(404).json({ error: 'Appointment not found.' });
    }
    if (appt.status !== 'booked') {
      return res.status(400).json({
        error:
          appt.status === 'cancelled'
            ? 'Appointment is already cancelled.'
            : 'Only an upcoming appointment can be cancelled.',
      });
    }

    const reason = (req.body || {}).reason;
    await db.query(
      `UPDATE appointments
       SET status = 'cancelled', cancelled_by = 'patient', cancel_reason = $2,
           cancelled_at = now(), updated_at = now()
       WHERE id = $1`,
      [appt.id, (reason && String(reason).trim()) || null]
    );
    const updated = await db.one(`${DETAIL_SELECT} WHERE a.id = $1`, [appt.id]);
    res.json({ appointment: updated });
  })
);

module.exports = router;
