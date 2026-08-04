/**
 * Admin reporting — MediSync's five operational reports (A5), plus the three
 * Overview metrics the admin dashboard has always used.
 *
 * Mounted at /api/admin/reports, so every path in this file is relative.
 *
 * Two response shapes live here on purpose. The five §3 reports all return
 * { rows, meta } so a single table component and a single CSV exporter can
 * render any of them without knowing which report they were handed. The three
 * Overview endpoints (/summary, /physician-utilization, /volume-by-specialty)
 * are not that shape — they are dashboard tiles, not tables — so each answers
 * the object the Overview page reads, keyed the way every other list route in
 * the API is keyed (`doctors`, `specialties`).
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');
const { countSlotsInRange } = require('../utils/slots');

const router = express.Router();

// Reporting is clinic-wide data; gate the whole router.
router.use(requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------------
// Shared vocabulary
// ---------------------------------------------------------------------------

/**
 * The statuses that actually consumed a slot on a doctor's book.
 *
 * 'pending' is out because a request nobody has approved yet is not committed
 * practice time. 'cancelled' is out because the slot went back on sale.
 * 'no_show' is in: the time was held and then burned, which is precisely what
 * a practice measures itself on.
 *
 * Every report that says "booked" means exactly this set — utilization's
 * numerator, workload's appointment count and workload's booked_hours all read
 * it, so those figures can never disagree about what they are counting.
 */
const BOOKED_STATUSES = ['confirmed', 'completed', 'no_show'];

// ---------------------------------------------------------------------------
// Dates, rounding, envelope
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Missing or whitespace-only query param. */
function blank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Date -> 'YYYY-MM-DD' from local parts. toISOString() would be UTC and can
 *  land on the wrong calendar day for anyone west of Greenwich. */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Well-formed AND a real calendar date.
 *
 * The round trip is the point: JS does not reject an overflowing day, it rolls
 * it over, so '2026-02-31' parses happily as 3 March. Comparing the parts back
 * catches that. Letting it through would either hand Postgres a date it throws
 * on, or — worse — quietly answer for a day nobody asked about.
 */
function isDateStr(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(y, m - 1, d, 12);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

/**
 * Resolve ?date=, defaulting to today.
 * @returns {{date: string}|{error: string}}
 */
function parseDay(query) {
  const date = blank(query.date) ? toDateStr(new Date()) : String(query.date).trim();
  if (!isDateStr(date)) return { error: 'Invalid date. Use YYYY-MM-DD.' };
  return { date };
}

/**
 * Resolve ?from=&to=, defaulting to the current calendar month.
 *
 * The bare URL has to answer something useful, and "this month" is what a
 * report is opened for far more often than any hand-typed range. Malformed
 * input is rejected rather than quietly swapped for the default: a report that
 * answers a different question than the one asked is worse than an error.
 *
 * @returns {{from: string, to: string}|{error: string}}
 */
function parseRange(query) {
  const now = new Date();
  const monthStart = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
  // Day 0 of next month is the last day of this one — leap years included.
  const monthEnd = toDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0));

  const from = blank(query.from) ? monthStart : String(query.from).trim();
  const to = blank(query.to) ? monthEnd : String(query.to).trim();

  if (!isDateStr(from) || !isDateStr(to)) {
    return { error: 'Invalid date range. Use YYYY-MM-DD for "from" and "to".' };
  }
  // 'YYYY-MM-DD' sorts lexicographically, so a string compare is a date compare.
  if (from > to) return { error: '"from" must be on or before "to".' };
  return { from, to };
}

/**
 * The envelope every report returns.
 *
 * `generated_at` is stamped server-side because these tables get exported to
 * CSV and mailed around: a figure with no "as of" is uncitable a week later.
 * Single-day reports pass the same date as from and to so the shared client
 * table and CSV exporter never have to special-case them.
 */
function report(rows, from, to, extra = {}) {
  return { rows, meta: { from, to, generated_at: new Date().toISOString(), ...extra } };
}

