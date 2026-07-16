/**
 * Patient self-service routes: profile, and the patient's own view of the
 * clinical record — history, medications (+ refill requests), test results.
 *
 * Patients read their own record and contribute two things: self-reported
 * history entries (marked source='patient' so they're never mistaken for a
 * clinical diagnosis) and refill requests. Everything else is doctor-written.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('patient'));

/** The patients row for the logged-in user, or null. */
function patientForUser(userId) {
  return db.one('SELECT * FROM patients WHERE user_id = $1', [userId]);
}

const PROFILE_SELECT = `
  SELECT u.id AS user_id, u.email, u.full_name,
         p.id AS patient_id, p.date_of_birth, p.phone, p.gender,
         p.address, p.insurance_provider
  FROM users u JOIN patients p ON p.user_id = u.id
  WHERE u.id = $1
`;

/**
 * GET /api/patients/me — full profile for the logged-in patient.
 */
router.get(
  '/me',
  wrap(async (req, res) => {
    const row = await db.one(PROFILE_SELECT, [req.user.id]);
    if (!row) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile: row });
  })
);

/**
 * PUT /api/patients/me — update the logged-in patient's profile.
 */
router.put(
  '/me',
  wrap(async (req, res) => {
    const { full_name, date_of_birth, phone, gender, address, insurance_provider } =
      req.body || {};

    if (full_name !== undefined && !String(full_name).trim()) {
      return res.status(400).json({ error: 'Full name cannot be empty.' });
    }
    const validGenders = ['male', 'female', 'other', 'prefer_not_to_say'];
    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }

    await db.tx(async (c) => {
      if (full_name !== undefined) {
        await c.query('UPDATE users SET full_name = $1 WHERE id = $2', [
          String(full_name).trim(),
          req.user.id,
        ]);
      }
      await c.query(
        `UPDATE patients
         SET date_of_birth      = COALESCE($1, date_of_birth),
             phone              = COALESCE($2, phone),
             gender             = COALESCE($3, gender),
             address            = COALESCE($4, address),
             insurance_provider = COALESCE($5, insurance_provider)
         WHERE user_id = $6`,
        [
          date_of_birth ?? null,
          phone ?? null,
          gender ?? null,
          address ?? null,
          insurance_provider ?? null,
          req.user.id,
        ]
      );
    });

    const row = await db.one(PROFILE_SELECT, [req.user.id]);
    res.json({ profile: row });
  })
);

// ---------------------------------------------------------------------------
// Medical history
// ---------------------------------------------------------------------------

/** GET /api/patients/me/history — the patient's own history entries. */
router.get(
  '/me/history',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const entries = await db.query(
      `SELECT h.*, u.full_name AS recorded_by_name
       FROM medical_history h LEFT JOIN users u ON u.id = h.recorded_by
       WHERE h.patient_id = $1
       ORDER BY h.status ASC, h.created_at DESC`,
      [patient.id]
    );
    res.json({ history: entries });
  })
);

/**
 * POST /api/patients/me/history — self-report an entry.
 * Body: { kind, description, severity?, noted_on? }
 * Stored with source='patient' so it's never mistaken for a diagnosis.
 */
router.post(
  '/me/history',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const { kind, description, severity, noted_on } = req.body || {};
    const kinds = ['condition', 'allergy', 'surgery', 'immunization', 'family', 'other'];
    if (!kinds.includes(kind)) {
      return res.status(400).json({ error: `Kind must be one of: ${kinds.join(', ')}.` });
    }
    if (!String(description || '').trim()) {
      return res.status(400).json({ error: 'A description is required.' });
    }
    if (severity && !['mild', 'moderate', 'severe'].includes(severity)) {
      return res.status(400).json({ error: 'Severity must be mild, moderate, or severe.' });
    }
    const entry = await db.one(
      `INSERT INTO medical_history
         (patient_id, kind, description, severity, noted_on, source, recorded_by)
       VALUES ($1, $2, $3, $4, $5, 'patient', $6) RETURNING *`,
      [patient.id, kind, String(description).trim(), severity || null, noted_on || null, req.user.id]
    );
    res.status(201).json({ entry });
  })
);

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

/**
 * GET /api/patients/me/prescriptions — own medications, with any open refill
 * request attached so the UI can show "requested" instead of the button.
 */
router.get(
  '/me/prescriptions',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const rows = await db.query(
      `SELECT rx.*, d.full_name AS doctor_name,
              r.id     AS open_request_id,
              r.status AS open_request_status,
              lastr.status        AS last_request_status,
              lastr.decision_note AS last_request_note
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       LEFT JOIN refill_requests r
         ON r.prescription_id = rx.id AND r.status = 'pending'
       LEFT JOIN LATERAL (
         SELECT status, decision_note FROM refill_requests
         WHERE prescription_id = rx.id AND status <> 'pending'
         ORDER BY decided_at DESC NULLS LAST LIMIT 1
       ) lastr ON true
       WHERE rx.patient_id = $1
       ORDER BY (rx.status = 'active') DESC, rx.created_at DESC`,
      [patient.id]
    );
    res.json({ prescriptions: rows });
  })
);

/**
 * POST /api/patients/me/prescriptions/:id/refill-request
 * Body: { note? } — ask the prescriber for a refill.
 */
router.post(
  '/me/prescriptions/:id/refill-request',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const rx = await db.one(
      'SELECT * FROM prescriptions WHERE id = $1 AND patient_id = $2',
      [req.params.id, patient.id]
    );
    if (!rx) return res.status(404).json({ error: 'Prescription not found.' });
    if (rx.status !== 'active') {
      return res.status(400).json({ error: 'Only active medications can be refilled.' });
    }

    const note = String((req.body || {}).note || '').trim();
    try {
      const request = await db.one(
        `INSERT INTO refill_requests (prescription_id, patient_id, note)
         VALUES ($1, $2, $3) RETURNING *`,
        [rx.id, patient.id, note || null]
      );
      return res.status(201).json({ request });
    } catch (err) {
      // Partial unique index: one pending request per prescription.
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'A refill request for this medication is already waiting on your doctor.',
        });
      }
      throw err;
    }
  })
);

// ---------------------------------------------------------------------------
// Test results
// ---------------------------------------------------------------------------

/**
 * GET /api/patients/me/test-results — own results, newest first. Ordered
 * tests appear too (as pending) so the patient knows what's coming.
 */
router.get(
  '/me/test-results',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });
    const rows = await db.query(
      `SELECT t.*, d.full_name AS doctor_name
       FROM test_results t JOIN doctors d ON d.id = t.doctor_id
       WHERE t.patient_id = $1
       ORDER BY t.ordered_at DESC`,
      [patient.id]
    );
    res.json({ results: rows });
  })
);

module.exports = router;
