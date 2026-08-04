/**
 * Admin routes — clinic operations: the physician directory, specialties,
 * clinic sites, weekly schedules, availability blocks, and oversight of every
 * appointment in the practice.
 *
 * Reporting lives in routes/admin-reports.js (mounted ahead of this router).
 * All routes here require an authenticated user with role = 'admin'.
 */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');
const { notify } = require('../services/notify');
const { toMinutes } = require('../utils/slots');

const router = express.Router();

// Gate the entire router behind admin auth.
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------------
// Shared validation helpers
// ---------------------------------------------------------------------------

/** Route/body ids are strings; anything that is not a positive integer is junk. */
function parseId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Every ':id' in this router is a database key. Screening it here means a URL
 * like /api/admin/doctors/abc answers 404 instead of handing 'abc' to Postgres,
 * which raises a type error and surfaces to the client as a 500.
 */
router.param('id', (req, res, next, value) => {
  if (!parseId(value)) return res.status(404).json({ error: 'Not found.' });
  return next();
});

/** Trimmed string for a body field, '' when the field is absent or null. */
function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** 'HH:MM' on a 24h clock. Zero-padded so string ordering matches time ordering. */
function isHHMM(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * A real 'YYYY-MM-DD' date. Validated here rather than left to Postgres because
 * a malformed date param would surface as a 500 instead of a 400.
 */
function isDateStr(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

// ---------------------------------------------------------------------------
// Doctors CRUD
// ---------------------------------------------------------------------------

/**
 * Read a doctor's own writable fields off a request body, falling back to the
 * row's current values so PUT can be a partial update.
 *
 * full_name is never in here: it is a generated column, and writing to it is an
 * error Postgres would only raise at runtime.
 */
function mergeDoctorFields(body, current = {}) {
  return {
    prefix: body.prefix !== undefined ? text(body.prefix) || 'Dr.' : current.prefix || 'Dr.',
    first_name: body.first_name !== undefined ? text(body.first_name) : current.first_name || '',
    last_name: body.last_name !== undefined ? text(body.last_name) : current.last_name || '',
    specialty_id:
      body.specialty_id === undefined
        ? current.specialty_id ?? null
        : parseId(body.specialty_id),
    email: body.email !== undefined ? text(body.email) || null : current.email ?? null,
    phone: body.phone !== undefined ? text(body.phone) || null : current.phone ?? null,
    bio: body.bio !== undefined ? text(body.bio) || null : current.bio ?? null,
    room: body.room !== undefined ? text(body.room) || null : current.room ?? null,
    active: body.active === undefined ? current.active ?? true : !!body.active,
  };
}

/**
 * Validate the specialty a doctor is being filed under.
 *
 * Left to the database, an id that does not exist is a foreign-key violation —
 * a 500 that tells the admin nothing. An unparseable id is rejected rather than
 * quietly read as "no specialty", which would silently drop a physician out of
 * specialty search.
 *
 * @returns {Promise<string|null>} the error message, or null when acceptable
 */
async function specialtyProblem(rawValue, specialtyId) {
  const omitted = rawValue === undefined || rawValue === null || rawValue === '';
  if (!omitted && !specialtyId) return 'Invalid specialty.';
  if (specialtyId) {
    const found = await db.one('SELECT id FROM specialties WHERE id = $1', [specialtyId]);
    if (!found) return 'Unknown specialty.';
  }
  return null;
}

/** GET /api/admin/doctors — the whole directory (including inactive), with login state. */
router.get(
  '/doctors',
  wrap(async (req, res) => {
    // Sorted by surname: staff look a physician up the way a directory is
    // printed, and it is the order every report uses.
    const rows = await db.query(
      `SELECT d.*, s.name AS specialty_name, u.email AS login_email
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN users u ON u.id = d.user_id
       ORDER BY d.last_name, d.first_name`
    );
    res.json({ doctors: rows });
  })
);

/**
 * POST /api/admin/doctors/:id/account — create the physician's portal login.
 * Body: { email, password }
 *
 * Admins provision accounts; doctors do not self-register (the clinic vouches
 * for who its physicians are, unlike patients). The name is copied from the
 * directory entry rather than taken from the body so the portal greets the
 * physician with the same name patients see — one record, one spelling.
 * The office phone is deliberately not copied: users.phone is a personal
 * reminder channel, doctors.phone is the public office line.
 */
router.post(
  '/doctors/:id/account',
  wrap(async (req, res) => {
    const doc = await db.one('SELECT * FROM doctors WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Physician not found.' });
    if (doc.user_id) {
      return res.status(409).json({ error: 'This physician already has a login.' });
    }

    const { email, password } = req.body || {};
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'A valid email is required.' });
    }
    if (String(password || '').length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
      const user = await db.tx(async (c) => {
        const u = await c.query(
          `INSERT INTO users (email, password_hash, role, first_name, last_name)
           VALUES ($1, $2, 'doctor', $3, $4) RETURNING id, email`,
          [
            String(email).toLowerCase(),
            bcrypt.hashSync(String(password), 10),
            doc.first_name,
            doc.last_name,
          ]
        );
        await c.query('UPDATE doctors SET user_id = $1 WHERE id = $2', [u.rows[0].id, doc.id]);
        return u.rows[0];
      });
      res.status(201).json({ ok: true, login_email: user.email });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'An account with that email already exists.' });
      }
      throw err;
    }
  })
);

