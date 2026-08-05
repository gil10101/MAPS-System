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
const {
  toMinutes, countSlotsInRange, isSlotAvailable, resolveSlotLocation,
} = require('../utils/slots');
// "Booked" has one definition in this system and it lives with the reports.
// Re-declaring it here is how a profile page and the Provider Utilization
// report end up quoting different numbers for the same physician.
const { BOOKED_STATUSES } = require('./admin-reports');

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

/** Slot start times are stored as 'HH:MM' strings, so they validate as text. */
function isTimeStr(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Today in the clinic's own timezone — a UTC round-trip would shift the day. */
function todayStr() {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
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
// Physician detail — the whole profile page in one round trip
// ---------------------------------------------------------------------------

/** How much history the profile's booked/utilization figures cover. */
/**
 * How far back the utilization figure on a physician's profile looks.
 *
 * A rolling week rather than a month: utilization is read to decide who to move
 * work to *now*, and a month-long average is slow to react to the fortnight a
 * provider was on leave or covering a colleague. It also keeps this figure
 * comparable with the Doctor Workload report, which practices run weekly.
 */
const STATS_WINDOW_DAYS = 7;

/** Percentage to one decimal, divide-by-zero safe. Same math as the reports. */
function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

/** One decimal — used for hours. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Date -> 'YYYY-MM-DD' from local parts. toISOString() would be UTC and can
 * land on the wrong calendar day for anyone west of Greenwich, which would
 * shift the whole reporting window by a day.
 */
function statsDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 'Aug 12, 2026 at 9:30 AM' — the visit a feed line is about.
 *
 * Formatted server-side because the activity summary is a finished sentence,
 * not fields the client lays out. Parsed at noon for the same reason slots.js
 * does it: midnight lets a negative UTC offset roll the date back a day.
 */
function whenPhrase(dateStr, timeStr) {
  const day = new Date(`${dateStr}T12:00:00`);
  const date = Number.isNaN(day.getTime())
    ? String(dateStr)
    : day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const [h, m] = String(timeStr || '')
    .split(':')
    .map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return date;
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${date} at ${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * One activity line as prose.
 *
 * Built in JS rather than in the union's SQL: the cancellation wording branches
 * on who cancelled and on whether a reason was recorded, and the CASE
 * expression that spells that out is unreadable next to the copy it produces.
 * The patient is the subject of every line so the feed says who each event
 * happened to, not just that something happened.
 */
function activitySummary(row) {
  const when = whenPhrase(row.appt_date, row.appt_time);
  const patient = row.patient_name;

  switch (row.kind) {
    case 'approved':
      return `${patient}'s appointment on ${when} was approved`;
    case 'completed':
      return `${patient}'s visit on ${when} was completed`;
    case 'cancelled': {
      // 'unknown' contributes nothing: naming a canceller the record does not
      // actually identify would be an invention.
      const by =
        row.cancelled_by === 'patient'
          ? ' by the patient'
          : row.cancelled_by === 'practice'
            ? ' by the practice'
            : '';
      const why = row.cancel_reason ? ` — ${row.cancel_reason}` : '';
      return `${patient}'s appointment on ${when} was cancelled${by}${why}`;
    }
    default:
      return `${patient} did not attend on ${when}`;
  }
}

/**
 * The physician's activity feed, newest first.
 *
 * A union over the timestamp columns the appointment itself carries — there is
 * no events table and inventing one would mean a second source of truth for
 * things the appointment already records.
 *
 * Completions and non-attendance fall back to updated_at because the schema has
 * no completed_at: those outcomes are a status flip, and the row's last write
 * is the closest honest answer. A note amended afterwards moves that timestamp,
 * which is the known cost of not having a per-event log; it is recorded here
 * rather than papered over with a guess.
 *
 * The outcome branches key on `status`, not on which timestamp happens to be
 * filled in. A no-show is expected to leave cancelled_at null, but rows exist
 * where it is set, and reading cancelled_at as "this was cancelled" would list
 * one visit twice under two contradicting outcomes. Status is what the visit
 * *is*; the timestamps only say when.
 *
 * The union carries ids only and the details are joined on once outside it,
 * instead of repeating the patient join in all four branches.
 */
const ACTIVITY_FEED = `
  WITH events AS (
    SELECT id, approved_at AS at, 'approved'::text AS kind
    FROM appointments WHERE doctor_id = $1 AND approved_at IS NOT NULL
    UNION ALL
    SELECT id, updated_at, 'completed'
    FROM appointments WHERE doctor_id = $1 AND status = 'completed'
    UNION ALL
    SELECT id, cancelled_at, 'cancelled'
    FROM appointments
    WHERE doctor_id = $1 AND status = 'cancelled' AND cancelled_at IS NOT NULL
    UNION ALL
    SELECT id, updated_at, 'no_show'
    FROM appointments WHERE doctor_id = $1 AND status = 'no_show'
  )
  SELECT e.at, e.kind,
         a.appt_date, a.appt_time, a.cancel_reason, a.cancelled_by,
         u.full_name AS patient_name
  FROM events e
  JOIN appointments a ON a.id = e.id
  JOIN patients p     ON p.id = a.patient_id
  JOIN users u        ON u.id = p.user_id
  ORDER BY e.at DESC
  LIMIT 15
`;

/**
 * GET /api/admin/doctors/:id/detail — everything the physician profile shows.
 * Returns { doctor, stats, recent_appointments, recent_activity }.
 *
 * One endpoint rather than four: the page has no use for a third of itself, and
 * four calls are four chances to render half-loaded.
 *
 * utilization_pct is built on countSlotsInRange — the same denominator the
 * Provider Utilization report and patient-facing availability use. Counting
 * capacity here with its own SQL is exactly how this page and that report would
 * come to disagree about the same fortnight with no way to tell which is right.
 */
router.get(
  '/doctors/:id/detail',
  wrap(async (req, res) => {
    // Inactive sites are kept in `locations`, unlike the patient-facing
    // directory: an admin needs to see a window still pointing at a building
    // the practice has closed, because that is the thing to go and fix.
    const doctor = await db.one(
      `SELECT d.*, s.name AS specialty_name, u.email AS login_email,
              COALESCE((
                SELECT jsonb_agg(
                         jsonb_build_object('id', site.id, 'name', site.name, 'city', site.city)
                         ORDER BY site.name)
                FROM (
                  SELECT DISTINCT l.id, l.name, l.city
                  FROM doctor_schedules ds
                  JOIN locations l ON l.id = ds.location_id
                  WHERE ds.doctor_id = d.id
                ) site
              ), '[]'::jsonb) AS locations
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN users u ON u.id = d.user_id
       WHERE d.id = $1`,
      [req.params.id]
    );
    if (!doctor) return res.status(404).json({ error: 'Physician not found.' });

    // Inclusive window ending today, so "30 days" is 30 dates and not 31.
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - (STATS_WINDOW_DAYS - 1));
    const from = statsDateStr(windowStart);
    const to = statsDateStr(new Date());

    const [counts, booked, capacity, recentAppointments, activity] = await Promise.all([
      // Lifetime status counts — the same reading as the Overview's
      // physician-utilization panel. `patients` counts completed visits only:
      // a booking that never happened did not make someone a patient seen.
      db.one(
        `SELECT COUNT(*)                                     AS total,
                COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
                COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE status = 'no_show')   AS no_show,
                COUNT(*) FILTER (WHERE status = 'confirmed'
                                   AND appt_date >= CURRENT_DATE) AS upcoming,
                COUNT(DISTINCT patient_id) FILTER (WHERE status = 'completed') AS patients
         FROM appointments
         WHERE doctor_id = $1`,
        [doctor.id]
      ),
      // Booked hours cannot be derived from a count: a 15-minute follow-up and
      // a 45-minute new-patient visit are one appointment each. Each row is
      // joined back to the window covering its weekday and start time to
      // recover the slot length it was booked at, exactly as the Doctor
      // Workload report does. The join is LEFT and falls back to 30 minutes
      // because the schedule may have been narrowed or deleted since — a past
      // visit must still contribute hours rather than drop out of the sum.
      db.one(
        `SELECT COUNT(a.id) AS appointments,
                COALESCE(SUM(COALESCE(w.slot_minutes, 30)), 0) AS booked_minutes
         FROM appointments a
         LEFT JOIN LATERAL (
           SELECT ds.slot_minutes
           FROM doctor_schedules ds
           WHERE ds.doctor_id = a.doctor_id
             AND ds.weekday   = EXTRACT(DOW FROM a.appt_date)::int
             AND a.appt_time >= ds.start_time
             AND a.appt_time <  ds.end_time
           ORDER BY ds.start_time
           LIMIT 1
         ) w ON true
         WHERE a.doctor_id = $1
           AND a.appt_date BETWEEN $2::date AND $3::date
           AND a.status = ANY($4::text[])`,
        [doctor.id, from, to, BOOKED_STATUSES]
      ),
      countSlotsInRange(doctor.id, from, to),
      // Newest first by the visit's own date and time, so the top of the list
      // is where this physician's book currently is — anything still ahead of
      // them included.
      db.query(
        `SELECT a.id, a.appt_date, a.appt_time, a.status,
                u.full_name AS patient_name,
                l.name      AS location_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         JOIN users u    ON u.id = p.user_id
         LEFT JOIN locations l ON l.id = a.location_id
         WHERE a.doctor_id = $1
         ORDER BY a.appt_date DESC, a.appt_time DESC, a.id DESC
         LIMIT 10`,
        [doctor.id]
      ),
      db.query(ACTIVITY_FEED, [doctor.id]),
    ]);

    res.json({
      doctor,
      stats: {
        total: counts.total,
        pending: counts.pending,
        confirmed: counts.confirmed,
        completed: counts.completed,
        cancelled: counts.cancelled,
        no_show: counts.no_show,
        upcoming: counts.upcoming,
        patients: counts.patients,
        booked_hours: round1(booked.booked_minutes / 60),
        // Left uncapped above 100%, as in the utilization report: it means
        // visits exist outside the schedule this doctor currently publishes,
        // and clamping it would erase the discrepancy worth looking at.
        utilization_pct: pct(booked.appointments, capacity),
        // The window is reported with the figures it produced — a "last 30
        // days" number with no dates on it is uncitable a week later.
        window_from: from,
        window_to: to,
      },
      recent_appointments: recentAppointments,
      recent_activity: activity.map((row) => ({
        at: row.at,
        kind: row.kind,
        summary: activitySummary(row),
      })),
    });
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
 * Transitions that are real, but are not an administrator's to make — and who
 * owns them.
 *
 * Kept apart from TRANSITIONS so the refusal can name the role that may do it.
 * Folding `completed` in with genuinely unknown statuses would answer 400
 * "invalid status", which reads as a client bug rather than as the rule it is,
 * and would leave an admin retrying a request that can never succeed.
 */
const NOT_ADMINS_TO_MAKE = {
  completed:
    'Only the treating physician can complete a visit. Completion is the doctor recording that they saw the patient, which the practice office has no way to know — ask them to close it out from their portal.',
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
 * Body: { status: 'confirmed'|'cancelled'|'no_show', reason? }
 *
 * `confirmed` is the approval step (A1): a booking arrives as a *request* and
 * only becomes a real appointment when clinic staff accept it, which is why the
 * approving admin and the moment are stamped onto the row.
 *
 * `completed` is deliberately not here. Marking a visit complete is a clinical
 * assertion — the physician stating they saw the patient — and it is the row
 * every utilization and workload figure is built on. An administrator can see
 * that a slot came and went, not that a consultation happened, so the
 * transition belongs to the doctor's portal and is refused here with a 403
 * naming them.
 *
 * The remaining transitions are enforced rather than assumed. A cancelled visit
 * that can be re-cancelled, or a no-show recorded against a slot nobody ever
 * confirmed, is exactly the data that makes the cancellation and utilization
 * reports lie.
 */
router.patch(
  '/appointments/:id/status',
  wrap(async (req, res) => {
    const { status, reason } = req.body || {};

    // Checked ahead of the transition table: this is a permission answer, not a
    // validation one, and the caller needs to be told who to go to instead.
    if (NOT_ADMINS_TO_MAKE[status]) {
      return res.status(403).json({ error: NOT_ADMINS_TO_MAKE[status] });
    }

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
    } else {
      // no_show. The reason lands in cancel_reason on purpose: the Cancellation
      // report covers cancellations and no-shows together and reads one column
      // for both. cancelled_by/cancelled_at stay null — nobody cancelled this.
      await db.query(
        `UPDATE appointments
         SET status = 'no_show', cancel_reason = $2, updated_at = now()
         WHERE id = $1`,
        [appt.id, why]
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

/**
 * PATCH /api/admin/appointments/:id/reschedule — move a booking to a new slot.
 * Body: { appt_date, appt_time }
 *
 * The front desk moves appointments on the patient's behalf all day: somebody
 * rings, cannot make Thursday, and the person answering should be able to fix
 * it while they are still on the line rather than cancelling and asking them to
 * rebook online.
 *
 * Mechanically identical to the patient's own reschedule, and deliberately so —
 * the original row is superseded rather than edited, the replacement re-enters
 * the queue as `pending`, and `rescheduled_from_id` links the pair. The one
 * difference is attribution: `cancelled_by` records the practice, because the
 * Cancellation report should not show a clinic-initiated move as the patient
 * changing their mind.
 */
router.patch(
  '/appointments/:id/reschedule',
  wrap(async (req, res) => {
    const appt = await db.one(
      `SELECT a.id, a.patient_id, a.doctor_id, a.appt_date, a.appt_time, a.reason, a.status,
              p.user_id AS patient_user_id
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    if (!['pending', 'confirmed'].includes(appt.status)) {
      return res.status(409).json({
        error: `Only an upcoming appointment can be rescheduled — this one is ${
          STATUS_PROSE[appt.status] || appt.status
        }.`,
      });
    }

    const { appt_date: date, appt_time: time } = req.body || {};
    if (!isDateStr(date) || !isTimeStr(time)) {
      return res.status(400).json({ error: 'A new date and time are required.' });
    }
    if (date < todayStr()) {
      return res.status(400).json({ error: 'Cannot move an appointment to a date in the past.' });
    }
    // The slot would otherwise read as taken by this very appointment.
    if (date === appt.appt_date && time === appt.appt_time) {
      return res.status(400).json({ error: 'That is the time this appointment already has.' });
    }
    if (!(await isSlotAvailable(appt.doctor_id, date, time))) {
      return res.status(409).json({ error: 'That time is no longer open. Pick another slot.' });
    }

    const locationId = await resolveSlotLocation(appt.doctor_id, date, time);

    let createdId;
    try {
      createdId = await db.tx(async (client) => {
        // Insert before cancelling: the replacement has to clear the
        // double-book index while the original still holds its slot, so a
        // collision fails before the patient has given up the time they have.
        const inserted = await client.query(
          `INSERT INTO appointments
             (patient_id, doctor_id, location_id, appt_date, appt_time, reason,
              status, rescheduled_from_id, reschedule_required)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, false)
           RETURNING id`,
          [appt.patient_id, appt.doctor_id, locationId, date, time, appt.reason, appt.id]
        );

        const superseded = await client.query(
          // The reason is settable because the front desk moves a booking for
          // more than one kind of reason, and the Cancellation report reads
          // this column: recording every clinic-initiated move as "at patient
          // request" would hide the ones the practice caused itself. It
          // defaults to the patient's request because that is the ordinary
          // case — somebody rang and asked.
          `UPDATE appointments
              SET status = 'cancelled', cancelled_by = 'practice',
                  cancel_reason = $2,
                  cancelled_at = now(), reschedule_required = false, updated_at = now()
            WHERE id = $1 AND status IN ('pending', 'confirmed')`,
          [appt.id, text(req.body?.reason) || 'Rescheduled at patient request']
        );
        if (superseded.rowCount === 0) {
          const conflict = new Error('That appointment changed while you were rescheduling it.');
          conflict.status = 409;
          throw conflict;
        }

        return inserted.rows[0].id;
      });
    } catch (err) {
      if (err.status === 409) return res.status(409).json({ error: err.message });
      if (err.code === '23505') {
        return res.status(409).json({ error: 'That time was just taken. Pick another slot.' });
      }
      throw err;
    }

    const created = await db.one(`${ADMIN_APPT_SELECT} WHERE a.id = $1`, [createdId]);

    await notify({
      userId: appt.patient_user_id,
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
 * An appointment "falls inside" a weekly window when it is still live, its date
 * is today or later, its weekday matches, and its start time sits in the
 * window. Expects $1 = doctor id, $2 = weekday, $3 = start_time, $4 = end_time,
 * with the row aliased `a`.
 *
 * Half-open on end_time to match slot generation (slots.js expandWindow stops
 * at start + slot <= end), so a visit starting exactly at end_time was never a
 * slot this window produced and is not this window's to disturb.
 *
 * Past dates are excluded deliberately: a visit that already happened is
 * history, and flagging it would ask a patient to move an appointment they
 * have already attended. One predicate serves both the impact count and the
 * delete so the warning can never describe a different set from the one the
 * delete actually touches.
 */
const IN_WINDOW = `
  a.status IN ('pending', 'confirmed')
  AND a.appt_date >= CURRENT_DATE
  AND EXTRACT(DOW FROM a.appt_date)::int = $2::int
  AND a.appt_time >= $3::varchar
  AND a.appt_time <  $4::varchar
`;

/**
 * GET /api/admin/schedules/:id/impact — how many live appointments sit inside
 * this window. The UI calls it before deleting so the admin is warned with a
 * number rather than finding out afterwards.
 */
router.get(
  '/schedules/:id/impact',
  wrap(async (req, res) => {
    const clinicWindow = await db.one(
      'SELECT doctor_id, weekday, start_time, end_time FROM doctor_schedules WHERE id = $1',
      [req.params.id]
    );
    if (!clinicWindow) return res.status(404).json({ error: 'Schedule window not found.' });

    const { affected } = await db.one(
      `SELECT COUNT(*)::int AS affected
       FROM appointments a
       WHERE a.doctor_id = $1 AND ${IN_WINDOW}`,
      [
        clinicWindow.doctor_id,
        clinicWindow.weekday,
        clinicWindow.start_time,
        clinicWindow.end_time,
      ]
    );
    res.json({ affected });
  })
);

/**
 * DELETE /api/admin/schedules/:id — drop a clinic window.
 *
 * Appointments already booked inside it are not deleted — no foreign key ties
 * them to the window, and a visit on the books is not the practice's to erase.
 * They are flagged instead. Left alone they would be orphaned: the visit still
 * exists and still shows on the physician's day, at a time they no longer hold
 * clinic, with nothing anywhere surfacing the contradiction. A silent
 * inconsistency is worse than a visible failure, so this behaves like the
 * availability-block endpoint — the patient keeps their place and is asked to
 * move it.
 *
 * The delete and the flagging share one transaction: a window that vanished
 * without flagging its bookings would leave patients turning up to an empty
 * clinic. The notifications are sent after the commit, not inside it — a
 * message telling someone to reschedule is unretractable, and a rolled-back
 * transaction would make it a lie (see the header of services/notify.js).
 */
router.delete(
  '/schedules/:id',
  wrap(async (req, res) => {
    const affected = await db.tx(async (c) => {
      // Deleting first and reading the window's shape out of RETURNING means
      // the flagging is driven by captured values, so it cannot depend on the
      // row it just removed still being visible.
      const removed = await c.query(
        `DELETE FROM doctor_schedules WHERE id = $1
         RETURNING doctor_id, weekday, start_time, end_time`,
        [req.params.id]
      );
      const clinicWindow = removed.rows[0];
      if (!clinicWindow) return null;

      // The join pulls the recipient and the wording context out of the same
      // statement that does the flagging.
      const flagged = await c.query(
        `UPDATE appointments a
         SET reschedule_required = true, updated_at = now()
         FROM patients p, doctors d
         WHERE p.id = a.patient_id AND d.id = a.doctor_id
           AND a.doctor_id = $1 AND ${IN_WINDOW}
         RETURNING a.id, a.appt_date, a.appt_time,
                   p.user_id AS patient_user_id, d.full_name AS doctor_name`,
        [
          clinicWindow.doctor_id,
          clinicWindow.weekday,
          clinicWindow.start_time,
          clinicWindow.end_time,
        ]
      );
      return flagged.rows;
    });

    if (!affected) return res.status(404).json({ error: 'Schedule window not found.' });

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
            // The reschedule wording asks for a reason the patient can read;
            // "the doctor's window was deleted" is internal vocabulary, and
            // what it means to them is that the clinic hours changed.
            blockReason: 'the clinic hours for that day changed',
          },
          channels: ['in_app', 'email', 'sms'],
        })
      )
    );

    res.json({ ok: true, affected: affected.length });
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

// ---------------------------------------------------------------------------
// Patients — the scheduling view of a person, and nothing more
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/patients/:id — who the clinic is scheduling, and their book.
 *
 * Deliberately scheduling data only. An administrator gets the demographics
 * and insurance they need to book and bill a visit, and the list of visits
 * themselves, and stops there: `appointments.notes` is not selected, and no
 * prescription is read. That is the same need-to-know rule that keeps a patient
 * records browser out of the admin menu — an administrator may record a note
 * against one appointment they are administering, but nothing here assembles a
 * clinical history for them to read.
 *
 * The appointment list is the whole book rather than a page of it: a patient
 * has tens of visits, not thousands, and the profile is opened precisely to see
 * the pattern across all of them.
 */
router.get(
  '/patients/:id',
  wrap(async (req, res) => {
    const patient = await db.one(
      `SELECT p.id, p.date_of_birth, p.gender, p.address, p.insurance_provider,
              p.created_at,
              u.id AS user_id, u.full_name, u.first_name, u.last_name,
              u.email, u.phone, u.notify_email, u.notify_sms
       FROM patients p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const appointments = await db.query(
      `SELECT a.id, a.appt_date, a.appt_time, a.status, a.reason,
              a.cancel_reason, a.cancelled_by, a.reschedule_required,
              d.id AS doctor_id, d.full_name AS doctor_name,
              s.name AS specialty_name,
              l.name AS location_name
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN locations l   ON l.id = a.location_id
       WHERE a.patient_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [patient.id]
    );

    // Counted here rather than in the browser so the figures cannot disagree
    // with the list they summarise.
    const counts = await db.one(
      `SELECT COUNT(*)::int                                       AS total,
              COUNT(*) FILTER (WHERE status = 'pending')::int     AS pending,
              COUNT(*) FILTER (WHERE status = 'confirmed')::int   AS confirmed,
              COUNT(*) FILTER (WHERE status = 'completed')::int   AS completed,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int   AS cancelled,
              COUNT(*) FILTER (WHERE status = 'no_show')::int     AS no_show
       FROM appointments WHERE patient_id = $1`,
      [patient.id]
    );

    res.json({ patient, appointments, counts });
  })
);

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