/** Percentage to one decimal, divide-by-zero safe. Matches the Overview math. */
function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

/** One decimal — used for hours. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

// ---------------------------------------------------------------------------
// Shared row builders
//
// doctor-reports.js imports these and passes its own doctor id, so a physician
// and the clinic read the same numbers out of the same SQL.
// ---------------------------------------------------------------------------

/**
 * Bookable-slot capacity for each row's doctor, over the range.
 *
 * This is what makes utilization real instead of a proxy: countSlotsInRange
 * expands the doctor's weekly windows across the range and drops the days they
 * are blocked out, so a physician on leave is not scored against slots they
 * never offered. It is also the same function patient-facing availability is
 * built on — a denominator computed with its own private SQL would drift from
 * what patients can actually book, and the percentage would become fiction.
 *
 * One call per doctor is a deliberate trade: a practice has tens of
 * physicians, and sharing the slot definition is worth more than the round
 * trips it costs.
 */
function slotCapacities(rows, from, to) {
  return Promise.all(rows.map((row) => countSlotsInRange(row.doctor_id, from, to)));
}

/**
 * Daily Appointment report — one date's book.
 *
 * Cancelled and no-show rows stay in: the day sheet records what was on the
 * book, and a slot handed back is information the front desk needs rather than
 * noise. `reschedule_required` rides along so this table can honour the badge
 * rule that "Needs rescheduling" outranks the status badge.
 *
 * @param {string} date 'YYYY-MM-DD'
 * @param {number|null} doctorId one physician, or null for the whole clinic
 */
function dailyAppointmentRows(date, doctorId = null) {
  return db.query(
    `SELECT a.id, a.appt_time, a.status, a.reschedule_required,
            u.full_name AS patient_name,
            d.full_name AS doctor_name,
            s.name      AS specialty_name,
            l.name      AS location_name
     FROM appointments a
     JOIN patients p ON p.id = a.patient_id
     JOIN users u    ON u.id = p.user_id
     JOIN doctors d  ON d.id = a.doctor_id
     LEFT JOIN specialties s ON s.id = d.specialty_id
     LEFT JOIN locations l   ON l.id = a.location_id
     WHERE a.appt_date = $1::date
       AND ($2::int IS NULL OR a.doctor_id = $2::int)
     ORDER BY a.appt_time, d.last_name, u.last_name`,
    [date, doctorId]
  );
}

/**
 * Doctor Workload report — appointments, hours and utilization per physician.
 *
 * booked_hours cannot be derived from a count: a 15-minute dermatology follow
 * up and a 45-minute new-patient visit are one appointment each and nothing
 * like one hour each. Each appointment is therefore joined back to the
 * doctor_schedules window covering its weekday and start time to recover the
 * slot length it was booked at. That join is LEFT and falls back to 30 minutes
 * because the schedule may have been narrowed or deleted since — a past visit
 * must still contribute hours rather than silently drop out of the sum.
 *
 * Doctors with an empty book are kept (LEFT JOIN) so they read as 0%, not as a
 * missing row. Inactive doctors are dropped unless they worked inside the
 * range, which is the only thing that still makes them part of it.
 *
 * @param {number|null} doctorId one physician, or null for the whole clinic
 */
async function workloadRows(from, to, doctorId = null) {
  const rows = await db.query(
    `SELECT d.id AS doctor_id, d.full_name AS doctor_name, s.name AS specialty_name,
            COUNT(a.id) AS appointments,
            COALESCE(SUM(COALESCE(w.slot_minutes, 30))
                     FILTER (WHERE a.id IS NOT NULL), 0) AS booked_minutes
     FROM doctors d
     LEFT JOIN specialties s ON s.id = d.specialty_id
     LEFT JOIN appointments a
            ON a.doctor_id = d.id
           AND a.appt_date BETWEEN $1::date AND $2::date
           AND a.status = ANY($3::text[])
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
     WHERE ($4::int IS NULL OR d.id = $4::int)
       AND (d.active = true OR a.id IS NOT NULL)
     GROUP BY d.id, s.name
     ORDER BY d.last_name, d.first_name`,
    [from, to, BOOKED_STATUSES, doctorId]
  );

  const capacity = await slotCapacities(rows, from, to);
  return rows.map((row, i) => ({
    doctor_id: row.doctor_id,
    doctor_name: row.doctor_name,
    specialty_name: row.specialty_name,
    appointments: row.appointments,
    booked_hours: round1(row.booked_minutes / 60),
    utilization_pct: pct(row.appointments, capacity[i]),
  }));
}

