/**
 * Doctor portal routes — everything a logged-in physician does in MediSync.
 *
 * Access model: a physician sees their own schedule, and the chart of any
 * patient they share a non-cancelled appointment with (their care
 * relationship). Every route resolves the doctors row from the token and
 * filters on it, so one physician can never read another's patients or
 * schedule even by guessing ids.
 *
 * Scope: scheduling, visit notes, medications and refills. Problem lists and
 * lab results are not part of this product — the chart is demographics,
 * visits, and medications.
 *
 * Named doctor-portal.js (not doctor.js) to avoid confusion with doctors.js,
 * the public directory-browsing router. Reports live in doctor-reports.js.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { notify } = require('../services/notify');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireRole('doctor'));

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Staff-facing status wording (contract §1). Error copy uses the same labels
 * the physician sees on the badge, so a refusal names the state they are
 * looking at rather than a raw enum value.
 */
const STAFF_STATUS_LABEL = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: "Didn't attend",
};

/** Route params are strings; anything that isn't a positive integer is a 404. */
function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** The doctors row belonging to the logged-in user, or null. */
function doctorForUser(userId) {
  return db.one(
    `SELECT d.id, d.user_id, d.prefix, d.first_name, d.last_name, d.full_name,
            d.specialty_id, s.name AS specialty_name
     FROM doctors d
     LEFT JOIN specialties s ON s.id = d.specialty_id
     WHERE d.user_id = $1`,
    [userId]
  );
}

/**
 * Care-relationship gate: may this doctor open this patient's chart?
 * True when they share any non-cancelled appointment. A pair whose only
 * booking was cancelled never established care, so it grants nothing.
 */
async function treatsPatient(doctorId, patientId) {
  const row = await db.one(
    `SELECT 1 AS ok FROM appointments
     WHERE doctor_id = $1 AND patient_id = $2 AND status <> 'cancelled'
     LIMIT 1`,
    [doctorId, patientId]
  );
  return Boolean(row);
}

/** 403 helper used by every chart-scoped route. */
function noRelationship(res) {
  return res
    .status(403)
    .json({ error: 'You can only open charts of patients under your care.' });
}

/**
 * Attach req.doctor or fail. Every route below is scoped to this row, so a
 * doctor account with no directory entry has nothing it could legally read.
 */