/** POST /api/admin/doctors — add a physician to the directory. */
router.post(
  '/doctors',
  wrap(async (req, res) => {
    const body = req.body || {};
    const fields = mergeDoctorFields(body);
    if (!fields.first_name || !fields.last_name) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    const badSpecialty = await specialtyProblem(body.specialty_id, fields.specialty_id);
    if (badSpecialty) return res.status(400).json({ error: badSpecialty });

    const doctor = await db.one(
      `INSERT INTO doctors (prefix, first_name, last_name, specialty_id, email, phone, bio, room, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        fields.prefix,
        fields.first_name,
        fields.last_name,
        fields.specialty_id,
        fields.email,
        fields.phone,
        fields.bio,
        fields.room,
        fields.active,
      ]
    );
    res.status(201).json({ doctor });
  })
);

/** PUT /api/admin/doctors/:id — update a physician (merge over current values). */
router.put(
  '/doctors/:id',
  wrap(async (req, res) => {
    const doc = await db.one('SELECT * FROM doctors WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Physician not found.' });

    const body = req.body || {};
    const fields = mergeDoctorFields(body, doc);
    if (!fields.first_name || !fields.last_name) {
      return res.status(400).json({ error: 'First and last name are required.' });
    }
    // Only re-checked when the field was sent; an untouched specialty is
    // already whatever the row had.
    if (body.specialty_id !== undefined) {
      const badSpecialty = await specialtyProblem(body.specialty_id, fields.specialty_id);
      if (badSpecialty) return res.status(400).json({ error: badSpecialty });
    }

    const doctor = await db.one(
      `UPDATE doctors
       SET prefix = $1, first_name = $2, last_name = $3, specialty_id = $4,
           email = $5, phone = $6, bio = $7, room = $8, active = $9
       WHERE id = $10 RETURNING *`,
      [
        fields.prefix,
        fields.first_name,
        fields.last_name,
        fields.specialty_id,
        fields.email,
        fields.phone,
        fields.bio,
        fields.room,
        fields.active,
        doc.id,
      ]
    );
    res.json({ doctor });
  })
);

/**
 * DELETE /api/admin/doctors/:id — deactivate (soft delete).
 * A hard delete would cascade away the appointment history the practice
 * reports on, so a departed physician is simply stopped from taking bookings.
 */
router.delete(
  '/doctors/:id',
  wrap(async (req, res) => {
    const doc = await db.one('SELECT id FROM doctors WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Physician not found.' });
    await db.query('UPDATE doctors SET active = false WHERE id = $1', [doc.id]);
    res.json({ ok: true, message: 'Physician deactivated.' });
  })
);

// ---------------------------------------------------------------------------
// Specialties
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/specialties — with the number of physicians in each.
 * The count is what tells the admin UI whether a specialty can be deleted
 * before it tries and gets a 409.
 */
router.get(
  '/specialties',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT s.id, s.name, s.description,
              COUNT(d.id)::int AS doctor_count
       FROM specialties s
       LEFT JOIN doctors d ON d.specialty_id = s.id
       GROUP BY s.id
       ORDER BY s.name`
    );
    res.json({ specialties: rows });
  })
);