/**
 * Patient Visit History report — one patient's visits over the range.
 *
 * Cancelled and no-show rows stay in: a history that quietly drops the visits
 * that did not happen is not a history, and "booked three times, attended
 * once" is exactly the pattern this report is opened to find.
 *
 * @param {number} patientId
 * @param {number|null} doctorId restrict to one physician's own encounters.
 *   The doctor portal passes its own id so a physician sees the visits they
 *   were part of and not the rest of the patient's chart; admin passes null.
 */
function patientVisitRows(patientId, from, to, doctorId = null) {
  return db.query(
    `SELECT a.id, a.appt_date, a.appt_time, a.status, a.notes,
            d.full_name AS doctor_name,
            s.name      AS specialty_name,
            l.name      AS location_name
     FROM appointments a
     JOIN doctors d ON d.id = a.doctor_id
     LEFT JOIN specialties s ON s.id = d.specialty_id
     LEFT JOIN locations l   ON l.id = a.location_id
     WHERE a.patient_id = $1
       AND a.appt_date BETWEEN $2::date AND $3::date
       AND ($4::int IS NULL OR a.doctor_id = $4::int)
     ORDER BY a.appt_date, a.appt_time`,
    [patientId, from, to, doctorId]
  );
}

/**
 * Validate ?patient_id=. Required, never defaulted: there is no sensible "all
 * patients" reading of a visit history, and defaulting to one would dump every
 * chart note in the practice into a CSV.
 * @returns {{patientId: number}|{error: string}}
 */
function parsePatientId(query) {
  const patientId = Number(query.patient_id);
  if (!Number.isInteger(patientId) || patientId <= 0) {
    return { error: 'A patient_id is required for this report.' };
  }
  return { patientId };
}

// ---------------------------------------------------------------------------
// Overview metrics (the admin dashboard's own endpoints)
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/reports/summary — headline operational metrics, all time.
 *
 * The old `unconfirmed` count is gone. Confirmation used to be a second axis
 * the patient drove; approval is now a stage of the one status axis and
 * belongs to clinic staff, so the number staff act on is simply how many
 * requests are waiting on them.
 *
 * `appointments` is keyed by the status values themselves so the Overview can
 * walk its status list and index straight into the counts. A prose alias like
 * `pending_approval` would force a second mapping table whose only job is to
 * undo this one, and that table is where a renamed status goes to rot.
 */
router.get(
  '/summary',
  wrap(async (req, res) => {
    const totals = await db.one(
      `SELECT
         COUNT(*)                                     AS total,
         COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
         COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
         COUNT(*) FILTER (WHERE status = 'no_show')   AS no_show
       FROM appointments`
    );

    const total = totals.total || 0;
    const cancelled = totals.cancelled || 0;
    const noShow = totals.no_show || 0;
    const completed = totals.completed || 0;

    // No-show rate is measured against appointments that actually came due
    // (kept + missed), not against every row ever created — future bookings
    // haven't had the chance to be missed yet, and including them would dilute
    // the rate toward zero. Cancellations are excluded: a slot given back with
    // notice is a different failure from one silently burned.
    const arrivedOrMissed = completed + noShow;

    const patients = (await db.one(`SELECT COUNT(*) AS n FROM users WHERE role = 'patient'`)).n;
    const activeDoctors = (
      await db.one('SELECT COUNT(*) AS n FROM doctors WHERE active = true')
    ).n;

    res.json({
      appointments: {
        total,
        pending: totals.pending || 0,
        confirmed: totals.confirmed || 0,
        completed,
        cancelled,
        no_show: noShow,
      },
      cancellation_rate: pct(cancelled, total),
      no_show_rate: pct(noShow, arrivedOrMissed),
      total_patients: patients,
      active_doctors: activeDoctors,
    });
  })
);