router.use(
  wrap(async (req, res, next) => {
    const doctor = await doctorForUser(req.user.id);
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
 * GET /api/doctor/me — the logged-in physician's own directory entry.
 *
 * Carries `locations` (the sites they actually hold clinic at, derived from
 * their weekly schedule) so the portal renders the same doctor shape the
 * public directory does instead of a second, thinner one.
 */
router.get(
  '/me',
  wrap(async (req, res) => {
    const doctor = await db.one(
      `SELECT d.id, d.prefix, d.first_name, d.last_name, d.full_name,
              d.specialty_id, s.name AS specialty_name,
              d.email, d.phone, d.bio, d.room, d.active, d.user_id,
              COALESCE((
                SELECT json_agg(
                         json_build_object('id', l.id, 'name', l.name, 'city', l.city)
                         ORDER BY l.name
                       )
                FROM locations l
                WHERE EXISTS (
                  SELECT 1 FROM doctor_schedules ds
                  WHERE ds.doctor_id = d.id AND ds.location_id = l.id
                )
              ), '[]'::json) AS locations
       FROM doctors d
       LEFT JOIN specialties s ON s.id = d.specialty_id
       WHERE d.id = $1`,
      [req.doctor.id]
    );
    res.json({ doctor });
  })
);

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Appointment rows as staff see them: the patient's name and contact details
 * (a physician looking at their day needs to know who is coming) plus the
 * site, because a doctor can hold clinic in more than one building in a week.
 * `notes` is included — visit notes are staff-only and never leave this shape
 * for a patient-facing route.
 */
const APPT_SELECT = `
  SELECT a.id, a.patient_id, a.doctor_id, a.location_id,
         a.appt_date, a.appt_time, a.reason, a.status,
         a.reschedule_required, a.cancel_reason, a.cancelled_by, a.cancelled_at,
         a.approved_at, a.rescheduled_from_id, a.notes, a.created_at,
         u.full_name AS patient_name, u.email AS patient_email, u.phone AS patient_phone,
         p.date_of_birth,
         l.name AS location_name,
         d.full_name AS doctor_name, s.name AS specialty_name
  FROM appointments a
  JOIN patients p    ON p.id = a.patient_id
  JOIN users u       ON u.id = p.user_id
  JOIN doctors d     ON d.id = a.doctor_id
  LEFT JOIN specialties s ON s.id = d.specialty_id
  LEFT JOIN locations l   ON l.id = a.location_id
`;

/**
 * GET /api/doctor/appointments?date=&from=&to=
 *
 * Own schedule, soonest first. `date` answers the day view; `from`/`to` answer
 * the week view and the range a report page hands over. `date` wins when both
 * are sent, because a single day is the narrower ask.
 */
router.get(
  '/appointments',
  wrap(async (req, res) => {
    const { date, from, to } = req.query;
    for (const [name, value] of [['date', date], ['from', from], ['to', to]]) {
      if (value !== undefined && !DATE_RE.test(String(value))) {
        return res.status(400).json({ error: `${name} must be a date in YYYY-MM-DD format.` });
      }
    }

    const clauses = ['a.doctor_id = $1'];
    const params = [req.doctor.id];
    if (date) {
      params.push(date);
      clauses.push(`a.appt_date = $${params.length}`);
    } else {
      if (from) {
        params.push(from);
        clauses.push(`a.appt_date >= $${params.length}`);
      }
      if (to) {
        params.push(to);
        clauses.push(`a.appt_date <= $${params.length}`);
      }
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
 * Body: { notes } — the clinical visit note, required.
 *
 * Only a `confirmed` appointment can be completed. A `pending` one is still a
 * request nobody approved, and a visit that was never put on the books cannot
 * have happened; letting it jump straight to completed would also skip the
 * approval the whole booking flow exists to record.
 *
 * Completing without documenting is the corner real systems refuse to cut, so
 * the note is a hard requirement rather than a prompt.
 */
router.patch(
  '/appointments/:id/complete',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Appointment not found.' });

    const notes = String((req.body || {}).notes || '').trim();
    if (!notes) {
      return res.status(400).json({ error: 'A visit note is required to complete a visit.' });
    }

    const appt = await db.one(
      `SELECT a.id, a.status, a.appt_date, a.appt_time,
              u.id AS patient_user_id, l.name AS location_name
       FROM appointments a
       JOIN patients p ON p.id = a.patient_id
       JOIN users u    ON u.id = p.user_id
       LEFT JOIN locations l ON l.id = a.location_id
       WHERE a.id = $1 AND a.doctor_id = $2`,
      [id, req.doctor.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });

    if (appt.status !== 'confirmed') {
      const message =
        appt.status === 'pending'
          ? 'This visit is still pending approval. Clinic staff have to confirm it before it can be completed.'
          : `This visit is already recorded as ${STAFF_STATUS_LABEL[appt.status]}.`;
      return res.status(409).json({ error: message });
    }

    await db.query(
      `UPDATE appointments
       SET status = 'completed', notes = $2, updated_at = now()
       WHERE id = $1`,
      [appt.id, notes]
    );

    // Side effect, not a condition: notify() swallows its own failures so a
    // tray insert can never undo a completed visit.
    await notify({
      userId: appt.patient_user_id,
      appointmentId: appt.id,
      type: 'appointment_completed',
      ctx: {
        doctorName: req.doctor.full_name,
        apptDate: appt.appt_date,
        apptTime: appt.appt_time,
        locationName: appt.location_name,
      },
    });

    res.json({ appointment: await db.one(`${APPT_SELECT} WHERE a.id = $1`, [appt.id]) });
  })
);

/**
 * PATCH /api/doctor/appointments/:id/note — amend the visit note afterwards.
 * Body: { notes }. Own appointments only.
 *
 * Allowed once the encounter has resolved (`completed`, or `no_show` where the
 * note records what happened instead). A note on a visit that has not taken
 * place yet is not an amendment, it is a guess.
 */
router.patch(
  '/appointments/:id/note',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Appointment not found.' });

    const notes = String((req.body || {}).notes || '').trim();
    if (!notes) return res.status(400).json({ error: 'A note cannot be empty.' });

    const appt = await db.one(
      'SELECT id, status FROM appointments WHERE id = $1 AND doctor_id = $2',
      [id, req.doctor.id]
    );
    if (!appt) return res.status(404).json({ error: 'Appointment not found.' });
    if (!['completed', 'no_show'].includes(appt.status)) {
      return res.status(409).json({
        error: 'A visit note can only be written once the visit has been closed out.',
      });
    }

    await db.query('UPDATE appointments SET notes = $2, updated_at = now() WHERE id = $1', [
      appt.id,
      notes,
    ]);
    res.json({ appointment: await db.one(`${APPT_SELECT} WHERE a.id = $1`, [appt.id]) });
  })
);

// ---------------------------------------------------------------------------
// Patients & charts
// ---------------------------------------------------------------------------

/**
 * GET /api/doctor/patients — patients under this doctor's care.
 *
 * `visit_count` and `last_visit` both count `completed` appointments only: a
 * booking that was never attended is not a visit, and counting anything wider
 * would let the two figures contradict each other. `next_visit` takes pending
 * requests as well as confirmed bookings, because the physician's list is
 * "who is coming", and a request awaiting approval is still expected.
 *
 * Sorted by last name — the order a clinic list is read in.
 */
router.get(
  '/patients',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT p.id AS patient_id, u.full_name, u.first_name, u.last_name,
              u.email, u.phone, p.date_of_birth,
              COUNT(*) FILTER (WHERE a.status = 'completed')::int AS visit_count,
              MAX(a.appt_date) FILTER (WHERE a.status = 'completed') AS last_visit,
              MIN(a.appt_date) FILTER (
                WHERE a.status IN ('pending', 'confirmed') AND a.appt_date >= CURRENT_DATE
              ) AS next_visit
       FROM patients p
       JOIN users u ON u.id = p.user_id
       JOIN appointments a ON a.patient_id = p.id
       WHERE a.doctor_id = $1 AND a.status <> 'cancelled'
       GROUP BY p.id, u.id
       ORDER BY u.last_name, u.first_name`,
      [req.doctor.id]
    );
    res.json({ patients: rows });
  })
);

/**
 * GET /api/doctor/patients/:id/chart — the chart in one call:
 * demographics, this doctor's visits with the patient, and medications.
 *
 * `visits` is scoped to this physician (their own encounters, including
 * cancelled ones so the history is not silently edited), while
 * `prescriptions` is every prescriber's: a care team has to see the whole
 * medication list to prescribe safely. Stopping one is still restricted to
 * whoever wrote it.
 */
router.get(
  '/patients/:id/chart',
  wrap(async (req, res) => {
    const patientId = parseId(req.params.id);
    if (!patientId) return res.status(404).json({ error: 'Patient not found.' });
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const patient = await db.one(
      `SELECT p.id AS patient_id, u.full_name, u.first_name, u.last_name,
              u.email, u.phone, p.date_of_birth, p.gender, p.address, p.insurance_provider
       FROM patients p JOIN users u ON u.id = p.user_id
       WHERE p.id = $1`,
      [patientId]
    );
    if (!patient) return res.status(404).json({ error: 'Patient not found.' });

    const [visits, prescriptions] = await Promise.all([
      db.query(
        `SELECT a.id, a.appt_date, a.appt_time, a.reason, a.status, a.notes,
                l.name AS location_name
         FROM appointments a
         LEFT JOIN locations l ON l.id = a.location_id
         WHERE a.doctor_id = $1 AND a.patient_id = $2
         ORDER BY a.appt_date DESC, a.appt_time DESC`,
        [req.doctor.id, patientId]
      ),
      db.query(
        `SELECT rx.id, rx.patient_id, rx.doctor_id, rx.appointment_id,
                rx.medication, rx.dosage, rx.frequency, rx.duration, rx.instructions,
                rx.refills_allowed, rx.refills_used, rx.status, rx.stopped_reason,
                rx.created_at,
                d.full_name AS doctor_name,
                (SELECT COUNT(*)::int FROM refill_requests r
                 WHERE r.prescription_id = rx.id AND r.status = 'pending') AS pending_refills
         FROM prescriptions rx
         JOIN doctors d ON d.id = rx.doctor_id
         WHERE rx.patient_id = $1
         ORDER BY (rx.status = 'active') DESC, rx.created_at DESC`,
        [patientId]
      ),
    ]);

    res.json({ patient, visits, prescriptions });
  })
);

// ---------------------------------------------------------------------------
// Prescriptions
// ---------------------------------------------------------------------------

/**
 * POST /api/doctor/patients/:id/prescriptions — prescribe.
 * Body: { medication, dosage, frequency, duration?, instructions?, refills_allowed? }
 *
 * The refill ceiling is capped at 12 so a typo cannot authorize a year of
 * repeats the prescriber never intended to sign off.
 */
router.post(
  '/patients/:id/prescriptions',
  wrap(async (req, res) => {
    const patientId = parseId(req.params.id);
    if (!patientId) return res.status(404).json({ error: 'Patient not found.' });
    if (!(await treatsPatient(req.doctor.id, patientId))) return noRelationship(res);

    const { medication, dosage, frequency, duration, instructions, refills_allowed } =
      req.body || {};

    const required = [
      ['Medication', medication],
      ['Dosage', dosage],
      ['Frequency', frequency],
    ];
    for (const [label, value] of required) {
      if (!String(value || '').trim()) {
        return res.status(400).json({ error: `${label} is required.` });
      }
    }

    const refills = Number(refills_allowed ?? 0);
    if (!Number.isInteger(refills) || refills < 0 || refills > 12) {
      return res.status(400).json({ error: 'Refills must be a whole number between 0 and 12.' });
    }

    const prescription = await db.one(
      `INSERT INTO prescriptions
         (patient_id, doctor_id, medication, dosage, frequency,
          duration, instructions, refills_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        patientId,
        req.doctor.id,
        String(medication).trim(),
        String(dosage).trim(),
        String(frequency).trim(),
        duration ? String(duration).trim() : null,
        instructions ? String(instructions).trim() : null,
        refills,
      ]
    );
    res.status(201).json({ prescription });
  })
);

