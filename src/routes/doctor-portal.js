/**
 * Doctor portal routes — everything a logged-in physician does.
 *
 * Access model: a doctor sees their own schedule, and the chart of any patient
 * they share a non-cancelled appointment with (their care relationship). They
 * write visit notes on their own appointments only, prescribe, order and
 * result tests, and decide refill requests on their own prescriptions.
 *
 * Named doctor-portal.js (not doctor.js) to avoid confusion with doctors.js,
 * the public directory-browsing router.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

/** The doctors row belonging to the logged-in user, or null. */
function doctorForUser(userId) {
  return db.one(
    `SELECT d.*, s.name AS specialty_name
     FROM doctors d LEFT JOIN specialties s ON s.id = d.specialty_id
     WHERE d.user_id = $1`,
    [userId]
  );
}

/**
 * Care-relationship gate: may this doctor open this patient's chart?
 * True when they share any non-cancelled appointment. Cancelled-only pairs
 * never established care, so they don't grant access.
 */
async function treatsPatient(doctorId, patientId) {
  const row = await db.one(
    `SELECT 1 AS ok FROM appointments
     WHERE doctor_id = $1 AND patient_id = $2 AND status <> 'cancelled'
     LIMIT 1`,
    [doctorId, patientId]
  );
  return !!row;
}

/** 403 helper used by every chart-scoped route. */
function noRelationship(res) {
  return res
    .status(403)
    .json({ error: 'You can only open charts of patients under your care.' });
}

/** Attach req.doctor or fail. Doctors row is required for every route here. */
router.use(
  wrap(async (req, res, next) => {
    const doctor = await doctorForUser(req.user.id);
    if (!doctor) {
      return res.status(403).json({
        error: 'No physician profile is linked to this account. Ask an administrator.',
      });
    }
    req.doctor = doctor;
    next();
  })
);

/** GET /api/doctor/me — the logged-in physician's own profile. */
router.get(
  '/me',
  wrap(async (req, res) => {
    res.json({ doctor: req.doctor });
  })
);

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

const APPT_SELECT = `
  SELECT a.*, u.full_name AS patient_name, u.email AS patient_email,
         p.date_of_birth, p.phone AS patient_phone
  FROM appointments a
  JOIN patients p ON p.id = a.patient_id
  JOIN users u    ON u.id = p.user_id
`;

/**
 * GET /api/doctor/appointments?date=&status=
 * Own schedule, soonest-first. Defaults to everything; the UI passes a date
 * for the day view.
 */
