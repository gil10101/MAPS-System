/**
 * Helpers for turning a doctor's weekly schedule into concrete bookable
 * time slots for a given date, excluding slots that are already taken.
 */
'use strict';

const db = require('../db/database');

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
 * Return the list of available 'HH:MM' start times for a doctor on a date.
 * @param {number} doctorId
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {Promise<string[]>} sorted available slot start times
 */
async function getAvailableSlots(doctorId, dateStr) {
  // Parse date as local-noon to avoid timezone rollover surprises.
  const date = new Date(`${dateStr}T12:00:00`);
  if (isNaN(date.getTime())) return [];
  const weekday = date.getDay(); // 0..6

  const windows = await db.query(
    `SELECT start_time, end_time, slot_minutes
     FROM doctor_schedules
     WHERE doctor_id = $1 AND weekday = $2`,
    [doctorId, weekday]
  );
  if (windows.length === 0) return [];

  // Slots already booked (any non-cancelled appointment) for this doctor/date.
  const takenRows = await db.query(
    `SELECT appt_time FROM appointments
     WHERE doctor_id = $1 AND appt_date = $2 AND status != 'cancelled'`,
    [doctorId, dateStr]
  );
  const taken = new Set(takenRows.map((r) => r.appt_time));

  const slots = [];
  for (const w of windows) {
    const start = toMinutes(w.start_time);
    const end = toMinutes(w.end_time);
    const step = w.slot_minutes || 30;
    for (let t = start; t + step <= end; t += step) {
      const label = toHHMM(t);
      if (!taken.has(label)) slots.push(label);
    }
  }
  slots.sort();
  return slots;
}

/** True if the given slot is a valid, currently-open slot for the doctor/date. */
async function isSlotAvailable(doctorId, dateStr, timeStr) {
  const slots = await getAvailableSlots(doctorId, dateStr);
  return slots.includes(timeStr);
}

module.exports = { getAvailableSlots, isSlotAvailable, toMinutes, toHHMM };