/**
 * PATCH /api/doctor/prescriptions/:id/stop — discontinue a medication.
 * Body: { stopped_reason } — required; it lands in the record permanently.
 *
 * Only the prescriber may stop their own prescription. The whole medication
 * list is visible to the care team (see the chart route), so a colleague's row
 * is found and refused rather than hidden — 403 tells the physician who to
 * ask, where a 404 would read as a bug.
 */
router.patch(
  '/prescriptions/:id/stop',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Prescription not found.' });

    const reason = String((req.body || {}).stopped_reason || '').trim();
    if (!reason) {
      return res.status(400).json({ error: 'A reason is required to stop a medication.' });
    }

    const rx = await db.one('SELECT id, doctor_id, status FROM prescriptions WHERE id = $1', [id]);
    if (!rx) return res.status(404).json({ error: 'Prescription not found.' });
    if (rx.doctor_id !== req.doctor.id) {
      return res.status(403).json({
        error: 'A medication can only be stopped by the physician who prescribed it.',
      });
    }
    if (rx.status !== 'active') {
      return res.status(409).json({ error: `This prescription is already ${rx.status}.` });
    }

    const prescription = await db.one(
      `UPDATE prescriptions
       SET status = 'stopped', stopped_reason = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [rx.id, reason]
    );
    res.json({ prescription });
  })
);

// ---------------------------------------------------------------------------
// Refill requests
// ---------------------------------------------------------------------------

/** Queue rows carry enough of the prescription to decide without opening the chart. */
const REFILL_SELECT = `
  SELECT r.id, r.prescription_id, r.patient_id, r.note, r.status, r.decision_note,
         r.decided_by, r.decided_at, r.created_at,
         rx.medication, rx.dosage, rx.frequency, rx.refills_allowed, rx.refills_used,
         rx.status AS prescription_status,
         u.full_name AS patient_name, u.email AS patient_email
  FROM refill_requests r
  JOIN prescriptions rx ON rx.id = r.prescription_id
  JOIN patients p       ON p.id = r.patient_id
  JOIN users u          ON u.id = p.user_id
`;

const REFILL_STATUSES = ['pending', 'approved', 'denied'];

/**
 * GET /api/doctor/refill-requests?status= — requests on this doctor's own
 * prescriptions. Defaults to `pending`, which is the work queue.
 *
 * Pending is ordered oldest first (the person who waited longest is next);
 * a decided list is ordered newest first, because that one is a log.
 */
router.get(
  '/refill-requests',
  wrap(async (req, res) => {
    const status = req.query.status || 'pending';
    if (!REFILL_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${REFILL_STATUSES.join(', ')}.` });
    }
    const direction = status === 'pending' ? 'ASC' : 'DESC';

    const requests = await db.query(
      `${REFILL_SELECT}
       WHERE rx.doctor_id = $1 AND r.status = $2
       ORDER BY r.created_at ${direction}`,
      [req.doctor.id, status]
    );
    res.json({ requests });
  })
);