router.get(
  '/appointments',
  wrap(async (req, res) => {
    const { date, status } = req.query;
    const clauses = ['a.doctor_id = $1'];
    const params = [req.doctor.id];
    if (date) {
      params.push(date);
      clauses.push(`a.appt_date = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`a.status = $${params.length}`);
    }
    const rows = await db.query(
      `${APPT_SELECT} WHERE ${clauses.join(' AND ')}
       ORDER BY a.appt_date ASC, a.appt_time ASC`,
      params
    );
    res.json({ appointments: rows });
  })
);

/**
 * PATCH /api/doctor/appointments/:id/complete — close out a visit.
 * Body: { note } — the clinical visit note, required. Completing a visit
 * without documenting it is exactly the corner real systems refuse to cut.
 */
router.patch(
  '/appointments/:id/complete',
  wrap(async (req, res) => {
    const note = String((req.body || {}).note || '').trim();
    if (!note) {
      return res.status(400).json({ error: 'A visit note is required to complete a visit.' });
    }
    const appt = await db.one(
      'SELECT * FROM appointments WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.doctor.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
    if (appt.status !== 'booked') {
      return res.status(409).json({ error: `This visit is already ${appt.status.replace('_', '-')}.` });
    }
    await db.query(
      `UPDATE appointments SET status = 'completed', notes = $2, updated_at = now()
       WHERE id = $1`,
      [appt.id, note]
    );
    res.json({ appointment: await db.one(`${APPT_SELECT} WHERE a.id = $1`, [appt.id]) });
  })
);

/**
 * PATCH /api/doctor/appointments/:id/note — amend the note on a completed
 * visit (addendum). Own appointments only.
 */
router.patch(
  '/appointments/:id/note',
  wrap(async (req, res) => {
    const note = String((req.body || {}).note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note cannot be empty.' });
    const appt = await db.one(
      'SELECT * FROM appointments WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.doctor.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
    if (appt.status !== 'completed') {
      return res.status(400).json({ error: 'Notes can only be written on completed visits.' });
    }
    await db.query('UPDATE appointments SET notes = $2, updated_at = now() WHERE id = $1', [
      appt.id,
      note,
    ]);
    res.json({ appointment: await db.one(`${APPT_SELECT} WHERE a.id = $1`, [appt.id]) });
  })
);

// ---------------------------------------------------------------------------
// Patients & charts
// ---------------------------------------------------------------------------

/**
 * GET /api/doctor/patients — patients under this doctor's care (shared
 * non-cancelled appointment), with their next and last visit.
 */
router.get(
  '/patients',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT p.id, u.full_name, u.email, p.date_of_birth, p.phone,
              MIN(a.appt_date) FILTER (WHERE a.status = 'booked')    AS next_visit,
              MAX(a.appt_date) FILTER (WHERE a.status = 'completed') AS last_visit,
              COUNT(a.id) FILTER (WHERE a.status <> 'cancelled')     AS visit_count
       FROM patients p
       JOIN users u ON u.id = p.user_id
       JOIN appointments a ON a.patient_id = p.id
       WHERE a.doctor_id = $1 AND a.status <> 'cancelled'
       GROUP BY p.id, u.full_name, u.email
       ORDER BY u.full_name`,
      [req.doctor.id]
    );
    res.json({ patients: rows });
  })
);

/**
 * GET /api/doctor/patients/:id/chart — the full chart, one call:
 * demographics, history, medications, results, and visit history (all
 * doctors' notes — a care team shares the record).
 */
router.get(
  '/patients/:id/chart',
  wrap(async (req, res) => {
    const patientId = Number(req.params.id);
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const profile = await db.one(
      `SELECT p.id AS patient_id, u.full_name, u.email, p.date_of_birth, p.phone,
              p.gender, p.address, p.insurance_provider
       FROM patients p JOIN users u ON u.id = p.user_id WHERE p.id = $1`,
      [patientId]
    );
    if (!profile) return res.status(404).json({ error: 'Patient not found.' });

    const [history, prescriptions, results, visits] = await Promise.all([
      db.query(
        `SELECT h.*, u.full_name AS recorded_by_name
         FROM medical_history h LEFT JOIN users u ON u.id = h.recorded_by
         WHERE h.patient_id = $1
         ORDER BY h.status ASC, h.created_at DESC`,
        [patientId]
      ),
      db.query(
        `SELECT rx.*, d.full_name AS doctor_name,
                (SELECT COUNT(*)::int FROM refill_requests r
                 WHERE r.prescription_id = rx.id AND r.status = 'pending') AS pending_refills
         FROM prescriptions rx JOIN doctors d ON d.id = rx.doctor_id
         WHERE rx.patient_id = $1
         ORDER BY (rx.status = 'active') DESC, rx.created_at DESC`,
        [patientId]
      ),
      db.query(
        `SELECT t.*, d.full_name AS doctor_name
         FROM test_results t JOIN doctors d ON d.id = t.doctor_id
         WHERE t.patient_id = $1
         ORDER BY t.ordered_at DESC`,
        [patientId]
      ),
      db.query(
        `SELECT a.id, a.appt_date, a.appt_time, a.reason, a.status, a.notes,
                d.full_name AS doctor_name, s.name AS specialty_name
         FROM appointments a
         JOIN doctors d ON d.id = a.doctor_id
         LEFT JOIN specialties s ON s.id = d.specialty_id
         WHERE a.patient_id = $1 AND a.status <> 'cancelled'
         ORDER BY a.appt_date DESC, a.appt_time DESC`,
        [patientId]
      ),
    ]);

    res.json({ chart: { profile, history, prescriptions, results, visits } });
  })
);

/**
 * POST /api/doctor/patients/:id/history — add a chart entry.
 * Body: { kind, description, severity?, noted_on? }
 */
router.post(
  '/patients/:id/history',
  wrap(async (req, res) => {
    const patientId = Number(req.params.id);
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const { kind, description, severity, noted_on } = req.body || {};
    const kinds = ['condition', 'allergy', 'surgery', 'immunization', 'family', 'other'];
    if (!kinds.includes(kind)) {
      return res.status(400).json({ error: `Kind must be one of: ${kinds.join(', ')}.` });
    }
    if (!String(description || '').trim()) {
      return res.status(400).json({ error: 'A description is required.' });
    }
    const entry = await db.one(
      `INSERT INTO medical_history
         (patient_id, kind, description, severity, noted_on, source, recorded_by)
       VALUES ($1, $2, $3, $4, $5, 'doctor', $6) RETURNING *`,
      [patientId, kind, String(description).trim(), severity || null, noted_on || null, req.user.id]
    );
    res.status(201).json({ entry });
  })
);

/**
 * PATCH /api/doctor/history/:id — mark a chart entry active/resolved.
 * Doctors can update any entry on charts they have access to (including
 * resolving a patient's self-reported condition after review).
 */
router.patch(
  '/history/:id',
  wrap(async (req, res) => {
    const entry = await db.one('SELECT * FROM medical_history WHERE id = $1', [req.params.id]);
    if (!entry) return res.status(404).json({ error: 'History entry not found.' });
    if (!(await treatsPatient(req.doctor.id, entry.patient_id))) return noRelationship(res);

    const { status } = req.body || {};
    if (!['active', 'resolved'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'active' or 'resolved'." });
    }
    const updated = await db.one(
      `UPDATE medical_history SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [entry.id, status]
    );
    res.json({ entry: updated });
  })
);

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/**
 * POST /api/doctor/patients/:id/prescriptions — prescribe.
 * Body: { medication, dosage, frequency, duration?, instructions?,
 *         refills_allowed?, appointment_id? }
 */
router.post(
  '/patients/:id/prescriptions',
  wrap(async (req, res) => {
    const patientId = Number(req.params.id);
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const {
      medication, dosage, frequency, duration, instructions, refills_allowed, appointment_id,
    } = req.body || {};
    for (const [field, value] of [['medication', medication], ['dosage', dosage], ['frequency', frequency]]) {
      if (!String(value || '').trim()) {
        return res.status(400).json({ error: `${field[0].toUpperCase() + field.slice(1)} is required.` });
      }
    }
    const refills = Number(refills_allowed ?? 0);
    if (!Number.isInteger(refills) || refills < 0 || refills > 12) {
      return res.status(400).json({ error: 'Refills must be a whole number between 0 and 12.' });
    }

    const rx = await db.one(
      `INSERT INTO prescriptions
         (patient_id, doctor_id, appointment_id, medication, dosage, frequency,
          duration, instructions, refills_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        patientId, req.doctor.id, appointment_id || null,
        String(medication).trim(), String(dosage).trim(), String(frequency).trim(),
        duration ? String(duration).trim() : null,
        instructions ? String(instructions).trim() : null,
        refills,
      ]
    );
    res.status(201).json({ prescription: rx });
  })
);

/**
 * PATCH /api/doctor/prescriptions/:id/stop — discontinue a medication.
 * Own prescriptions only; a reason is required (it lands in the record).
 */
router.patch(
  '/prescriptions/:id/stop',
  wrap(async (req, res) => {
    const reason = String((req.body || {}).reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'A reason is required to stop a medication.' });

    const rx = await db.one(
      'SELECT * FROM prescriptions WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.doctor.id]
    );
    if (!rx) return res.status(404).json({ error: 'Prescription not found.' });
    if (rx.status !== 'active') {
      return res.status(409).json({ error: `This prescription is already ${rx.status}.` });
    }
    const updated = await db.one(
      `UPDATE prescriptions
       SET status = 'stopped', stopped_reason = $2, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [rx.id, reason]
    );
    res.json({ prescription: updated });
  })
);

// ---------------------------------------------------------------------------
// Refill requests
// ---------------------------------------------------------------------------

/**
 * GET /api/doctor/refill-requests?status= — requests on this doctor's own
 * prescriptions (default: pending — the work queue).
 */
router.get(
  '/refill-requests',
  wrap(async (req, res) => {
    const status = req.query.status || 'pending';
    const rows = await db.query(
      `SELECT r.*, rx.medication, rx.dosage, rx.frequency, rx.refills_allowed, rx.refills_used,
              rx.status AS prescription_status,
              u.full_name AS patient_name, u.email AS patient_email
       FROM refill_requests r
       JOIN prescriptions rx ON rx.id = r.prescription_id
       JOIN patients p ON p.id = r.patient_id
       JOIN users u ON u.id = p.user_id
       WHERE rx.doctor_id = $1 AND r.status = $2
       ORDER BY r.created_at ASC`,
      [req.doctor.id, status]
    );
    res.json({ requests: rows });
  })
);

/**
 * PATCH /api/doctor/refill-requests/:id — approve or deny.
 * Body: { status: 'approved'|'denied', decision_note? (required on deny) }
 * Approving increments refills_used — the refill is dispensed, not banked.
 */
router.patch(
  '/refill-requests/:id',
  wrap(async (req, res) => {
    const { status, decision_note } = req.body || {};
    if (!['approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'denied'." });
    }
    if (status === 'denied' && !String(decision_note || '').trim()) {
      return res.status(400).json({
        error: 'A note to the patient is required when denying a refill.',
      });
    }

    const request = await db.one(
      `SELECT r.*, rx.doctor_id, rx.status AS rx_status
       FROM refill_requests r JOIN prescriptions rx ON rx.id = r.prescription_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!request || request.doctor_id !== req.doctor.id) {
      return res.status(404).json({ error: 'Refill request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `This request was already ${request.status}.` });
    }
    if (status === 'approved' && request.rx_status !== 'active') {
      return res.status(409).json({
        error: 'This prescription is no longer active — deny the request with a note instead.',
      });
    }

    const updated = await db.tx(async (c) => {
      const r = await c.query(
        `UPDATE refill_requests
         SET status = $2, decision_note = $3, decided_by = $4, decided_at = now()
         WHERE id = $1 RETURNING *`,
        [request.id, status, (decision_note && String(decision_note).trim()) || null, req.doctor.id]
      );
      if (status === 'approved') {
        await c.query(
          'UPDATE prescriptions SET refills_used = refills_used + 1, updated_at = now() WHERE id = $1',
          [request.prescription_id]
        );
      }
      return r.rows[0];
    });
    res.json({ request: updated });
  })
);

// ---------------------------------------------------------------------------
// Test results
// ---------------------------------------------------------------------------

/**
 * POST /api/doctor/patients/:id/test-results — order a test.
 * Body: { test_name, appointment_id? }
 */
router.post(
  '/patients/:id/test-results',
  wrap(async (req, res) => {
    const patientId = Number(req.params.id);
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const { test_name, appointment_id } = req.body || {};
    if (!String(test_name || '').trim()) {
      return res.status(400).json({ error: 'A test name is required.' });
    }
    const order = await db.one(
      `INSERT INTO test_results (patient_id, doctor_id, appointment_id, test_name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [patientId, req.doctor.id, appointment_id || null, String(test_name).trim()]
    );
    res.status(201).json({ result: order });
  })
);

/**
 * PATCH /api/doctor/test-results/:id — enter the result.
 * Body: { result_summary, result_flag: 'normal'|'abnormal'|'critical' }
 * Own orders only.
 */
router.patch(
  '/test-results/:id',
  wrap(async (req, res) => {
    const { result_summary, result_flag } = req.body || {};
    if (!String(result_summary || '').trim()) {
      return res.status(400).json({ error: 'A result summary is required.' });
    }
    if (!['normal', 'abnormal', 'critical'].includes(result_flag)) {
      return res.status(400).json({ error: "Flag must be 'normal', 'abnormal', or 'critical'." });
    }
    const order = await db.one(
      'SELECT * FROM test_results WHERE id = $1 AND doctor_id = $2',
      [req.params.id, req.doctor.id]
    );
    if (!order) return res.status(404).json({ error: 'Test order not found.' });
    if (order.status === 'completed') {
      return res.status(409).json({ error: 'This test already has a result.' });
    }
    const updated = await db.one(
      `UPDATE test_results
       SET status = 'completed', result_summary = $2, result_flag = $3, resulted_at = now()
       WHERE id = $1 RETURNING *`,
      [order.id, String(result_summary).trim(), result_flag]
    );
    res.json({ result: updated });
  })
);

module.exports = router;
