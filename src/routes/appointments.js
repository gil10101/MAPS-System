/**
 * Appointments, from the patient's side: request a visit, see their own, move
 * one, cancel one.
 *
 * A booking made here is a *request*. It is created `pending` and stays that
 * way until clinic staff approve it (routes/admin.js) — nothing on this router
 * can confirm an appointment, because the patient is not the one who decides
 * whether the practice can see them.
 *
 * Visit notes are absent from every response in this file by design: `notes` is
 * clinical documentation written by staff for staff. The columns are listed out
 * rather than selected with a.* so that stays true when the table grows.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isSlotAvailable, resolveSlotLocation } = require('../utils/slots');
const { notify } = require('../services/notify');

const router = express.Router();

// The reason stamped on the superseded row when a patient moves a booking. A
// constant because the Cancellation report groups on this text: a reschedule is
// not the same thing as a patient walking away, and the wording is what tells
// the two apart.
const RESCHEDULE_CANCEL_REASON = 'Rescheduled to another time';

const OPEN_STATUSES = ['pending', 'confirmed'];

/**
 * Aborts a transaction for a reason that is the caller's fault, not the
 * database's, so the rollback path can answer 409 instead of looking like an
 * unhandled failure.
 */
class SlotConflict extends Error {
  constructor(message) {
    super(message);
    this.name = 'SlotConflict';
  }
}

const PATIENT_SELECT = `
  SELECT a.id, a.doctor_id, d.full_name AS doctor_name, s.name AS specialty_name,
         a.location_id, l.name AS location_name, l.address AS location_address,
         a.appt_date, a.appt_time, a.reason, a.status, a.reschedule_required,
         a.cancel_reason, a.cancelled_by, a.cancelled_at,
         a.rescheduled_from_id, a.created_at
  FROM appointments a
  JOIN doctors d ON d.id = a.doctor_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN locations l ON l.id = a.location_id
`;

/** The patients row for the logged-in user, or null. */
function patientForUser(userId) {
  return db.one('SELECT id, user_id FROM patients WHERE user_id = $1', [userId]);
}

/**
 * One of this patient's appointments, raw, or null.
 *
 * Ownership is a WHERE clause rather than a fetch-then-compare so another
 * patient's id simply matches nothing: the 404 never reveals that the row
 * exists. Every route below loads through here.
 */
function ownedAppointment(apptId, patientId) {
  return db.one('SELECT * FROM appointments WHERE id = $1 AND patient_id = $2', [
    apptId,
    patientId,
  ]);
}

/** The patient-safe view of one appointment (no notes). */
function detail(apptId) {
  return db.one(`${PATIENT_SELECT} WHERE a.id = $1`, [apptId]);
}

function isDateStr(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeStr(value) {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value);
}

/**
 * Today as 'YYYY-MM-DD' in the server's local zone — the clinic's calendar day.
 * Deliberately not toISOString(): east of UTC in the morning, and west of it in
 * the evening, the UTC date is a different day, and same-day bookings would be
 * rejected as "in the past" for part of every day.
 */
function todayStr() {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** Route ids reach INTEGER columns; a non-numeric one is a bad request, not a 500. */
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * GET /api/appointments — everything this patient has, newest visit first.
 *
 * Unfiltered on purpose: the dashboard splits upcoming from past and the list
 * page filters by status, both from the same payload, so a patient's history
 * never needs a second round trip.
 */
router.get(
  '/',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const rows = await db.query(
      `${PATIENT_SELECT}
       WHERE a.patient_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC, a.id DESC`,
      [patient.id]
    );

    res.json({ appointments: rows });
  })
);

/**
 * POST /api/appointments — request a visit.
 * Body: { doctor_id, appt_date, appt_time, reason? }
 *
 * Two different 409s, because they mean different things to the person on the
 * other end: the slot was never bookable (schedule changed, doctor blocked out
 * the day) versus somebody else took it in the seconds since the availability
 * call. Only the second is worth an immediate retry.
 *
 * The site is resolved from the schedule window and stored on the row rather
 * than looked up at read time — a later edit to the weekly pattern must not
 * rewrite where a visit was booked to happen.
 */
