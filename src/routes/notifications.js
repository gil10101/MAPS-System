/**
 * The notification tray — every role reads its own.
 *
 * Only `in_app` rows are served. The `email`/`sms` rows written alongside them
 * are delivery receipts for a message that went out another way; showing them
 * in the tray would render the same event two or three times.
 */
'use strict';

const express = require('express');
const db = require('../db/database');
const wrap = require('../utils/wrap');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const TRAY_LIMIT = 50;

const TRAY_COLUMNS = `id, appointment_id, type, title, body, status, read_at, created_at`;

/** Query params arrive as strings; treat the usual truthy spellings as true. */
function isTrue(value) {
  return value === true || value === 'true' || value === '1';
}

/**
 * GET /api/notifications?unread_only=true
 *
 * `unread_count` counts every unread row, not just the ones in this page: the
 * bell badge would understate itself if it only saw the newest 50.
 */
router.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const unreadOnly = isTrue(req.query.unread_only);

    // created_at ties are common in seeded data, so id breaks them — otherwise
    // the tray order shuffles between polls.
    const rows = await db.query(
      `SELECT ${TRAY_COLUMNS}
       FROM notifications
       WHERE user_id = $1 AND channel = 'in_app'
         AND ($2::boolean = false OR read_at IS NULL)
       ORDER BY created_at DESC, id DESC
       LIMIT ${TRAY_LIMIT}`,
      [req.user.id, unreadOnly]
    );

    const counts = await db.one(
      `SELECT COUNT(*)::int AS unread_count
       FROM notifications
       WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL`,
      [req.user.id]
    );

    res.json({ notifications: rows, unread_count: counts.unread_count });
  })
);

/**
 * PATCH /api/notifications/:id/read — mark one notification read.
 *
 * Ownership is part of the UPDATE rather than a separate lookup: someone
 * else's id simply matches nothing, so it 404s without confirming that the row
 * exists. COALESCE keeps the original read time if the client sends this twice.
 */
router.patch(
  '/:id/read',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid notification id.' });
    }

    const row = await db.one(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, now())
       WHERE id = $1 AND user_id = $2 AND channel = 'in_app'
       RETURNING ${TRAY_COLUMNS}`,
      [id, req.user.id]
    );
    if (!row) return res.status(404).json({ error: 'Notification not found.' });

    res.json({ notification: row });
  })
);

/**
 * POST /api/notifications/read-all — clear the badge.
 * Returns how many rows actually changed, so a second call reports 0 instead
 * of re-stamping read_at on everything.
 */
router.post(
  '/read-all',
  requireAuth,
  wrap(async (req, res) => {
    const rows = await db.query(
      `UPDATE notifications
       SET read_at = now()
       WHERE user_id = $1 AND channel = 'in_app' AND read_at IS NULL
       RETURNING id`,
      [req.user.id]
    );
    res.json({ updated: rows.length });
  })
);

module.exports = router;
