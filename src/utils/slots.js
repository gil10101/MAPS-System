/**
 * Slot generation — the single definition of "a bookable slot" in MediSync.
 *
 * A doctor's availability is a weekly pattern (doctor_schedules) cut into
 * slot_minutes chunks, minus date ranges the doctor is away (schedule_blocks),
 * minus slots already consumed by a live appointment.
 *
 * Everything that needs to reason about slots goes through this file. Patient
 * availability and the Provider Utilization report have to agree exactly: if
 * the report's denominator were computed with its own SQL it would drift from
 * what patients can actually book, and the utilization figure would be fiction.
 */
'use strict';

const db = require('../db/database');

// Upper bound on a single countSlotsInRange call. Report date ranges arrive
// straight from query params, so an absurd `to` must not turn into a loop of
// millions of iterations.
const MAX_RANGE_DAYS = 731;

/** 'HH:MM' -> minutes since midnight */
function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** minutes since midnight -> 'HH:MM' */
function toHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Parse 'YYYY-MM-DD' at local noon.
 *
 * Midnight would let a DST shift or a negative UTC offset roll the date back a
 * day, which silently moves the weekday and therefore the whole schedule.
 * @returns {Date|null} null when the string is not a real date
 */
function parseDate(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const d = new Date(`${dateStr}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Date -> 'YYYY-MM-DD' using local parts (the Date is always local noon here). */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Expand one schedule window into its slot start times.
 * A trailing gap shorter than slot_minutes is not a slot — the visit would run
 * past the end of the window.
 * @returns {string[]} 'HH:MM' start times
 */
function expandWindow(window) {
  const start = toMinutes(window.start_time);
  const end = toMinutes(window.end_time);
  const step = window.slot_minutes || 30;
  const times = [];
  for (let t = start; t + step <= end; t += step) times.push(toHHMM(t));
  return times;
}

/** The doctor's weekly windows for one weekday, with the site they run at. */
function windowsForWeekday(doctorId, weekday) {
  return db.query(
    `SELECT ds.location_id, l.name AS location_name,
            ds.start_time, ds.end_time, ds.slot_minutes
     FROM doctor_schedules ds
     JOIN locations l ON l.id = ds.location_id
     WHERE ds.doctor_id = $1 AND ds.weekday = $2
     ORDER BY ds.start_time`,
    [doctorId, weekday]
  );
}

/** True when the doctor has a schedule_blocks range covering this date. */
async function isDateBlocked(doctorId, dateStr) {
  const hit = await db.one(
    `SELECT 1 FROM schedule_blocks
     WHERE doctor_id = $1 AND $2::date BETWEEN start_date AND end_date
     LIMIT 1`,
    [doctorId, dateStr]
  );
  return Boolean(hit);
}

/**
 * Open slots for a doctor on one date.
 *
 * Slots carry their location because a physician can hold clinic at more than
 * one site in a week: the patient has to be told which building to go to, and
 * the booking stores that site on the appointment.
 *
 * @param {number} doctorId
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Promise<Array<{time: string, location_id: number, location_name: string}>>}
 *   sorted by time; empty when the doctor is blocked or has no window that day
 */
async function getAvailableSlots(doctorId, dateStr) {
  const date = parseDate(dateStr);
  if (!date) return [];

  // A block wipes out the whole day regardless of the weekly pattern.
  if (await isDateBlocked(doctorId, dateStr)) return [];

  const windows = await windowsForWeekday(doctorId, date.getDay());
  if (windows.length === 0) return [];

  // Taken = any appointment that still holds the slot. Cancelled rows release
  // it; a no_show does not, because the time was consumed either way.
  const takenRows = await db.query(
    `SELECT appt_time FROM appointments
     WHERE doctor_id = $1 AND appt_date = $2 AND status <> 'cancelled'`,
    [doctorId, dateStr]
  );
  const taken = new Set(takenRows.map((r) => r.appt_time));

  // Admin rejects overlapping windows on the same weekday, so a time should
  // only ever come from one window; `seen` keeps a bad row from producing two
  // slots at the same clock time with different sites.
  const seen = new Set();
  const slots = [];
  for (const w of windows) {
    for (const time of expandWindow(w)) {
      if (taken.has(time) || seen.has(time)) continue;
      seen.add(time);
      slots.push({ time, location_id: w.location_id, location_name: w.location_name });
    }
  }

  slots.sort((a, b) => a.time.localeCompare(b.time));
  return slots;
}

/** True if the given slot is a real, currently-open slot for the doctor/date. */
async function isSlotAvailable(doctorId, dateStr, timeStr) {
  const slots = await getAvailableSlots(doctorId, dateStr);
  return slots.some((s) => s.time === timeStr);
}

/**
 * The site a slot belongs to, from the schedule window that covers it.
 *
 * This answers "where", not "is it free" — availability is isSlotAvailable's
 * job. Booking calls both: it rejects an unavailable slot, then stamps the
 * appointment with the location so a later schedule edit cannot rewrite where
 * a visit happened.
 *
 * @returns {Promise<number|null>} location_id, or null if no window covers it
 */
async function resolveSlotLocation(doctorId, dateStr, timeStr) {
  const date = parseDate(dateStr);
  if (!date || typeof timeStr !== 'string') return null;

  const windows = await windowsForWeekday(doctorId, date.getDay());
  for (const w of windows) {
    if (expandWindow(w).includes(timeStr)) return w.location_id;
  }
  return null;
}

/**
 * Total bookable capacity a doctor's weekly pattern generates over an
 * inclusive date range, with blocked days removed.
 *
 * This is the denominator of Provider Utilization, so it is built from the
 * same window expansion getAvailableSlots uses — the only difference is that
 * capacity ignores whether a slot ended up booked.
 *
 * The windows and blocks are fetched once and the dates walked in JS: a query
 * per day would mean ~30 round trips per doctor per report.
 *
 * @param {number} doctorId
 * @param {string} fromDate 'YYYY-MM-DD' inclusive
 * @param {string} toDate 'YYYY-MM-DD' inclusive
 * @returns {Promise<{slots: number, minutes: number}>}
 */
async function slotStatsInRange(doctorId, fromDate, toDate) {
  const from = parseDate(fromDate);
  const to = parseDate(toDate);
  if (!from || !to || from > to) return { slots: 0, minutes: 0 };

  const [windows, blocks] = await Promise.all([
    db.query(
      `SELECT weekday, start_time, end_time, slot_minutes
       FROM doctor_schedules WHERE doctor_id = $1`,
      [doctorId]
    ),
    db.query(
      `SELECT start_date, end_date FROM schedule_blocks
       WHERE doctor_id = $1 AND start_date <= $3::date AND end_date >= $2::date`,
      [doctorId, fromDate, toDate]
    ),
  ]);
  if (windows.length === 0) return { slots: 0, minutes: 0 };

  // Per-weekday slot counts, computed once instead of per date in the range.
  const perWeekday = new Array(7).fill(null).map(() => ({ slots: 0, minutes: 0 }));
  for (const w of windows) {
    const count = expandWindow(w).length;
    const bucket = perWeekday[w.weekday];
    bucket.slots += count;
    bucket.minutes += count * (w.slot_minutes || 30);
  }

  let slots = 0;
  let minutes = 0;
  const cursor = new Date(from.getTime());
  for (let guard = 0; cursor <= to && guard < MAX_RANGE_DAYS; guard += 1) {
    const dateStr = toDateStr(cursor);
    const blocked = blocks.some((b) => dateStr >= b.start_date && dateStr <= b.end_date);
    if (!blocked) {
      const bucket = perWeekday[cursor.getDay()];
      slots += bucket.slots;
      minutes += bucket.minutes;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return { slots, minutes };
}

/**
 * Bookable slots in an inclusive date range (Provider Utilization denominator).
 * @returns {Promise<number>}
 */
async function countSlotsInRange(doctorId, fromDate, toDate) {
  const { slots } = await slotStatsInRange(doctorId, fromDate, toDate);
  return slots;
}

/**
 * Bookable minutes in an inclusive date range. Divide by 60 for capacity hours;
 * use slotStatsInRange when a caller needs both figures from one round trip.
 * @returns {Promise<number>}
 */
async function countSlotMinutesInRange(doctorId, fromDate, toDate) {
  const { minutes } = await slotStatsInRange(doctorId, fromDate, toDate);
  return minutes;
}

module.exports = {
  getAvailableSlots,
  isSlotAvailable,
  resolveSlotLocation,
  slotStatsInRange,
  countSlotsInRange,
  countSlotMinutesInRange,
  toMinutes,
  toHHMM,
};