router.post(
  '/',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const { doctor_id, appt_date, appt_time, reason } = req.body || {};
    const doctorId = toId(doctor_id);
    if (!doctorId || !appt_date || !appt_time) {
      return res.status(400).json({ error: 'Doctor, date, and time are required.' });
    }
    if (!isDateStr(appt_date) || !isTimeStr(appt_time)) {
      return res.status(400).json({ error: 'Invalid date or time format.' });
    }
    if (appt_date < todayStr()) {
      return res.status(400).json({ error: 'Cannot book an appointment in the past.' });
    }

    const doctor = await db.one('SELECT id FROM doctors WHERE id = $1 AND active = true', [
      doctorId,
    ]);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found or not accepting appointments.' });
    }

    if (!(await isSlotAvailable(doctorId, appt_date, appt_time))) {
      return res.status(409).json({ error: 'That time is no longer open. Pick another slot.' });
    }

    const locationId = await resolveSlotLocation(doctorId, appt_date, appt_time);

    let created;
    try {
      const inserted = await db.one(
        `INSERT INTO appointments
           (patient_id, doctor_id, location_id, appt_date, appt_time, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING id`,
        [patient.id, doctorId, locationId, appt_date, appt_time, String(reason || '').trim() || null]
      );
      created = await detail(inserted.id);
    } catch (err) {
      // The partial unique index is the real guard against double-booking; the
      // availability check above is only there to give a better message first.
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That time was just taken. Pick another slot.' });
      }
      throw err;
    }

    // notify() swallows its own failures by contract (see services/notify.js):
    // the patient holds the slot whether or not the tray row was written.
    await notify({
      userId: req.user.id,
      appointmentId: created.id,
      type: 'appointment_requested',
      ctx: {
        doctorName: created.doctor_name,
        apptDate: created.appt_date,
        apptTime: created.appt_time,
        locationName: created.location_name,
      },
    });

    res.status(201).json({ appointment: created });
  })
);

/**
 * GET /api/appointments/:id — one of the patient's own appointments.
 */
router.get(
  '/:id',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment id.' });

    const patient = await patientForUser(req.user.id);
    const owned = patient && (await ownedAppointment(id, patient.id));
    if (!owned) return res.status(404).json({ error: 'Appointment not found.' });

    res.json({ appointment: await detail(id) });
  })
);

/**
 * PATCH /api/appointments/:id/reschedule — move a booking to a new slot.
 * Body: { appt_date, appt_time }
 *
 * The original row is superseded, never edited: the new time is a new request
 * that staff have to approve again, and the practice still needs to be able to
 * report that a booking on the old date existed and moved. `rescheduled_from_id`
 * is the link between the two, so the pair reads as one story.
 *
 * Insert-then-cancel inside one transaction, in that order: the replacement has
 * to hit the unique index while the original is still live, so a collision on
 * the new slot fails before the patient has given up the slot they hold.
 */