/**
 * PATCH /api/doctor/refill-requests/:id — approve or deny.
 * Body: { status: 'approved'|'denied', decision_note? (required on deny) }
 *
 * Approving increments `refills_used` in the same transaction as the decision:
 * the refill is dispensed, not banked, and a decision recorded without the
 * count moving would let the same authorization be used twice.
 *
 * Denying requires a note, and the patient's notification asks them to book a
 * follow-up — a refusal with no route forward is how a patient stops taking a
 * medication instead of getting reviewed.
 */
router.patch(
  '/refill-requests/:id',
  wrap(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Refill request not found.' });

    const { status, decision_note } = req.body || {};
    if (!['approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'approved' or 'denied'." });
    }
    const note = String(decision_note || '').trim();
    if (status === 'denied' && !note) {
      return res.status(400).json({
        error: 'A note to the patient is required when denying a refill.',
      });
    }

    const request = await db.one(
      `SELECT r.id, r.status, r.prescription_id,
              rx.doctor_id, rx.status AS prescription_status, rx.medication,
              u.id AS patient_user_id
       FROM refill_requests r
       JOIN prescriptions rx ON rx.id = r.prescription_id
       JOIN patients p       ON p.id = r.patient_id
       JOIN users u          ON u.id = p.user_id
       WHERE r.id = $1`,
      [id]
    );
    // A request on someone else's prescription is not this physician's to see
    // or to decide, so it reads as missing rather than as forbidden.
    if (!request || request.doctor_id !== req.doctor.id) {
      return res.status(404).json({ error: 'Refill request not found.' });
    }
    if (request.status !== 'pending') {
      return res.status(409).json({ error: `This request was already ${request.status}.` });
    }
    if (status === 'approved' && request.prescription_status !== 'active') {
      return res.status(409).json({
        error: 'This prescription is no longer active — deny the request with a note instead.',
      });
    }

    const decided = await db.tx(async (c) => {
      // The `status = 'pending'` guard is the real check: two physicians on the
      // same shared prescription could both pass the read above, and only one
      // of them may move refills_used.
      const result = await c.query(
        `UPDATE refill_requests
         SET status = $2, decision_note = $3, decided_by = $4, decided_at = now()
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [request.id, status, note || null, req.doctor.id]
      );
      if (result.rows.length === 0) return false;

      if (status === 'approved') {
        await c.query(
          `UPDATE prescriptions
           SET refills_used = refills_used + 1, updated_at = now()
           WHERE id = $1`,
          [request.prescription_id]
        );
      }
      return true;
    });
    if (!decided) {
      return res.status(409).json({ error: 'This request was decided by someone else.' });
    }

    await notify({
      userId: request.patient_user_id,
      type: status === 'approved' ? 'refill_approved' : 'refill_denied',
      ctx: {
        medication: request.medication,
        doctorName: req.doctor.full_name,
        decisionNote: note || null,
      },
    });

    res.json({ request: await db.one(`${REFILL_SELECT} WHERE r.id = $1`, [request.id]) });
  })
);

module.exports = router;