/**
 * GET /api/admin/reports/physician-utilization — appointment counts per doctor.
 *
 * `upcoming` now means everything still live on the book, which is both halves
 * of the open state: a pending request has not been approved yet but it is
 * holding the slot, so leaving it out would understate the day ahead.
 * Busiest-first, because this is the dashboard's "who is carrying the clinic"
 * panel; last name only breaks ties.
 */
router.get(
  '/physician-utilization',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT d.id, d.full_name, s.name AS specialty_name,
              COUNT(a.id)                                       AS total_appointments,
              COUNT(a.id) FILTER (WHERE a.status = 'completed') AS completed,
              COUNT(a.id) FILTER (WHERE a.status = 'cancelled') AS cancelled,
              COUNT(a.id) FILTER (WHERE a.status = 'no_show')   AS no_show,
              COUNT(a.id) FILTER (WHERE a.status = 'pending')   AS pending,
              COUNT(a.id) FILTER (WHERE a.status IN ('pending', 'confirmed')) AS upcoming
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN appointments a ON a.doctor_id = d.id
       WHERE d.active = true
       GROUP BY d.id, s.name
       ORDER BY total_appointments DESC, d.last_name, d.first_name`
    );
    res.json({ doctors: rows });
  })
);

/** GET /api/admin/reports/volume-by-specialty — appointment volume per specialty. */
router.get(
  '/volume-by-specialty',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT COALESCE(s.name, 'Unassigned') AS specialty_name,
              COUNT(a.id) AS total_appointments
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       LEFT JOIN specialties s ON s.id = d.specialty_id
       GROUP BY s.id, s.name
       ORDER BY total_appointments DESC, specialty_name`
    );
    res.json({ specialties: rows });
  })
);

// ---------------------------------------------------------------------------
// The five reports
// ---------------------------------------------------------------------------

/**
 * GET /api/admin/reports/daily-appointments?date=
 * The whole clinic's book for one day, in time order. Defaults to today.
 */
router.get(
  '/daily-appointments',
  wrap(async (req, res) => {
    const day = parseDay(req.query);
    if (day.error) return res.status(400).json({ error: day.error });

    const rows = await dailyAppointmentRows(day.date);
    res.json(report(rows, day.date, day.date));
  })
);

/**
 * GET /api/admin/reports/workload?from=&to=
 * Appointments, booked hours and real utilization per physician.
 */
router.get(
  '/workload',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const rows = await workloadRows(range.from, range.to);
    res.json(report(rows, range.from, range.to));
  })
);

/**
 * GET /api/admin/reports/patient-visits?patient_id=&from=&to=
 *
 * One patient's visits in date order. Unlike the other four this report is
 * about a person rather than a period, so patient_id is required — there is no
 * sensible "all patients" reading of a visit history, and defaulting to one
 * would dump every chart note in the practice into a CSV.
 *
 * This is the one report carrying clinical notes. It is admin-reachable
 * because the report specification puts it here, but the UI surfaces it inside
 * the doctor portal only (see doctor-reports.js) — the operational admin
 * screens deliberately have no patient-records browser.
 */
