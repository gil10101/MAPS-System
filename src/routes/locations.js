/**
 * Clinic sites, read-only.
 *
 * Public on purpose: the landing page and the doctor directory let a visitor
 * narrow to the site they can actually travel to before they have an account,
 * and a location is public information anyway — it is the address on the door.
 * Admin management of sites lives in routes/admin.js.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');

const router = express.Router();

/**
 * GET /api/locations — active sites, alphabetical.
 * Inactive sites stay in the table because appointments reference them, but
 * they must not appear anywhere a patient could pick one.
 */
router.get(
  '/',
  wrap(async (req, res) => {
    const rows = await db.query(
      `SELECT id, name, address, city, state, zip, phone
       FROM locations
       WHERE active = true
       ORDER BY name`
    );
    res.json({ locations: rows });
  })
);

module.exports = router;
