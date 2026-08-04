/**
 * Patient self-service routes: the profile spanning users + patients, and the
 * patient's own view of their medications.
 *
 * Patients read their record and contribute exactly one thing to it: a refill
 * request. Everything clinical is doctor-written, which is why nothing here
 * writes to prescriptions or appointments.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('patient'));

const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'];

/** The patients row for the logged-in user, or null. */
function patientForUser(userId) {
  return db.one('SELECT * FROM patients WHERE user_id = $1', [userId]);
}

/** Optional text: missing or blank is stored as NULL, never as ''. */
function textOrNull(value) {
  return String(value ?? '').trim() || null;
}

/**
 * The profile is one object to the client but two rows in the database: name,
 * contact details, and reminder preferences belong to the person (users);
 * demographics belong to their patient record.
 */
const PROFILE_SELECT = `
  SELECT u.id AS user_id, u.email, u.first_name, u.last_name, u.full_name,
         u.phone, u.notify_email, u.notify_sms,
         p.id AS patient_id, p.date_of_birth, p.gender, p.address,
         p.insurance_provider
  FROM users u JOIN patients p ON p.user_id = u.id
  WHERE u.id = $1
`;

/**
 * GET /api/patients/me — full profile for the logged-in patient.
 */
router.get(
  '/me',
  wrap(async (req, res) => {
    const profile = await db.one(PROFILE_SELECT, [req.user.id]);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile });
  })
);

/**
 * PUT /api/patients/me — update the logged-in patient's profile.
 * Body: { first_name, last_name, phone, notify_email, notify_sms,
 *         date_of_birth, gender, address, insurance_provider }
 *
 * Both tables are written in one transaction so the profile can never end up
 * half-saved. Fields the client omits keep their stored value; fields sent
 * empty are a deliberate clear — COALESCE in the UPDATE could not tell those
 * two cases apart, so the current row is re-read under lock and merged here.
 * full_name is generated in the database and is never written.
 */
router.put(
  '/me',
  wrap(async (req, res) => {
    const body = req.body || {};
    const {
      first_name, last_name, phone, notify_email, notify_sms,
      date_of_birth, gender, address, insurance_provider,
    } = body;

    if (first_name !== undefined && !String(first_name).trim()) {
      return res.status(400).json({ error: 'First name cannot be empty.' });
    }
    if (last_name !== undefined && !String(last_name).trim()) {
      return res.status(400).json({ error: 'Last name cannot be empty.' });
    }
    if (gender !== undefined && textOrNull(gender) && !GENDERS.includes(gender)) {
      return res.status(400).json({ error: 'Invalid gender value.' });
    }

    const profile = await db.tx(async (c) => {
      const current = (
        await c.query(
          `SELECT u.first_name, u.last_name, u.phone, u.notify_email, u.notify_sms,
                  p.date_of_birth, p.gender, p.address, p.insurance_provider
           FROM users u JOIN patients p ON p.user_id = u.id
           WHERE u.id = $1
           FOR UPDATE`,
          [req.user.id]
        )
      ).rows[0];
      if (!current) return null;

      const keep = (value, stored) => (value === undefined ? stored : textOrNull(value));
      const keepFlag = (value, stored) =>
        value === undefined || value === null ? stored : Boolean(value);

      await c.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, phone = $3,
             notify_email = $4, notify_sms = $5
         WHERE id = $6`,
        [
          first_name === undefined ? current.first_name : String(first_name).trim(),
          last_name === undefined ? current.last_name : String(last_name).trim(),
          keep(phone, current.phone),
          keepFlag(notify_email, current.notify_email),
          keepFlag(notify_sms, current.notify_sms),
          req.user.id,
        ]
      );

      await c.query(
        `UPDATE patients
         SET date_of_birth = $1, gender = $2, address = $3, insurance_provider = $4
         WHERE user_id = $5`,
        [
          keep(date_of_birth, current.date_of_birth),
          keep(gender, current.gender),
          keep(address, current.address),
          keep(insurance_provider, current.insurance_provider),
          req.user.id,
        ]
      );

      return (await c.query(PROFILE_SELECT, [req.user.id])).rows[0];
    });

    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    res.json({ profile });
  })
);

// ---------------------------------------------------------------------------
// Medications
// ---------------------------------------------------------------------------

/**
 * GET /api/patients/me/prescriptions — own medications, newest active first.
 *
 * Each row carries the state of its refill conversation so the UI never has to
 * fetch per medication: `open_request` is the request still waiting on the
 * prescriber (at most one — the partial unique index enforces it), and
 * `last_decision` is how the previous request ended, which is what explains a
 * denial to the patient.
 */
router.get(
  '/me/prescriptions',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const rows = await db.query(
      `SELECT rx.*, d.full_name AS doctor_name,
              open_r.payload AS open_request,
              last_r.payload AS last_decision
       FROM prescriptions rx
       JOIN doctors d ON d.id = rx.doctor_id
       LEFT JOIN LATERAL (
         SELECT to_jsonb(r) AS payload
         FROM refill_requests r
         WHERE r.prescription_id = rx.id AND r.status = 'pending'
       ) open_r ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
                  'status', r.status, 'decision_note', r.decision_note
                ) AS payload
         FROM refill_requests r
         WHERE r.prescription_id = rx.id AND r.status <> 'pending'
         ORDER BY r.decided_at DESC NULLS LAST, r.id DESC
         LIMIT 1
       ) last_r ON true
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
 *
 * The duplicate check is the database's partial unique index rather than a
 * read-then-write here, so a double-tapped button cannot open two requests.
 */
router.post(
  '/me/prescriptions/:id/refill-request',
  wrap(async (req, res) => {
    const patient = await patientForUser(req.user.id);
    if (!patient) return res.status(404).json({ error: 'Patient profile not found.' });

    const rx = await db.one('SELECT * FROM prescriptions WHERE id = $1 AND patient_id = $2', [
      req.params.id,
      patient.id,
    ]);
    if (!rx) return res.status(404).json({ error: 'Prescription not found.' });
    if (rx.status !== 'active') {
      return res.status(400).json({ error: 'Only active medications can be refilled.' });
    }

    try {
      const request = await db.one(
        `INSERT INTO refill_requests (prescription_id, patient_id, note)
         VALUES ($1, $2, $3) RETURNING *`,
        [rx.id, patient.id, textOrNull((req.body || {}).note)]
      );
      return res.status(201).json({ request });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'A refill request for this medication is already waiting on your doctor.',
        });
      }
      throw err;
    }
  })
);

module.exports = router;