router.get(
  '/patient-visits',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const asked = parsePatientId(req.query);
    if (asked.error) return res.status(400).json({ error: asked.error });

    const patient = await db.one(
      `SELECT p.id, u.full_name
       FROM patients p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [asked.patientId]
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const rows = await patientVisitRows(asked.patientId, range.from, range.to);

    // The patient's name is meta, not a repeated column: it is the same on
    // every row and belongs in the report header and CSV filename.
    res.json(
      report(rows, range.from, range.to, {
        patient_id: patient.id,
        patient_name: patient.full_name,
      })
    );
  })
);

/**
 * GET /api/admin/reports/cancellations?from=&to=
 *
 * Every lost slot in the range, with the structured reason the cancel flow
 * captures. No-shows sit alongside cancellations because both are the same
 * loss to the practice and the interesting comparison is between them: a
 * cancellation gave notice and the slot could be resold, a no-show burned it.
 *
 * cancelled_by and cancelled_at are null on no-show rows — nobody cancelled
 * anything, the patient simply never arrived — while cancel_reason is set by
 * the staff member marking the outcome.
 *
 * Newest first: this table is read as a log of what just went wrong, and the
 * most recent losses are the ones still worth a phone call.
 */
router.get(
  '/cancellations',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const rows = await db.query(
      `SELECT a.id, a.appt_date, a.appt_time, a.status,
              a.cancel_reason, a.cancelled_by, a.cancelled_at,
              u.full_name AS patient_name,
              d.full_name AS doctor_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN users u    ON u.id = p.user_id
       JOIN doctors d  ON d.id = a.doctor_id
       WHERE a.status IN ('cancelled', 'no_show')
         AND a.appt_date BETWEEN $1::date AND $2::date
       ORDER BY a.appt_date DESC, a.appt_time DESC, d.last_name`,
      [range.from, range.to]
    );
    res.json(report(rows, range.from, range.to));
  })
);

/**
 * GET /api/admin/reports/utilization?from=&to=
 *
 * Capacity against consumption per physician: how many slots the published
 * schedule offered, how many of them were taken, and how the taken ones ended.
 *
 * The status counts are drawn from every appointment in the range, not just
 * the booked ones, which is why `cancelled` is reported next to a figure it is
 * deliberately excluded from — the cancelled column explains the gap between
 * capacity and slots_booked instead of hiding inside it.
 *
 * A figure above 100% is left uncapped and is real signal, not a rounding
 * artefact: it means appointments exist outside the schedule the doctor
 * currently publishes, usually because a window was narrowed or removed after
 * those visits were booked. Clamping it would erase the discrepancy the
 * scheduler needs to see.
 */
router.get(
  '/utilization',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const rows = await db.query(
      `SELECT d.id AS doctor_id, d.full_name AS doctor_name, s.name AS specialty_name,
              COUNT(a.id) FILTER (WHERE a.status = ANY($3::text[])) AS slots_booked,
              COUNT(a.id) FILTER (WHERE a.status = 'completed')     AS completed,
              COUNT(a.id) FILTER (WHERE a.status = 'cancelled')     AS cancelled,
              COUNT(a.id) FILTER (WHERE a.status = 'no_show')       AS no_show
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       LEFT JOIN appointments a
              ON a.doctor_id = d.id
             AND a.appt_date BETWEEN $1::date AND $2::date
       WHERE d.active = true OR a.id IS NOT NULL
       GROUP BY d.id, s.name
       ORDER BY d.last_name, d.first_name`,
      [range.from, range.to, BOOKED_STATUSES]
    );

    const capacity = await slotCapacities(rows, range.from, range.to);
    const out = rows.map((row, i) => ({
      doctor_id: row.doctor_id,
      doctor_name: row.doctor_name,
      specialty_name: row.specialty_name,
      slots_available: capacity[i],
      slots_booked: row.slots_booked,
      utilization_pct: pct(row.slots_booked, capacity[i]),
      completed: row.completed,
      cancelled: row.cancelled,
      no_show: row.no_show,
    }));

    res.json(report(out, range.from, range.to));
  })
);

module.exports = router;

// Shared with doctor-reports.js, which serves these same two reports scoped to
// a single physician. Hung off the router because app.js mounts this module
// directly — exporting a { router, ... } object instead would break the mount.
Object.assign(module.exports, {
  BOOKED_STATUSES,
  dailyAppointmentRows,
  workloadRows,
  patientVisitRows,
  parseDay,
  parseRange,
  parsePatientId,
  report,
});
