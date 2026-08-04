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
 * GET /api/doctor/reports/workload?from=&to=
 *
 * The physician's own appointments, booked hours and utilization. One row —
 * the same row the admin report shows for them, computed the same way, so the
 * two views agree by construction.
 */
router.get(
  '/workload',
  wrap(async (req, res) => {
    const range = parseRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });

    const rows = await workloadRows(range.from, range.to, req.doctor.id);
    res.json(report(rows, range.from, range.to));
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