/** POST /api/admin/specialties — add a specialty. */
router.post(
  '/specialties',
  wrap(async (req, res) => {
    const name = text((req.body || {}).name);
    const description = text((req.body || {}).description) || null;
    if (!name) {
      return res.status(400).json({ error: 'Specialty name is required.' });
    }
    try {
      const specialty = await db.one(
        'INSERT INTO specialties (name, description) VALUES ($1, $2) RETURNING *',
        [name, description]
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

/** PUT /api/admin/specialties/:id — rename a specialty or edit its description. */
router.put(
  '/specialties/:id',
  wrap(async (req, res) => {
    const body = req.body || {};
    const current = await db.one('SELECT * FROM specialties WHERE id = $1', [req.params.id]);
    if (!current) return res.status(404).json({ error: 'Specialty not found.' });

    const name = body.name !== undefined ? text(body.name) : current.name;
    const description =
      body.description !== undefined ? text(body.description) || null : current.description;
    if (!name) {
      return res.status(400).json({ error: 'Specialty name is required.' });
    }

    try {
      const specialty = await db.one(
        'UPDATE specialties SET name = $1, description = $2 WHERE id = $3 RETURNING *',
        [name, description, current.id]
      );
      res.json({ specialty });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That specialty already exists.' });
      }
      throw err;
    }
  })
);

/**
 * DELETE /api/admin/specialties/:id — only when nothing is filed under it.
 *
 * doctors.specialty_id is ON DELETE SET NULL, so letting the FK decide would
 * quietly strip the specialty off every physician who had it and drop them out
 * of specialty search. Refusing is the honest answer: reassign first.
 *
 * The guard is part of the DELETE rather than a lookup beforehand so a doctor
 * created in the gap between check and delete cannot be orphaned.
 */
router.delete(
  '/specialties/:id',
  wrap(async (req, res) => {
    const deleted = await db.one(
      `DELETE FROM specialties s
       WHERE s.id = $1
         AND NOT EXISTS (SELECT 1 FROM doctors d WHERE d.specialty_id = s.id)
       RETURNING s.id`,
      [req.params.id]
    );
    if (deleted) return res.json({ ok: true, message: 'Specialty deleted.' });

    const inUse = await db.one(
      `SELECT COUNT(*)::int AS n FROM doctors WHERE specialty_id = $1`,
      [req.params.id]
    );
    if (!inUse.n) return res.status(404).json({ error: 'Specialty not found.' });

    return res.status(409).json({
      error: `${inUse.n} physician${inUse.n === 1 ? ' is' : 's are'} still listed under this specialty. Reassign them first.`,
    });
  })
);

// ---------------------------------------------------------------------------
// Appointment oversight
// ---------------------------------------------------------------------------

const APPT_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

/** Prose form of a status, for messages that have to name where a booking is. */
const STATUS_PROSE = {
  pending: 'still pending approval',
  confirmed: 'confirmed',
  completed: 'already completed',
  cancelled: 'cancelled',
  no_show: 'recorded as a no-show',
};

/** Which statuses a target status may be reached from, and why. */
const TRANSITIONS = {
  confirmed: {
    from: ['pending'],
    rule: 'Only a pending request can be approved.',
  },
  completed: {
    from: ['confirmed'],
    rule: 'Only a confirmed appointment can be completed.',
  },
  cancelled: {
    from: ['pending', 'confirmed'],
    rule: 'Only a pending or confirmed appointment can be cancelled.',
  },
  no_show: {
    from: ['confirmed'],
    rule: 'Only a confirmed appointment can be marked as a no-show.',
  },
};

/**
 * The operational view of an appointment.
 *
 * notes are included: since B12 an admin records and amends the visit note, so
 * withholding the field would leave them editing something they cannot read.
 * patient_user_id rides along because every status change notifies the patient
 * and looking it up again per request would be a second round trip.
 */
const ADMIN_APPT_SELECT = `
  SELECT a.id, a.patient_id, a.doctor_id, a.location_id,
         a.appt_date, a.appt_time, a.reason, a.status,
         a.approved_by, a.approved_at,
         a.cancel_reason, a.cancelled_by, a.cancelled_at,
         a.reschedule_required, a.rescheduled_from_id, a.notes,
         a.created_at, a.updated_at,
         d.full_name AS doctor_name, s.name AS specialty_name,
         u.full_name AS patient_name, u.email AS patient_email,
         p.user_id AS patient_user_id,
         l.name AS location_name, l.address AS location_address
  FROM appointments a
  JOIN doctors d  ON d.id = a.doctor_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  JOIN patients p ON p.id = a.patient_id
  JOIN users u    ON u.id = p.user_id
  LEFT JOIN locations l ON l.id = a.location_id
`;

/**
 * GET /api/admin/appointments?status=&doctor_id=&location_id=&date=&from=&to=
 *
 * Ordered by soonest first: a scheduler works forwards through the day, so the
 * next appointment belongs at the top.
 */
router.get(
  '/appointments',
  wrap(async (req, res) => {
    const { status, doctor_id: doctorId, location_id: locationId, date, from, to } = req.query;
    const clauses = [];
    const params = [];

    if (status) {
      if (!APPT_STATUSES.includes(status)) {
        return res
          .status(400)
          .json({ error: `Invalid status. Expected one of: ${APPT_STATUSES.join(', ')}.` });
      }
      params.push(status);
      clauses.push(`a.status = $${params.length}`);
    }
    if (doctorId) {
      const id = parseId(doctorId);
      if (!id) return res.status(400).json({ error: 'Invalid doctor_id.' });
      params.push(id);
      clauses.push(`a.doctor_id = $${params.length}`);
    }
    if (locationId) {
      const id = parseId(locationId);
      if (!id) return res.status(400).json({ error: 'Invalid location_id.' });
      params.push(id);
      clauses.push(`a.location_id = $${params.length}`);
    }
    // `date` pins a single day; from/to bound a range. They compose, so a
    // client that sends both simply gets the intersection.
    if (date) {
      if (!isDateStr(date)) return res.status(400).json({ error: 'Invalid date.' });
      params.push(date);
      clauses.push(`a.appt_date = $${params.length}`);
    }
    if (from) {
      if (!isDateStr(from)) return res.status(400).json({ error: 'Invalid from date.' });
      params.push(from);
      clauses.push(`a.appt_date >= $${params.length}`);
    }
    if (to) {
      if (!isDateStr(to)) return res.status(400).json({ error: 'Invalid to date.' });
      params.push(to);
      clauses.push(`a.appt_date <= $${params.length}`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await db.query(
      `${ADMIN_APPT_SELECT} ${where} ORDER BY a.appt_date ASC, a.appt_time ASC, a.id ASC`,
      params
    );
    res.json({ appointments: rows });
  })
);

/**
 * PATCH /api/admin/appointments/:id/status — move a booking along its lifecycle.
 * Body: { status: 'confirmed'|'completed'|'cancelled'|'no_show', reason? }
 *
 * `confirmed` is the approval step (A1): a booking arrives as a *request* and
 * only becomes a real appointment when clinic staff accept it, which is why the
 * approving admin and the moment are stamped onto the row.
 *
 * Transitions are enforced rather than assumed. A completed visit that can be
 * re-cancelled, or a no-show recorded against a slot nobody ever confirmed, is
 * exactly the data that makes the cancellation and utilization reports lie.
 */
router.patch(
  '/appointments/:id/status',
  wrap(async (req, res) => {
    const { status, reason } = req.body || {};
    const transition = TRANSITIONS[status];
    if (!transition) {
      return res.status(400).json({
        error: `Invalid status. Expected one of: ${Object.keys(TRANSITIONS).join(', ')}.`,
      });
    }

    const appt = await db.one('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    if (!transition.from.includes(appt.status)) {
      return res.status(409).json({
        error: `This appointment is ${STATUS_PROSE[appt.status]}. ${transition.rule}`,
      });
    }
    // A reason is mandatory for the two outcomes a practice has to explain,
    // internally and to the patient.
    const why = text(reason);
    if ((status === 'cancelled' || status === 'no_show') && !why) {
      return res.status(400).json({ error: 'A reason is required to cancel or mark a no-show.' });
    }

    if (status === 'confirmed') {
      await db.query(
        `UPDATE appointments
         SET status = 'confirmed', approved_by = $2, approved_at = now(), updated_at = now()
         WHERE id = $1`,
        [appt.id, req.user.id]
      );
    } else if (status === 'cancelled') {
      // Clearing reschedule_required matters: the badge renders whatever the
      // status is, so a cancelled row would keep asking the patient to move an
      // appointment that no longer exists.
      await db.query(
        `UPDATE appointments
         SET status = 'cancelled', cancelled_by = 'practice', cancel_reason = $2,
             cancelled_at = now(), reschedule_required = false, updated_at = now()
         WHERE id = $1`,
        [appt.id, why]
      );
    } else if (status === 'no_show') {
      // The reason lands in cancel_reason on purpose: the Cancellation report
      // covers cancellations and no-shows together and reads one column for
      // both. cancelled_by/cancelled_at stay null — nobody cancelled this.
      await db.query(
        `UPDATE appointments
         SET status = 'no_show', cancel_reason = $2, updated_at = now()
         WHERE id = $1`,
        [appt.id, why]
      );
    } else {
      await db.query(
        `UPDATE appointments SET status = 'completed', updated_at = now() WHERE id = $1`,
        [appt.id]
      );
    }

    const updated = await db.one(`${ADMIN_APPT_SELECT} WHERE a.id = $1`, [appt.id]);

    if (status === 'confirmed' || status === 'cancelled') {
      await notify({
        userId: updated.patient_user_id,
        appointmentId: updated.id,
        type: status === 'confirmed' ? 'appointment_approved' : 'appointment_cancelled',
        ctx: {
          doctorName: updated.doctor_name,
          apptDate: updated.appt_date,
          apptTime: updated.appt_time,
          locationName: updated.location_name,
          cancelReason: updated.cancel_reason,
          cancelledBy: updated.cancelled_by,
        },
        channels: ['in_app', 'email', 'sms'],
      });
    }

    res.json({ appointment: updated });
  })
);

/**
 * PATCH /api/admin/appointments/:id/note — record or amend the visit note (B12).
 * Body: { notes }
 *
 * Front-desk staff take the note when a physician dictates it after clinic, and
 * they are the ones who fix a note filed against the wrong visit. An empty
 * string is accepted so a note put on the wrong appointment can be removed
 * rather than left to sit in the chart.
 */
router.patch(
  '/appointments/:id/note',
  wrap(async (req, res) => {
    const body = req.body || {};
    if (body.notes === undefined) {
      return res.status(400).json({ error: 'A note is required.' });
    }

    const updated = await db.one(
      `UPDATE appointments SET notes = $2, updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id, text(body.notes) || null]
    );
    if (!updated) return res.status(404).json({ error: 'Appointment not found.' });

    res.json({ appointment: await db.one(`${ADMIN_APPT_SELECT} WHERE a.id = $1`, [updated.id]) });
  })
);

// ---------------------------------------------------------------------------
// Doctor schedules — the weekly pattern bookable slots are generated from (A3)
// ---------------------------------------------------------------------------

const SCHEDULE_SELECT = `
  SELECT ds.id, ds.doctor_id, ds.location_id, l.name AS location_name,
         ds.weekday, ds.start_time, ds.end_time, ds.slot_minutes
  FROM doctor_schedules ds
  JOIN locations l ON l.id = ds.location_id
`;

/** GET /api/admin/doctors/:id/schedules — the doctor's week, in reading order. */
router.get(
  '/doctors/:id/schedules',
  wrap(async (req, res) => {
    const rows = await db.query(
      `${SCHEDULE_SELECT} WHERE ds.doctor_id = $1 ORDER BY ds.weekday, ds.start_time`,
      [req.params.id]
    );
    res.json({ schedules: rows });
  })
);

/**
 * POST /api/admin/doctors/:id/schedules — add a clinic window.
 * Body: { location_id, weekday, start_time, end_time, slot_minutes }
 *
 * Overlapping windows on the same weekday are refused. Slot generation expands
 * every window for the day, so two overlapping ones would offer the same clock
 * time twice — at two different sites, if their locations differ — and the
 * patient would be told to be in two buildings at once.
 *
 * The overlap test is the WHERE clause of the INSERT rather than a SELECT
 * beforehand, so two admins saving at the same moment cannot both pass it.
 * Times are zero-padded 'HH:MM', so string comparison is time comparison.
 */
router.post(
  '/doctors/:id/schedules',
  wrap(async (req, res) => {
    const doctor = await db.one('SELECT id FROM doctors WHERE id = $1', [req.params.id]);
    if (!doctor) return res.status(404).json({ error: 'Physician not found.' });

    const body = req.body || {};
    const locationId = parseId(body.location_id);
    if (!locationId) return res.status(400).json({ error: 'A location is required.' });
    const location = await db.one('SELECT id, active FROM locations WHERE id = $1', [locationId]);
    if (!location) return res.status(400).json({ error: 'Unknown location.' });
    if (!location.active) {
      return res.status(400).json({ error: 'That location is inactive.' });
    }

    const weekday = Number(body.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return res.status(400).json({ error: 'Weekday must be 0 (Sunday) through 6 (Saturday).' });
    }

    const startTime = text(body.start_time);
    const endTime = text(body.end_time);
    if (!isHHMM(startTime) || !isHHMM(endTime)) {
      return res.status(400).json({ error: 'Start and end time must be in HH:MM 24-hour format.' });
    }
    if (toMinutes(endTime) <= toMinutes(startTime)) {
      return res.status(400).json({ error: 'End time must be after start time.' });
    }

    const slotMinutes = body.slot_minutes === undefined ? 30 : Number(body.slot_minutes);
    if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
      return res.status(400).json({ error: 'Slot length must be a positive number of minutes.' });
    }
    // A window shorter than one slot generates nothing bookable, so it is a
    // mistake rather than an empty clinic.
    if (toMinutes(startTime) + slotMinutes > toMinutes(endTime)) {
      return res.status(400).json({
        error: `A ${slotMinutes}-minute slot does not fit between ${startTime} and ${endTime}.`,
      });
    }

    const inserted = await db.one(
      `INSERT INTO doctor_schedules (doctor_id, location_id, weekday, start_time, end_time, slot_minutes)
       SELECT $1::int, $2::int, $3::smallint, $4::varchar, $5::varchar, $6::int
       WHERE NOT EXISTS (
         SELECT 1 FROM doctor_schedules
         WHERE doctor_id = $1::int AND weekday = $3::smallint
           AND start_time < $5::varchar AND end_time > $4::varchar
       )
       RETURNING id`,
      [doctor.id, locationId, weekday, startTime, endTime, slotMinutes]
    );
    if (!inserted) {
      return res.status(409).json({
        error: 'That window overlaps an existing one for this physician on the same day.',
      });
    }

    const schedule = await db.one(`${SCHEDULE_SELECT} WHERE ds.id = $1`, [inserted.id]);
    res.status(201).json({ schedule });
  })
);

/**
 * DELETE /api/admin/schedules/:id — drop a clinic window.
 * Appointments already booked inside it survive: they carry their own date,
 * time, and site, so removing the pattern stops future bookings without
 * rewriting visits that are on the books. Use an availability block to clear
 * a day that is already booked.
 */
router.delete(
  '/schedules/:id',
  wrap(async (req, res) => {
    const deleted = await db.one('DELETE FROM doctor_schedules WHERE id = $1 RETURNING id', [
      req.params.id,
    ]);
    if (!deleted) return res.status(404).json({ error: 'Schedule window not found.' });
    res.json({ ok: true, message: 'Schedule window removed.' });
  })
);

// ---------------------------------------------------------------------------
// Availability blocks — dates a physician is away (A3/A11)
// ---------------------------------------------------------------------------

/** GET /api/admin/doctors/:id/blocks — most recent first; old blocks are history. */
router.get(
  '/doctors/:id/blocks',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT b.id, b.doctor_id, b.start_date, b.end_date, b.reason,
              b.created_by, b.created_at,
              u.full_name AS created_by_name
       FROM schedule_blocks b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.doctor_id = $1
       ORDER BY b.start_date DESC, b.id DESC`,
      [req.params.id]
    );
    res.json({ blocks: rows });
  })
);

/**
 * POST /api/admin/doctors/:id/blocks — mark a physician unavailable (A3/A11).
 * Body: { start_date, end_date, reason? }
 *
 * Blocking a range hides those days from patient search, but appointments
 * already sitting inside it are not cancelled: the patient keeps their place
 * and is asked to move it. The block and the flagging happen in one
 * transaction — a block that hid the days without flagging the bookings would
 * leave patients turning up to an empty clinic.
 *
 * The notifications are sent after the commit, not inside it. A message telling
 * someone to reschedule is unretractable, and a rolled-back transaction would
 * make it a lie (see the header of services/notify.js).
 */
router.post(
  '/doctors/:id/blocks',
  wrap(async (req, res) => {
    const doctor = await db.one('SELECT id FROM doctors WHERE id = $1', [req.params.id]);
    if (!doctor) return res.status(404).json({ error: 'Physician not found.' });

    const body = req.body || {};
    const startDate = text(body.start_date);
    const endDate = text(body.end_date);
    if (!isDateStr(startDate) || !isDateStr(endDate)) {
      return res.status(400).json({ error: 'Start and end date must be YYYY-MM-DD.' });
    }
    if (endDate < startDate) {
      return res.status(400).json({ error: 'End date must be on or after start date.' });
    }
    const reason = text(body.reason) || null;

    const { block, affected } = await db.tx(async (c) => {
      const inserted = await c.query(
        `INSERT INTO schedule_blocks (doctor_id, start_date, end_date, reason, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [doctor.id, startDate, endDate, reason, req.user.id]
      );

      // Only live bookings are flagged: a cancelled or completed row inside the
      // range has nothing left to move. The join pulls the recipient and the
      // wording context out of the same statement that does the flagging.
      const flagged = await c.query(
        `UPDATE appointments a
         SET reschedule_required = true, updated_at = now()
         FROM patients p, doctors d
         WHERE p.id = a.patient_id AND d.id = a.doctor_id
           AND a.doctor_id = $1
           AND a.status IN ('pending', 'confirmed')
           AND a.appt_date BETWEEN $2 AND $3
         RETURNING a.id, a.appt_date, a.appt_time,
                   p.user_id AS patient_user_id, d.full_name AS doctor_name`,
        [doctor.id, startDate, endDate]
      );

      return { block: inserted.rows[0], affected: flagged.rows };
    });

    await Promise.all(
      affected.map((appt) =>
        notify({
          userId: appt.patient_user_id,
          appointmentId: appt.id,
          type: 'reschedule_required',
          ctx: {
            doctorName: appt.doctor_name,
            apptDate: appt.appt_date,
            apptTime: appt.appt_time,
            blockReason: block.reason,
          },
          channels: ['in_app', 'email', 'sms'],
        })
      )
    );

    res.status(201).json({ block, affected: affected.length });
  })
);

/**
 * DELETE /api/admin/blocks/:id — the physician is available again.
 *
 * Lifting one block must not clear the flag wholesale: a second, overlapping
 * block may still cover some of the same appointments. Only bookings that no
 * longer fall inside ANY remaining block for that doctor stop needing to move,
 * and both statements run in one transaction so the flags can never outlive
 * the block that set them.
 */
router.delete(
  '/blocks/:id',
  wrap(async (req, res) => {
    const block = await db.one('SELECT * FROM schedule_blocks WHERE id = $1', [req.params.id]);
    if (!block) return res.status(404).json({ error: 'Availability block not found.' });

    const cleared = await db.tx(async (c) => {
      await c.query('DELETE FROM schedule_blocks WHERE id = $1', [block.id]);
      const rows = await c.query(
        `UPDATE appointments a
         SET reschedule_required = false, updated_at = now()
         WHERE a.doctor_id = $1
           AND a.reschedule_required = true
           AND NOT EXISTS (
             SELECT 1 FROM schedule_blocks b
             WHERE b.doctor_id = a.doctor_id
               AND a.appt_date BETWEEN b.start_date AND b.end_date
           )
         RETURNING a.id`,
        [block.doctor_id]
      );
      return rows.rowCount;
    });

    res.json({ ok: true, message: 'Availability block removed.', cleared });
  })
);

// ---------------------------------------------------------------------------
// Locations — the sites the practice operates (A6)
// ---------------------------------------------------------------------------

const LOCATION_LABELS = {
  name: 'Name',
  address: 'Address',
  city: 'City',
  state: 'State',
  zip: 'ZIP code',
};

/** The first required site field left blank, or null when all are filled. */
function missingLocationField(fields) {
  const key = Object.keys(LOCATION_LABELS).find((k) => !fields[k]);
  return key ? LOCATION_LABELS[key] : null;
}

/**
 * GET /api/admin/locations — every site, including inactive ones.
 * Unlike the public list, admin needs to see a closed site to reopen it and to
 * recognise it on historic appointments.
 */
router.get(
  '/locations',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT id, name, address, city, state, zip, phone, active
       FROM locations ORDER BY name`
    );
    res.json({ locations: rows });
  })
);

/** POST /api/admin/locations — open a new site. */
router.post(
  '/locations',
  wrap(async (req, res) => {
    const body = req.body || {};
    const fields = {
      name: text(body.name),
      address: text(body.address),
      city: text(body.city),
      state: text(body.state),
      zip: text(body.zip),
      phone: text(body.phone) || null,
      active: body.active === undefined ? true : !!body.active,
    };

    const missing = missingLocationField(fields);
    if (missing) return res.status(400).json({ error: `${missing} is required.` });

    try {
      const location = await db.one(
        `INSERT INTO locations (name, address, city, state, zip, phone, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [fields.name, fields.address, fields.city, fields.state, fields.zip, fields.phone, fields.active]
      );
      res.status(201).json({ location });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A location with that name already exists.' });
      }
      throw err;
    }
  })
);

/**
 * PUT /api/admin/locations/:id — edit a site, or close it with active: false.
 * Closing is a flag rather than a delete: appointments reference the site they
 * happened at, and that history has to keep resolving to a name.
 */
router.put(
  '/locations/:id',
  wrap(async (req, res) => {
    const current = await db.one('SELECT * FROM locations WHERE id = $1', [req.params.id]);
    if (!current) return res.status(404).json({ error: 'Location not found.' });

    const body = req.body || {};
    const fields = {
      name: body.name !== undefined ? text(body.name) : current.name,
      address: body.address !== undefined ? text(body.address) : current.address,
      city: body.city !== undefined ? text(body.city) : current.city,
      state: body.state !== undefined ? text(body.state) : current.state,
      zip: body.zip !== undefined ? text(body.zip) : current.zip,
      phone: body.phone !== undefined ? text(body.phone) || null : current.phone,
      active: body.active === undefined ? current.active : !!body.active,
    };

    const missing = missingLocationField(fields);
    if (missing) return res.status(400).json({ error: `${missing} is required.` });

    try {
      const location = await db.one(
        `UPDATE locations
         SET name = $1, address = $2, city = $3, state = $4, zip = $5, phone = $6, active = $7
         WHERE id = $8 RETURNING *`,
        [
          fields.name,
          fields.address,
          fields.city,
          fields.state,
          fields.zip,
          fields.phone,
          fields.active,
          current.id,
        ]
      );
      res.json({ location });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'A location with that name already exists.' });
      }
      throw err;
    }
  })
);

module.exports = router;
