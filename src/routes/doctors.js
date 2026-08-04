/**
 * The public physician directory — who the practice has, where each of them
 * holds clinic, and what is open on a given day.
 *
 * Public on purpose: picking a provider is the step *before* creating an
 * account, and everything returned here is what a practice already publishes on
 * its website. Taking a slot is not public — that lives in
 * routes/appointments.js behind requireAuth. Admin management of the directory
 * lives in routes/admin.js.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { getAvailableSlots } = require('../utils/slots');

const router = express.Router();

/** Filters arrive as strings; only a positive integer can be a row id. */
function toId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The sites a physician holds clinic at, aggregated onto the doctor row.
 *
 * Where a doctor practises is not a column on doctors: it is whatever their
 * weekly windows say, and one physician holding Monday clinic uptown and
 * Thursday clinic downtown has two sites. Aggregating in a lateral join keeps
 * the whole directory to a single round trip — resolving locations per doctor
 * afterwards would be a query per row.
 *
 * DISTINCT first, then aggregate: a doctor with four windows at one site must
 * still list that site once. Inactive sites are dropped, because a site the
 * practice has taken offline is not somewhere to send a patient even if old
 * windows still point at it.
 */
const LOCATIONS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT COALESCE(
             jsonb_agg(
               jsonb_build_object('id', site.id, 'name', site.name, 'city', site.city)
               ORDER BY site.name),
             '[]'::jsonb) AS locations
    FROM (
      SELECT DISTINCT l.id, l.name, l.city
      FROM doctor_schedules ds
      JOIN locations l ON l.id = ds.location_id
      WHERE ds.doctor_id = d.id AND l.active = true
    ) site
  ) sites ON true
`;

const DIRECTORY_SELECT = `
  SELECT d.id, d.prefix, d.first_name, d.last_name, d.full_name,
         d.specialty_id, s.name AS specialty_name,
         d.email, d.phone, d.bio, d.room,
         sites.locations
  FROM doctors d
  LEFT JOIN specialties s ON s.id = d.specialty_id
  ${LOCATIONS_LATERAL}
`;

/**
 * GET /api/doctors?q=&specialty=&location=
 *
 * Active doctors only — `active` means "accepting appointments", so an inactive
 * physician has nothing bookable to offer a browser.
 *
 * `location` narrows to doctors who actually hold clinic at that site, which is
 * the question a patient is really asking: not "who works here" but "who can I
 * see at the building I can get to".
 *
 * Unparseable ids are ignored rather than rejected: a stale filter in a
 * bookmarked URL should show the directory, not an error.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const clauses = ['d.active = true'];
    const params = [];

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      params.push(`%${q}%`);
      // The three columns are matched explicitly rather than leaning on
      // full_name happening to contain the parts: the search must keep working
      // if the generated column is ever composed differently.
      const p = `$${params.length}`;
      clauses.push(`(d.first_name ILIKE ${p} OR d.last_name ILIKE ${p} OR d.full_name ILIKE ${p})`);
    }

    const specialtyId = toId(req.query.specialty);
    if (specialtyId) {
      params.push(specialtyId);
      clauses.push(`d.specialty_id = $${params.length}`);
    }

    const locationId = toId(req.query.location);
    if (locationId) {
      params.push(locationId);
      clauses.push(`EXISTS (
        SELECT 1 FROM doctor_schedules ds
        JOIN locations l ON l.id = ds.location_id
        WHERE ds.doctor_id = d.id AND ds.location_id = $${params.length} AND l.active = true
      )`);
    }

    // Sorted by surname, the way a practice lists its providers. First name
    // breaks ties so two doctors sharing a surname keep a stable order.
    const rows = await db.query(
      `${DIRECTORY_SELECT}
       WHERE ${clauses.join(' AND ')}
       ORDER BY d.last_name, d.first_name`,
      params
    );

    res.json({ doctors: rows });
  })
);

/**
 * GET /api/doctors/specialties — the filter dropdown's options.
 *
 * Declared before '/:id' on purpose: Express matches in order, and '/:id'
 * would otherwise swallow this path and try to load a doctor called
 * "specialties".
 */
router.get(
  '/specialties',
  wrap(async (req, res) => {
    const rows = await db.query('SELECT id, name, description FROM specialties ORDER BY name');
    res.json({ specialties: rows });
  })
);

/**
 * GET /api/doctors/:id — one doctor, same shape as the directory row.
 *
 * Not filtered on `active`: a patient with an existing appointment still needs
 * to look up who they are seeing after the practice stops taking new bookings
 * for that physician. Whether anything can be booked is answered by
 * /availability and by POST /api/appointments, not by hiding the profile.
 */
router.get(
  '/:id',
  wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid doctor id.' });

    const doctor = await db.one(`${DIRECTORY_SELECT} WHERE d.id = $1`, [id]);
    if (!doctor) return res.status(404).json({ error: 'Doctor not found.' });

    res.json({ doctor });
  })
);

/**
 * GET /api/doctors/:id/availability?date=YYYY-MM-DD
 *
 * Every slot carries the site its schedule window runs at, because a patient
 * has to know which building to travel to before they choose a time, not after.
 *
 * A day the doctor is blocked, or simply does not work, returns an empty list
 * rather than a 404: the doctor exists, that date just has nothing open.
 */
router.get(
  '/:id/availability',
  wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid doctor id.' });

    const date = typeof req.query.date === 'string' ? req.query.date : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'A valid date (YYYY-MM-DD) is required.' });
    }

    const doctor = await db.one('SELECT id FROM doctors WHERE id = $1 AND active = true', [id]);
    if (!doctor) {
      return res.status(404).json({ error: 'Doctor not found or not accepting appointments.' });
    }

    res.json({ date, slots: await getAvailableSlots(id, date) });
  })
);

module.exports = router;
