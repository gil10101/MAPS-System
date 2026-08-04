/**
 * Notification service — the one way MediSync tells a user something happened.
 *
 * Every notification writes an `in_app` row (the tray in the topbar reads
 * those). An `email` or `sms` row is written on top only when the user has
 * that reminder preference switched on. Those rows are receipts: the delivery
 * step is a console.log, because this prototype has no mail or SMS provider.
 * Swapping in a real one means implementing deliver() and nothing else.
 *
 * Deliberately uses the pool rather than accepting a transaction client: a
 * notification is a side effect of the thing that happened, never a condition
 * of it. A booking must not roll back because the tray insert failed.
 */
'use strict';

const db = require('../db/database');

const ALL_CHANNELS = ['in_app', 'email', 'sms'];

/** 'YYYY-MM-DD' -> 'Mon, Aug 3, 2026'. Parsed at noon so the date cannot roll. */
function formatDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return String(dateStr || '');
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** 'HH:MM' (24h) -> '2:30 PM'. */
function formatTime(timeStr) {
  if (typeof timeStr !== 'string' || !/^\d{1,2}:\d{2}$/.test(timeStr)) return String(timeStr || '');
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/** ' at Midtown Clinic' / '' — trailing clauses that vanish when unknown. */
function atLocation(locationName) {
  return locationName ? ` at ${locationName}` : '';
}

function whenPhrase(ctx) {
  const parts = [];
  if (ctx.apptDate) parts.push(formatDate(ctx.apptDate));
  if (ctx.apptTime) parts.push(`at ${formatTime(ctx.apptTime)}`);
  return parts.join(' ');
}

function doctorPhrase(ctx) {
  return ctx.doctorName ? ` with ${ctx.doctorName}` : '';
}

function byDoctorPhrase(ctx) {
  return ctx.doctorName ? ` by ${ctx.doctorName}` : '';
}

/**
 * The wording for a notification type.
 *
 * Kept here rather than at each call site so the same event reads the same way
 * whether it was triggered by a patient, a physician, or an admin, and so the
 * patient-facing vocabulary ("request", "pending approval") stays consistent
 * with the rest of the UI.
 *
 * @param {string} type one of the notification types in the contract
 * @param {object} [ctx] { doctorName, apptDate, apptTime, locationName,
 *   previousDate, previousTime, cancelReason, cancelledBy, medication,
 *   decisionNote, blockReason }
 * @returns {{title: string, body: string}}
 */
function buildAppointmentMessage(type, ctx = {}) {
  const when = whenPhrase(ctx);
  const doctor = doctorPhrase(ctx);
  const where = atLocation(ctx.locationName);
  const medication = ctx.medication || 'your prescription';
  const note = ctx.decisionNote ? ` Note from the practice: ${ctx.decisionNote}` : '';

  switch (type) {
    case 'appointment_requested':
      return {
        title: 'Appointment request received',
        body: `We received your request to be seen${doctor} on ${when}${where}. Clinic staff will review it and confirm your time shortly.`,
      };

    case 'appointment_approved':
      return {
        title: 'Appointment confirmed',
        body: `Your appointment${doctor} on ${when}${where} is confirmed. Please arrive 10 minutes early to check in.`,
      };

    case 'appointment_cancelled': {
      const by = ctx.cancelledBy === 'practice' ? ' by the practice' : '';
      const because = ctx.cancelReason ? ` Reason: ${ctx.cancelReason}.` : '';
      return {
        title: 'Appointment cancelled',
        body: `Your appointment${doctor} on ${when} was cancelled${by}.${because} You can request a new time whenever you are ready.`,
      };
    }

    case 'appointment_rescheduled': {
      const from =
        ctx.previousDate || ctx.previousTime
          ? ` from ${whenPhrase({ apptDate: ctx.previousDate, apptTime: ctx.previousTime })}`
          : '';
      return {
        title: 'Appointment rescheduled',
        body: `Your appointment${doctor} moved${from} to ${when}${where}. The new time is pending approval by clinic staff.`,
      };
    }

    case 'appointment_completed':
      return {
        title: 'Visit completed',
        body: `Your visit${doctor} on ${when} is marked complete. Any prescriptions from the visit are in your MediSync account.`,
      };

    case 'reschedule_required': {
      const because = ctx.blockReason ? ` (${ctx.blockReason})` : '';
      const day = ctx.apptDate ? ` on ${formatDate(ctx.apptDate)}` : '';
      const slot = ctx.apptTime ? ` ${formatTime(ctx.apptTime)}` : '';
      return {
        title: 'Please reschedule your appointment',
        body: `Your provider is unavailable${day}${because}, so your${slot} appointment${doctor} needs to move. Open My Appointments in MediSync to pick a new time — your place is held until you do.`,
      };
    }

    case 'refill_approved':
      return {
        title: 'Refill approved',
        body: `Your refill request for ${medication} was approved${byDoctorPhrase(ctx)}. Your pharmacy can fill it now.${note}`,
      };

    case 'refill_denied':
      return {
        title: 'Refill request denied',
        body: `Your refill request for ${medication} was not approved${byDoctorPhrase(ctx)}.${note} Please book a follow-up visit in MediSync so your provider can review this prescription with you.`,
      };

    case 'appointment_reminder':
      return {
        title: 'Appointment reminder',
        body: `Reminder: you are booked${doctor} on ${when}${where}. Reply to the practice if you need to change it.`,
      };

    default:
      // Unknown types still produce something readable rather than throwing —
      // a notification is never worth failing the action that caused it.
      return {
        title: 'MediSync update',
        body: when ? `There is an update on your appointment on ${when}.` : 'There is an update on your account.',
      };
  }
}

/**
 * Log the simulated send. Named and formatted so nobody reading server output
 * mistakes it for a real delivery.
 */
function deliver(channel, target, title, body) {
  const dest = target || '(no address on file)';
  console.log(`[MediSync] SIMULATED ${channel.toUpperCase()} -> ${dest} | ${title} | ${body}`);
}

/**
 * Record a notification for a user across every channel they have opted into.
 *
 * The caller does not pass or check preferences: they are looked up here, so
 * there is exactly one place that decides whether an email or SMS receipt is
 * written. `title`/`body` may be omitted, in which case they are derived from
 * `type` and `ctx` via buildAppointmentMessage.
 *
 * Never throws and never rejects — see the file header.
 *
 * @param {object} args
 * @param {number} args.userId recipient (users.id, any role)
 * @param {number} [args.appointmentId] appointment the notification is about
 * @param {string} args.type contract notification type
 * @param {string} [args.title]
 * @param {string} [args.body]
 * @param {object} [args.ctx] passed to buildAppointmentMessage when title/body are absent
 * @param {string[]} [args.channels] channels to consider; in_app is always written
 * @returns {Promise<Array<object>>} the rows written (empty if the write failed)
 */
async function notify({ userId, appointmentId = null, type, title, body, ctx, channels } = {}) {
  try {
    if (!userId || !type) {
      console.warn('[MediSync] notify() called without userId or type — skipped.');
      return [];
    }

    const user = await db.one(
      'SELECT id, email, phone, full_name, notify_email, notify_sms FROM users WHERE id = $1',
      [userId]
    );
    if (!user) {
      console.warn(`[MediSync] notify() found no user ${userId} — skipped.`);
      return [];
    }

    const message = title && body ? { title, body } : buildAppointmentMessage(type, ctx || {});
    const requested = Array.isArray(channels) && channels.length ? channels : ALL_CHANNELS;

    // in_app is unconditional: the tray is the record of what the system did,
    // and opting out of reminders is not opting out of being told.
    const wanted = ['in_app'];
    if (requested.includes('email') && user.notify_email) wanted.push('email');
    if (requested.includes('sms') && user.notify_sms) wanted.push('sms');

    const params = [];
    const values = wanted.map((channel) => {
      params.push(userId, appointmentId, channel, type, message.title, message.body);
      const n = params.length;
      return `($${n - 5}, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n}, 'sent')`;
    });

    const rows = await db.query(
      `INSERT INTO notifications (user_id, appointment_id, channel, type, title, body, status)
       VALUES ${values.join(', ')}
       RETURNING id, user_id, appointment_id, channel, type, title, body, status, read_at, created_at`,
      params
    );

    for (const row of rows) {
      if (row.channel === 'email') deliver('email', user.email, row.title, row.body);
      if (row.channel === 'sms') deliver('sms', user.phone, row.title, row.body);
    }

    return rows;
  } catch (err) {
    console.error(`[MediSync] notify(${type}) failed for user ${userId}:`, err.message);
    return [];
  }
}

module.exports = { notify, buildAppointmentMessage };