router.patch(
  '/:id/reschedule',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment id.' });

    const patient = await patientForUser(req.user.id);
    const appt = patient && (await ownedAppointment(id, patient.id));
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    if (!OPEN_STATUSES.includes(appt.status)) {
      return res.status(400).json({
        error:
          appt.status === 'cancelled'
            ? 'A cancelled appointment cannot be rescheduled. Please book a new one.'
            : 'Only an upcoming appointment can be rescheduled.',
      });
    }

    const { appt_date, appt_time } = req.body || {};
    if (!isDateStr(appt_date) || !isTimeStr(appt_time)) {
      return res.status(400).json({ error: 'A new date and time are required.' });
    }
    if (appt_date < todayStr()) {
      return res.status(400).json({ error: 'Cannot move an appointment to a date in the past.' });
    }
    // Without this the slot would look taken — by this very appointment — and
    // the patient would be told their own booking is unavailable.
    if (appt_date === appt.appt_date && appt_time === appt.appt_time) {
      return res.status(400).json({ error: 'That is the time this appointment already has.' });
    }

    const doctor = await db.one('SELECT id FROM doctors WHERE id = $1 AND active = true', [
      appt.doctor_id,
    ]);
    if (!doctor) {
      return res.status(409).json({
        error:
          'This provider is no longer accepting appointments. Please cancel this one and book with another provider.',
      });
    }

    if (!(await isSlotAvailable(appt.doctor_id, appt_date, appt_time))) {
      return res.status(409).json({ error: 'That time is no longer open. Pick another slot.' });
    }

    const locationId = await resolveSlotLocation(appt.doctor_id, appt_date, appt_time);

    let created;
    try {
      const newId = await db.tx(async (client) => {
        // reschedule_required is set explicitly rather than left to the column
        // default: the flag belongs to the blocked slot the patient is leaving,
        // and must not follow them to the new one.
        const inserted = await client.query(
          `INSERT INTO appointments
             (patient_id, doctor_id, location_id, appt_date, appt_time, reason,
              status, rescheduled_from_id, reschedule_required)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, false)
           RETURNING id`,
          [patient.id, appt.doctor_id, locationId, appt_date, appt_time, appt.reason, appt.id]
        );

        // Re-checking the status in the UPDATE closes the window between the
        // read above and this write: two reschedules racing each other must not
        // both supersede the same booking and leave two live rows behind.
        const superseded = await client.query(
          `UPDATE appointments
           SET status = 'cancelled', cancelled_by = 'patient', cancel_reason = $2,
               cancelled_at = now(), reschedule_required = false, updated_at = now()
           WHERE id = $1 AND status = ANY($3::text[])`,
          [appt.id, RESCHEDULE_CANCEL_REASON, OPEN_STATUSES]
        );
        if (superseded.rowCount === 0) {
          throw new SlotConflict('That appointment changed while you were rescheduling it.');
        }

        return inserted.rows[0].id;
      });

      created = await detail(newId);
    } catch (err) {
      if (err instanceof SlotConflict) return res.status(409).json({ error: err.message });
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That time was just taken. Pick another slot.' });
      }
      throw err;
    }

    await notify({
      userId: req.user.id,
      appointmentId: created.id,
      type: 'appointment_rescheduled',
      ctx: {
        doctorName: created.doctor_name,
        apptDate: created.appt_date,
        apptTime: created.appt_time,
        locationName: created.location_name,
        previousDate: appt.appt_date,
        previousTime: appt.appt_time,
      },
    });

    res.json({ appointment: created });
  })
);

/**
 * PATCH /api/appointments/:id/cancel — the patient gives the slot back.
 * Body: { cancel_reason }
 *
 * The reason is required, not optional: cancellation reporting is the point of
 * capturing it, and "cancelled, unknown why" is the row that makes the report
 * useless. The UI offers presets so this is one tap, not an essay.
 *
 * Terminal and not undoable — the slot is released to the unique index the
 * moment this lands, so re-opening the row could collide with whoever took it.
 * Changing your mind means booking again.
 */
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('patient'),
  wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid appointment id.' });

    const patient = await patientForUser(req.user.id);
    const appt = patient && (await ownedAppointment(id, patient.id));
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    if (!OPEN_STATUSES.includes(appt.status)) {
      return res.status(400).json({
        error:
          appt.status === 'cancelled'
            ? 'This appointment is already cancelled.'
            : 'Only an upcoming appointment can be cancelled.',
      });
    }

    const cancelReason = String((req.body || {}).cancel_reason || '').trim();
    if (!cancelReason) {
      return res.status(400).json({ error: 'Please tell us why you are cancelling.' });
    }

    // reschedule_required is cleared alongside: a cancelled booking has nothing
    // left to move, and the amber prompt would otherwise sit there forever.
    await db.query(
      `UPDATE appointments
       SET status = 'cancelled', cancelled_by = 'patient', cancel_reason = $2,
           cancelled_at = now(), reschedule_required = false, updated_at = now()
       WHERE id = $1`,
      [appt.id, cancelReason]
    );

    const updated = await detail(appt.id);

    await notify({
      userId: req.user.id,
      appointmentId: updated.id,
      type: 'appointment_cancelled',
      ctx: {
        doctorName: updated.doctor_name,
        apptDate: updated.appt_date,
        apptTime: updated.appt_time,
        cancelReason: updated.cancel_reason,
        cancelledBy: 'patient',
      },
    });

    res.json({ appointment: updated });
  })
);

module.exports = router;
