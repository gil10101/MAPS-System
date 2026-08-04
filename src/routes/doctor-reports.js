/**
 * Physician reporting — the A5 reports a doctor may run on their own work.
 *
 * Mounted at /api/doctor/reports, ahead of the portal router so these paths are
 * not swallowed by it. Paths here are relative.
 *
 * The SQL is not reimplemented: the row builders come from admin-reports.js and
 * are called with this physician's id. Copying the queries would let the two
 * copies drift, and the failure that produces is a doctor and an administrator
 * looking at different utilization figures for the same fortnight with no way
 * to tell which one is wrong.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  dailyAppointmentRows,
  workloadRows,
  patientVisitRows,
  parseDay,
  parseRange,
  parsePatientId,
  report,
} = require('./admin-reports');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

/**
 * Resolve the physician behind the login and pin them to the request.
 *
 * Scope comes from req.doctor.id and nothing else. There is deliberately no
 * doctor_id query param on these routes: with no client-supplied identifier to
 * tamper with, one physician cannot ask for another's numbers even by
 * accident, and the scoping cannot be forgotten in a later handler.
 */
router.use(
  wrap(async (req, res, next) => {
    const doctor = await db.one('SELECT id FROM doctors WHERE user_id = $1', [req.user.id]);
    if (!doctor) {
      return res.status(403).json({
        error: 'No physician profile is linked to this account. Ask an administrator.',
      });
    }
    req.doctor = doctor;
    return next();
  })
);

/**
 * GET /api/doctor/reports/daily-appointments?date=
 * This physician's own book for one day, in time order. Defaults to today.
 */
router.get(
  '/daily-appointments',
  wrap(async (req, res) => {
    const day = parseDay(req.query);
    if (day.error) return res.status(400).json({ error: day.error });

    const rows = await dailyAppointmentRows(day.date, req.doctor.id);
    res.json(report(rows, day.date, day.date));
  })
);

/**
 * The chart behind the workload report: one headline block and one point per
 * day the physician had anything on the book.
 *
 * This is the exception to the "no SQL in this file" rule at the top, and it is
 * a deliberate one. There is no admin counterpart to share with — the clinic
 * report is a table of physicians, this is one physician's own shape over time
 * — so there is no second copy for it to drift from. What the two reports do
 * share, the per-physician row, still comes from workloadRows.
 *
 * The counts here deliberately span every status, including the two that
 * workloadRows excludes from "booked" (a pending request nobody approved, a
 * cancelled slot that went back on sale). That is why they are reported as
 * named statuses instead of a single number: `totals.pending + totals.confirmed
 * + ...` will not equal the table's `appointments` figure, and it should not —
 * the table measures committed practice time, this measures what happened to
 * everything that was asked for.
 *
 * `patients` is a distinct count over that same set. A patient booked four
 * times in a fortnight is one person on the physician's panel, which is the
 * question the tile answers; summing appointments answers a different one, and
 * both are on screen together.
 *
 * by_day carries only the four resolved-or-live outcomes the chart plots. Days
 * with nothing on the book produce no row: the range can be a quarter, and
 * padding it with empty weekends would put more zeroes than data through the
 * wire for a chart that reads better with gaps left as gaps.
 */
async function workloadChart(doctorId, from, to) {
  const params = [doctorId, from, to];
  const [totals, byDay] = await Promise.all([
    db.one(
      `SELECT COUNT(DISTINCT a.patient_id)::int                  AS patients,
              COUNT(*) FILTER (WHERE a.status = 'pending')::int   AS pending,
              COUNT(*) FILTER (WHERE a.status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE a.status = 'no_show')::int   AS no_show
       FROM appointments a
       WHERE a.doctor_id = $1 AND a.appt_date BETWEEN $2::date AND $3::date`,
      params
    ),
    db.query(
      `SELECT a.appt_date AS date,
              COUNT(*) FILTER (WHERE a.status = 'completed')::int AS completed,
              COUNT(*) FILTER (WHERE a.status = 'confirmed')::int AS confirmed,
              COUNT(*) FILTER (WHERE a.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE a.status = 'no_show')::int   AS no_show
       FROM appointments a
       WHERE a.doctor_id = $1 AND a.appt_date BETWEEN $2::date AND $3::date
       GROUP BY a.appt_date
       ORDER BY a.appt_date`,
      params
    ),
  ]);

  return { totals, by_day: byDay };
}

/**
 * GET /api/doctor/reports/workload?from=&to=
 *
 * The physician's own appointments, booked hours and utilization. One row —
 * the same row the admin report shows for them, computed the same way, so the
 * two views agree by construction.
 *
 * `totals` and `by_day` are added alongside the standard { rows, meta }
 * envelope rather than folded into it: the table component and the CSV exporter
 * read `rows` and nothing else, so the chart's data has to arrive as extra keys
 * or it would turn into columns nobody asked for in every exported file.
 */
router.get(
  '/workload',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const [rows, chart] = await Promise.all([
      workloadRows(range.from, range.to, req.doctor.id),
      workloadChart(req.doctor.id, range.from, range.to),
    ]);

    res.json({ ...report(rows, range.from, range.to), ...chart });
  })
);

/**
 * GET /api/doctor/reports/patient-visits?patient_id=&from=&to=
 *
 * The one report that carries clinical notes, and the only place the UI
 * exposes it (contract §3): the admin screens are operational and deliberately
 * have no patient-records browser.
 *
 * Two gates, not one. The care-relationship check answers "may this physician
 * look at this patient at all", and passing a patient_id they have never seen
 * is a 403 rather than an empty table — an empty result would still confirm
 * that the id exists. The row query is then scoped to this doctor as well, so
 * what comes back is the encounters they were part of and not the rest of the
 * patient's chart with other providers.
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
       FROM patients p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1
         AND EXISTS (SELECT 1 FROM appointments a
                     WHERE a.patient_id = p.id
                       AND a.doctor_id = $2
                       AND a.status <> 'cancelled')`,
      [asked.patientId, req.doctor.id]
    );
    if (!patient) {
      return res
        .status(403)
        .json({ error: 'You can only report on patients under your care.' });
    }

    const rows = await patientVisitRows(asked.patientId, range.from, range.to, req.doctor.id);

    // The patient's name is meta, not a repeated column: it is the same on
    // every row and belongs in the report header and the CSV filename.
    res.json(
      report(rows, range.from, range.to, {
        patient_id: patient.id,
        patient_name: patient.full_name,
      })
    );
  })
);

module.exports = router;
