/**
 * Seed script — populates the database with demo data so MediSync is usable
 * immediately for a demo or presentation.
 *
 *   npm run seed            # insert demo data (skips if data already exists)
 *   npm run reset-db        # wipe all tables, then re-seed
 *
 * Demo logins created:
 *   admin@medisync.health / admin123    (clinic administrator)
 *   jdoe@example.com      / patient123  (patient — the demo login)
 *   skim@medisync.health  / doctor123   (physician — Dr. Sarah Kim)
 *   rosei@medisync.health / doctor123   (physician — Dr. Robert Osei)
 *   (every seeded physician logs in with their directory email / doctor123;
 *    every seeded patient uses patient123)
 *
 * Appointment dates are computed relative to the moment the seed runs, not
 * hard-coded, so a demo months from now still shows a plausible mix of recent
 * history and upcoming visits. Every status in the lifecycle is represented —
 * an empty Cancellation report or a no-show rate of zero demos nothing.
 */
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const RESET = process.argv.includes('--reset');

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------
// Weekday numbering matches doctor_schedules.weekday (0 = Sunday).
const MON = 1;
const TUE = 2;
const WED = 3;
const THU = 4;
const FRI = 5;

/** 'YYYY-MM-DD' in local time — formatting via UTC would shift the day. */
function isoDate(d) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Monday of the current week. Sunday counts as the tail of the week that just
 * ended, so week +1 is always strictly in the future and week -1 always
 * strictly in the past, whatever day the seed is run on.
 */
function currentMonday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday: adding days can't be pushed over a DST edge
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const WEEK_START = currentMonday();

/** The given weekday, `weeks` weeks from the current week. */
function weekdayDate(weeks, weekday) {
  const d = new Date(WEEK_START);
  d.setDate(d.getDate() + weeks * 7 + (weekday - MON));
  return d;
}

/** The nth upcoming weekday (1 = the next one). Used for imminent visits. */
function businessDaysAhead(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) remaining -= 1;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const LOCATIONS = [
  { key: 'midtown', name: 'Midtown Clinic', address: '500 5th Ave', city: 'New York', state: 'NY', zip: '10018', phone: '212-555-0100' },
  { key: 'brooklyn', name: 'Brooklyn Heights Clinic', address: '120 Montague St', city: 'Brooklyn', state: 'NY', zip: '11201', phone: '718-555-0140' },
  { key: 'queens', name: 'Queens Family Center', address: '37-20 Union St', city: 'Flushing', state: 'NY', zip: '11354', phone: '718-555-0180' },
];

const SPECIALTIES = [
  ['Family Medicine', 'General and preventive care for patients of all ages.'],
  ['Cardiology', 'Diagnosis and treatment of heart and vascular conditions.'],
  ['Dermatology', 'Care for skin, hair, and nail conditions.'],
  ['Pediatrics', 'Medical care for infants, children, and adolescents.'],
  ['Orthopedics', 'Treatment of the musculoskeletal system.'],
  ['Neurology', 'Care for disorders of the nervous system.'],
];

// `sites` maps a clinic to the weekdays this physician holds there. Dr. Osei
// splits his week across two buildings, which is what location-aware slots and
// the site filter exist for — one doctor at one address demos neither.
const DOCTORS = [
  {
    key: 'skim', prefix: 'Dr.', first: 'Sarah', last: 'Kim', specialty: 'Family Medicine',
    email: 'skim@medisync.health', phone: '212-555-0101', room: 'A-101',
    bio: 'Board-certified family physician with twelve years in preventive care and chronic disease management.',
    sites: { midtown: [MON, TUE, WED, THU, FRI] },
  },
  {
    key: 'rosei', prefix: 'Dr.', first: 'Robert', last: 'Osei', specialty: 'Cardiology',
    email: 'rosei@medisync.health', phone: '212-555-0102', room: 'B-204',
    bio: 'Cardiologist specialising in hypertension, heart failure, and post-discharge follow-up.',
    sites: { midtown: [MON, TUE, WED], brooklyn: [THU, FRI] },
  },
  {
    key: 'jdiaz', prefix: 'Dr.', first: 'Julia', last: 'Diaz', specialty: 'Dermatology',
    email: 'jdiaz@medisync.health', phone: '718-555-0141', room: 'C-110',
    bio: 'Dermatologist focused on skin cancer screening, eczema, and acne treatment.',
    sites: { brooklyn: [MON, TUE, WED, THU, FRI] },
  },
  {
    key: 'apatel', prefix: 'Dr.', first: 'Aisha', last: 'Patel', specialty: 'Pediatrics',
    email: 'apatel@medisync.health', phone: '718-555-0181', room: 'Q-12',
    bio: 'Pediatrician with a gentle approach to childhood wellness, asthma, and vaccinations.',
    sites: { queens: [MON, TUE, WED, THU, FRI] },
  },
  {
    key: 'erossi', prefix: 'Dr.', first: 'Elena', last: 'Rossi', specialty: 'Orthopedics',
    email: 'erossi@medisync.health', phone: '718-555-0142', room: 'D-320',
    bio: 'Orthopedic surgeon treating sports injuries, joint pain, and post-operative rehabilitation.',
    sites: { brooklyn: [MON, TUE, WED, THU, FRI] },
  },
  {
    key: 'dkim', prefix: 'Dr.', first: 'David', last: 'Kim', specialty: 'Neurology',
    email: 'dkim@medisync.health', phone: '212-555-0106', room: 'B-210',
    bio: 'Neurologist experienced in migraine, epilepsy, and peripheral nerve disorders.',
    sites: { midtown: [MON, TUE, WED, THU, FRI] },
  },
  {
    key: 'lbennett', prefix: 'Dr.', first: 'Laura', last: 'Bennett', specialty: 'Family Medicine',
    email: 'lbennett@medisync.health', phone: '718-555-0182', room: 'Q-04',
    bio: 'Family medicine physician passionate about diabetes care and community health.',
    sites: { queens: [MON, TUE, WED, THU, FRI] },
  },
];

// The clinic's wider patient population. These carry the bulk of the schedule
// so the named patients below keep a book a real person could plausibly have:
// splitting several hundred visits across six people would give every one of
// them a visit most days of the week, which looks wrong the moment anyone opens
// a patient's appointment list on screen. They also give the physician panels
// and the Patient Visit History report something to range over.
const BACKGROUND_FIRST = [
  'Amara', 'Beatriz', 'Caleb', 'Dmitri', 'Elena', 'Farah', 'Grace', 'Hassan',
  'Imani', 'Jonas', 'Keiko', 'Liam', 'Mireille', 'Nadia', 'Omar', 'Priya',
  'Quentin', 'Rosa', 'Samuel', 'Tomas', 'Ursula', 'Viktor', 'Wei', 'Yusuf',
];
const BACKGROUND_LAST = [
  'Okonkwo', 'Silva', 'Whitfield', 'Petrov', 'Marchetti', 'Haddad', 'Boateng',
  'Kaur', 'Lindqvist', 'Moreau', 'Tanaka', 'Delgado', 'Novak', 'Fitzgerald',
  'Abebe', 'Sorensen',
];

/** 40 background patients, generated deterministically so reseeds match. */
const BACKGROUND_PATIENTS = Array.from({ length: 40 }, (_, i) => {
  const first = BACKGROUND_FIRST[i % BACKGROUND_FIRST.length];
  const last = BACKGROUND_LAST[(i * 7 + 3) % BACKGROUND_LAST.length];
  const year = 1948 + ((i * 17) % 58);
  const month = String(1 + ((i * 5) % 12)).padStart(2, '0');
  const day = String(1 + ((i * 11) % 28)).padStart(2, '0');
  return {
    key: `bg${i}`,
    first,
    last,
    email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
    dob: `${year}-${month}-${day}`,
    phone: `917-555-${String(3000 + i).padStart(4, '0')}`,
    gender: ['female', 'male', 'other', 'prefer_not_to_say'][i % 4],
    address: `${100 + i * 3} Demo St, New York, NY 10001`,
    insurance: ['Aetna', 'BlueCross', 'UnitedHealthcare', 'Cigna', 'Fidelis Care'][i % 5],
    notifyEmail: i % 3 !== 0,
    notifySms: i % 4 === 0,
    background: true,
  };
});

// Kevin Nguyen is deliberately a minor: without a pediatric patient the
// pediatrician has no panel, no chart, and no refill queue to show.
const NAMED_PATIENTS = [
  {
    key: 'jordan', first: 'Jordan', last: 'Alvarez', email: 'jalvarez@example.com',
    dob: '1991-02-17', phone: '917-555-2101', gender: 'prefer_not_to_say',
    address: '88 Bleecker St, New York, NY 10012', insurance: 'Aetna',
    notifyEmail: true, notifySms: true,
  },
  {
    key: 'marcus', first: 'Marcus', last: 'Chen', email: 'mchen@example.com',
    dob: '1978-11-05', phone: '917-555-2102', gender: 'male',
    address: '250 Court St, Brooklyn, NY 11201', insurance: 'BlueCross',
    notifyEmail: true, notifySms: false,
  },
  {
    key: 'lucia', first: 'Lucia', last: 'Torres', email: 'ltorres@example.com',
    dob: '1986-06-23', phone: '917-555-2103', gender: 'female',
    address: '19 Clark St, Brooklyn, NY 11201', insurance: 'UnitedHealthcare',
    notifyEmail: true, notifySms: true,
  },
  {
    key: 'anita', first: 'Anita', last: 'Patel', email: 'anpatel@example.com',
    dob: '1969-09-14', phone: '917-555-2104', gender: 'female',
    address: '41-15 Main St, Flushing, NY 11355', insurance: 'Cigna',
    notifyEmail: true, notifySms: false,
  },
  {
    key: 'kevin', first: 'Kevin', last: 'Nguyen', email: 'knguyen@example.com',
    dob: '2013-05-22', phone: '917-555-2105', gender: 'male',
    address: '30-08 Union St, Flushing, NY 11354', insurance: 'Fidelis Care',
    notifyEmail: true, notifySms: false,
  },
  {
    key: 'john', first: 'John', last: 'Doe', email: 'jdoe@example.com',
    dob: '1988-04-12', phone: '917-555-2001', gender: 'male',
    address: '123 Main St, New York, NY 10018', insurance: 'BlueCross',
    notifyEmail: true, notifySms: true,
  },
];

// Everyone the seed creates. The named patients come first so their ids are
// stable and low, which makes them easy to find when demonstrating.
const PATIENTS = NAMED_PATIENTS.concat(BACKGROUND_PATIENTS);

/**
 * Appointments. `week`/`day` place a row relative to the current week: week -1
 * is last week (all of it in the past), week 0 is the current one. `key` is
 * only present where something else points at the row.
 *
 * Everything sits inside the demo window — last Monday through the Wednesday of
 * the current week — so the whole book can be walked on screen without paging
 * through months of history.
 *
 * Coverage is deliberate: `pending` requests dated after today for the admin
 * approval demo, `confirmed` visits dated today for the physician to complete,
 * cancellations from both sides with real reasons, no-shows so the rate is not
 * zero, and past `completed` visits carrying the note written at completion.
 */
const APPOINTMENTS = [
  // --- Past: completed, each with the note written at completion -----------
  {
    patient: 'john', doctor: 'skim', week: -1, day: TUE, time: '09:30',
    reason: 'Annual physical', status: 'completed',
    notes: 'Routine annual exam. BP 138/86, BMI 27.4, remainder of the examination unremarkable. '
      + 'Discussed diet and a target of 30 minutes walking daily. Ordered fasting lipids and HbA1c, '
      + 'and referred to cardiology for the raised readings.',
  },
  {
    patient: 'jordan', doctor: 'skim', week: -1, day: WED, time: '11:00',
    reason: 'Persistent cough', status: 'completed',
    notes: 'Three weeks of dry cough, no fever and no weight loss. Chest clear on auscultation, '
      + 'oxygen saturation 98% on room air. Most consistent with post-viral cough. Advised humidified '
      + 'air and simple linctus; return if it passes six weeks or any blood appears.',
  },
  {
    key: 'bp-followup',
    patient: 'john', doctor: 'rosei', week: -1, day: MON, time: '10:30',
    reason: 'Blood pressure follow-up', status: 'completed',
    notes: 'Home readings averaging 146/90 over two weeks. ECG shows normal sinus rhythm. Started '
      + 'lisinopril 10 mg once daily and reviewed side effects, including dry cough. Recheck in six '
      + 'weeks with a repeat basic metabolic panel.',
  },
  {
    patient: 'marcus', doctor: 'rosei', week: -1, day: THU, time: '09:00',
    reason: 'Palpitations after exercise', status: 'completed',
    notes: 'Palpitations after intense cycling, settling within minutes, no syncope or chest pain. '
      + 'Examination and resting ECG normal. Fitted a 48-hour Holter monitor and asked him to log '
      + 'episodes. Reassured pending the recording.',
  },
  {
    key: 'eczema',
    patient: 'lucia', doctor: 'jdiaz', week: -1, day: TUE, time: '14:00',
    reason: 'Eczema flare on both hands', status: 'completed',
    notes: 'Bilateral hand eczema with fissuring across the knuckles, no signs of secondary infection. '
      + 'Pattern fits irritant contact from workplace cleaning products. Prescribed triamcinolone 0.1% '
      + 'twice daily for two weeks alongside a barrier emollient and nitrile gloves at work.',
  },
  {
    key: 'well-child',
    patient: 'kevin', doctor: 'apatel', week: -1, day: WED, time: '10:00',
    reason: 'Well-child visit and vaccinations', status: 'completed',
    notes: 'Growth tracking along the 60th percentile for height and weight. Immunizations brought up '
      + 'to date. Mild intermittent asthma remains well controlled; inhaler technique reviewed with a '
      + 'spacer and the parent. Next routine visit in twelve months.',
  },
  {
    key: 'diabetes-review',
    patient: 'anita', doctor: 'lbennett', week: -1, day: FRI, time: '09:30',
    reason: 'Diabetes management review', status: 'completed',
    notes: 'Type 2 diabetes review. HbA1c 7.4%, down from 8.1% six months ago. Feet examined, sensation '
      + 'intact with no ulceration. Continued metformin 500 mg twice daily. Retinal screening booked '
      + 'for next month.',
  },
  {
    key: 'shoulder',
    patient: 'marcus', doctor: 'erossi', week: -1, day: TUE, time: '15:00',
    reason: 'Right shoulder pain', status: 'completed',
    notes: 'Two months of right shoulder pain on overhead movement. Positive impingement signs with '
      + 'full passive range, consistent with rotator cuff tendinopathy. Naproxen for two weeks plus a '
      + 'physiotherapy referral; imaging only if there is no improvement by six weeks.',
  },
  {
    key: 'migraine',
    patient: 'jordan', doctor: 'dkim', week: -1, day: THU, time: '13:30',
    reason: 'Recurring migraines', status: 'completed',
    notes: 'Migraine with visual aura, two to three episodes monthly, clearly triggered by disrupted '
      + 'sleep. Neurological examination normal. Started sumatriptan 50 mg at onset and a headache '
      + 'diary. Discussed preventive treatment if frequency rises above four attacks a month.',
  },
  {
    patient: 'john', doctor: 'skim', week: -1, day: MON, time: '09:00',
    reason: 'Review of blood work', status: 'completed',
    notes: 'Reviewed fasting labs: LDL 138 mg/dL, HbA1c 5.6%, renal function normal on lisinopril. '
      + 'BP today 128/80, a good response to treatment. Continue the current dose and repeat lipids '
      + 'in three months.',
  },
  {
    patient: 'lucia', doctor: 'erossi', week: -1, day: WED, time: '11:30',
    reason: 'Ankle sprain follow-up', status: 'completed',
    notes: 'Six weeks after a grade II lateral ankle sprain. Swelling resolved and fully weight '
      + 'bearing, with mild residual instability on stress testing. Continued proprioceptive exercises; '
      + 're-check in four weeks before returning to running.',
  },

  // --- Past: no-shows. Without these the no-show rate reads 0% ------------
  {
    patient: 'jordan', doctor: 'jdiaz', week: -1, day: FRI, time: '15:30',
    reason: 'Mole check', status: 'no_show', cancelReason: 'Did not attend, no contact',
  },
  {
    patient: 'kevin', doctor: 'lbennett', week: -1, day: TUE, time: '14:30',
    reason: 'Sports physical', status: 'no_show', cancelReason: 'Arrived too late to be seen',
  },
  {
    patient: 'marcus', doctor: 'rosei', week: -1, day: THU, time: '11:00',
    reason: 'Cardiology review', status: 'no_show', cancelReason: 'Patient called after the fact',
  },
  {
    patient: 'anita', doctor: 'rosei', week: -1, day: TUE, time: '10:00',
    reason: 'Cholesterol follow-up', status: 'no_show', cancelReason: 'Did not attend, no contact',
  },

  // --- Past: cancellations from both sides, with the reasons the UI offers -
  {
    patient: 'john', doctor: 'dkim', week: -1, day: THU, time: '10:00',
    reason: 'Headache consultation', status: 'cancelled',
    cancelReason: 'Schedule conflict', cancelledBy: 'patient',
  },
  {
    patient: 'lucia', doctor: 'jdiaz', week: -1, day: FRI, time: '09:30',
    reason: 'Acne treatment review', status: 'cancelled',
    cancelReason: 'Feeling better / no longer needed', cancelledBy: 'patient',
  },
  {
    patient: 'anita', doctor: 'lbennett', week: -1, day: MON, time: '13:00',
    reason: 'Medication review', status: 'cancelled',
    cancelReason: 'Provider unavailable', cancelledBy: 'practice',
  },
  {
    key: 'knee-bumped',
    patient: 'marcus', doctor: 'erossi', week: -1, day: FRI, time: '14:00',
    reason: 'Knee assessment', status: 'cancelled',
    cancelReason: 'Clinic closure', cancelledBy: 'practice',
  },
  {
    patient: 'kevin', doctor: 'apatel', week: -1, day: THU, time: '09:00',
    reason: 'Asthma check', status: 'cancelled',
    cancelReason: 'Transport or access problem', cancelledBy: 'patient',
  },

  // --- Imminent: the patient dashboard and today's clinic list need these --
  {
    key: 'checkup-soon',
    patient: 'john', doctor: 'skim', week: 0, day: MON, time: '11:30',
    reason: 'Blood pressure check', status: 'confirmed',
  },
  {
    patient: 'marcus', doctor: 'rosei', week: 0, day: MON, time: '14:00',
    reason: 'Statin review', status: 'confirmed',
  },

  // --- Upcoming: awaiting approval. The admin demo lives on these ----------
  {
    key: 'bp-check',
    patient: 'john', doctor: 'rosei', week: 0, day: TUE, time: '09:30',
    reason: 'Blood pressure check', status: 'pending',
  },
  {
    patient: 'marcus', doctor: 'erossi', week: 0, day: WED, time: '11:00',
    reason: 'Shoulder physiotherapy review', status: 'pending',
  },
  {
    key: 'flu-moved',
    patient: 'jordan', doctor: 'skim', week: 0, day: WED, time: '10:30',
    reason: 'Flu shot', status: 'pending', rescheduledFrom: 'flu-original',
  },
  {
    patient: 'lucia', doctor: 'jdiaz', week: 0, day: WED, time: '14:30',
    reason: 'Annual skin check', status: 'pending',
  },
  {
    patient: 'kevin', doctor: 'apatel', week: 0, day: WED, time: '09:30',
    reason: 'Asthma review', status: 'pending',
  },
  {
    patient: 'anita', doctor: 'rosei', week: 0, day: TUE, time: '13:30',
    reason: 'Cholesterol follow-up', status: 'pending',
  },
  {
    patient: 'john', doctor: 'dkim', week: 0, day: WED, time: '10:00',
    reason: 'Neurology consultation', status: 'pending',
  },

  // --- Upcoming: approved -------------------------------------------------
  {
    key: 'physical-upcoming',
    patient: 'john', doctor: 'skim', week: 0, day: TUE, time: '09:00',
    reason: 'Annual physical', status: 'confirmed',
  },
  {
    patient: 'jordan', doctor: 'dkim', week: 0, day: TUE, time: '13:30',
    reason: 'Migraine follow-up', status: 'confirmed',
  },
  {
    patient: 'kevin', doctor: 'lbennett', week: 0, day: WED, time: '14:00',
    reason: 'Sports physical', status: 'confirmed',
  },
  {
    // Falls inside Dr. Rossi's conference block below, so it demos the
    // "needs rescheduling" callout without anyone setting it up first.
    key: 'ankle-recheck',
    patient: 'lucia', doctor: 'erossi', week: 0, day: WED, time: '15:30',
    reason: 'Ankle re-check', status: 'confirmed',
  },
  {
    // Also inside Dr. Rossi's block, and belonging to the demo patient, so the
    // "needs rescheduling" callout is the first thing on their dashboard.
    key: 'knee-recheck',
    patient: 'john', doctor: 'erossi', week: 0, day: WED, time: '13:00',
    reason: 'Knee follow-up', status: 'confirmed',
  },
  {
    patient: 'marcus', doctor: 'rosei', week: 0, day: WED, time: '09:00',
    reason: 'Echocardiogram results', status: 'confirmed',
  },
  {
    patient: 'anita', doctor: 'lbennett', week: 0, day: TUE, time: '11:00',
    reason: 'Diabetes review', status: 'confirmed',
  },

  // --- Upcoming: cancelled. Keeps the Cancellation report current ----------
  {
    // The row 'flu-moved' above replaced: cancelled by the patient with the
    // reason the reschedule endpoint writes.
    key: 'flu-original',
    patient: 'jordan', doctor: 'skim', week: 0, day: TUE, time: '10:30',
    reason: 'Flu shot', status: 'cancelled',
    cancelReason: 'Rescheduled to another time', cancelledBy: 'patient',
  },
  {
    patient: 'lucia', doctor: 'erossi', week: 0, day: TUE, time: '15:00',
    reason: 'Physiotherapy referral', status: 'cancelled',
    cancelReason: 'Rescheduled at patient request', cancelledBy: 'practice',
  },
];

const PRESCRIPTIONS = [
  {
    key: 'lisinopril', patient: 'john', doctor: 'rosei', appt: 'bp-followup',
    medication: 'Lisinopril', dosage: '10 mg', frequency: 'once daily', duration: 'ongoing',
    instructions: 'Take in the morning. Report a persistent dry cough.',
    allowed: 3, used: 1, status: 'active',
  },
  {
    // Deliberately left with no open request: this is the prescription the
    // demo patient asks to refill on screen, and it belongs to Dr. Kim, so the
    // request lands in the physician queue shown in the same walkthrough.
    key: 'atorvastatin', patient: 'john', doctor: 'skim',
    medication: 'Atorvastatin', dosage: '20 mg', frequency: 'once daily at night',
    duration: 'ongoing',
    instructions: 'Take in the evening. Report any unexplained muscle aches.',
    allowed: 3, used: 0, status: 'active',
  },
  {
    // Carries a pending request so Dr. Kim's refill queue is not empty on load.
    key: 'cetirizine', patient: 'jordan', doctor: 'skim',
    medication: 'Cetirizine', dosage: '10 mg', frequency: 'once daily', duration: 'seasonal',
    instructions: 'May cause drowsiness. Take at night if it affects you.',
    allowed: 4, used: 1, status: 'active',
  },
  {
    key: 'sumatriptan', patient: 'jordan', doctor: 'dkim', appt: 'migraine',
    medication: 'Sumatriptan', dosage: '50 mg', frequency: 'at onset, as needed', duration: 'ongoing',
    instructions: 'Maximum two doses in 24 hours. Do not combine with another triptan.',
    allowed: 5, used: 2, status: 'active',
  },
  {
    key: 'triamcinolone', patient: 'lucia', doctor: 'jdiaz', appt: 'eczema',
    medication: 'Triamcinolone 0.1% cream', dosage: 'thin layer', frequency: 'twice daily', duration: '14 days',
    instructions: 'Apply to affected areas only. Stop if the skin thins or lightens.',
    allowed: 2, used: 1, status: 'active',
  },
  {
    key: 'metformin', patient: 'anita', doctor: 'lbennett', appt: 'diabetes-review',
    medication: 'Metformin', dosage: '500 mg', frequency: 'twice daily with meals', duration: 'ongoing',
    instructions: 'Take with food to reduce stomach upset.',
    allowed: 5, used: 2, status: 'active',
  },
  {
    key: 'naproxen', patient: 'marcus', doctor: 'erossi', appt: 'shoulder',
    medication: 'Naproxen', dosage: '500 mg', frequency: 'twice daily', duration: '14 days',
    instructions: 'Take with food. Stop and call the clinic if you get stomach pain.',
    allowed: 0, used: 0, status: 'completed',
  },
  {
    key: 'albuterol', patient: 'kevin', doctor: 'apatel', appt: 'well-child',
    medication: 'Albuterol inhaler', dosage: '90 mcg', frequency: 'two puffs as needed', duration: 'ongoing',
    instructions: 'Use with the spacer. Bring the inhaler to every visit.',
    allowed: 2, used: 1, status: 'active',
  },
];

// Two open requests so the physician refill queue is populated on load, plus
// one of each decision so the patient view can show a real decision history.
const REFILL_REQUESTS = [
  {
    prescription: 'lisinopril', patient: 'john', status: 'pending', daysAgo: 2,
    note: 'Down to my last week of tablets.',
  },
  {
    prescription: 'cetirizine', patient: 'jordan', status: 'pending', daysAgo: 1,
    note: 'Allergies started early this year — could I get another month?',
  },
  {
    prescription: 'sumatriptan', patient: 'jordan', status: 'pending', daysAgo: 1,
    note: 'Ran out after a bad week of headaches.',
  },
  {
    prescription: 'triamcinolone', patient: 'lucia', status: 'approved', daysAgo: 9,
    note: 'The rash is starting to come back on my left hand.',
    decidedBy: 'jdiaz', decidedDaysAgo: 8,
    decisionNote: 'Refill sent to your pharmacy. Book a visit if it returns again within the month.',
  },
  {
    prescription: 'albuterol', patient: 'kevin', status: 'denied', daysAgo: 12,
    note: 'The inhaler is nearly empty.',
    decidedBy: 'apatel', decidedDaysAgo: 11,
    decisionNote: 'Please book a follow-up so we can check his technique and control before another refill.',
  },
];

// A mix of read and unread, all tied to appointments that exist. The email row
// is the simulated delivery receipt the notifications service writes for users
// who have email reminders switched on.
const NOTIFICATIONS = [
  {
    user: 'john', appt: 'bp-check', type: 'appointment_requested', hoursAgo: 30, read: false,
    title: 'Appointment request sent',
    body: 'Your request with Dr. Robert Osei is waiting for the clinic to approve it. We will let you know as soon as it is confirmed.',
  },
  {
    user: 'john', appt: 'physical-upcoming', type: 'appointment_approved', hoursAgo: 52, read: true,
    title: 'Appointment confirmed',
    body: 'Your annual physical with Dr. Sarah Kim at Midtown Clinic is confirmed.',
  },
  {
    user: 'john', appt: 'checkup-soon', type: 'appointment_reminder', hoursAgo: 6, read: false,
    title: 'Visit coming up',
    body: 'Reminder: you are booked with Dr. Sarah Kim at Midtown Clinic. Please arrive ten minutes early.',
  },
  {
    user: 'john', appt: 'checkup-soon', type: 'appointment_reminder', hoursAgo: 6, read: false,
    channel: 'email',
    title: 'Visit coming up',
    body: 'Reminder: you are booked with Dr. Sarah Kim at Midtown Clinic. Please arrive ten minutes early.',
  },
  {
    user: 'jordan', appt: 'flu-moved', type: 'appointment_rescheduled', hoursAgo: 20, read: false,
    title: 'Appointment moved',
    body: 'Your flu shot has been moved. The new time is waiting for the clinic to approve it.',
  },
  {
    user: 'john', appt: 'knee-recheck', type: 'reschedule_required', hoursAgo: 3, read: false,
    title: 'Please reschedule your visit',
    body: 'Dr. Elena Rossi is away on the day of your knee follow-up. Pick a new time from My Appointments.',
  },
  {
    user: 'lucia', appt: 'ankle-recheck', type: 'reschedule_required', hoursAgo: 4, read: false,
    title: 'Please reschedule your visit',
    body: 'Dr. Elena Rossi is away on the day of your ankle re-check. Pick a new time from My Appointments.',
  },
  {
    user: 'lucia', type: 'refill_approved', hoursAgo: 190, read: true,
    title: 'Refill approved',
    body: 'Dr. Julia Diaz approved your refill of Triamcinolone 0.1% cream. It has been sent to your pharmacy.',
  },
  {
    user: 'marcus', appt: 'knee-bumped', type: 'appointment_cancelled', hoursAgo: 300, read: true,
    title: 'Appointment cancelled',
    body: 'Your knee assessment was cancelled by the clinic because of a clinic closure. Please book a new time.',
  },
  {
    user: 'kevin', type: 'refill_denied', hoursAgo: 260, read: true,
    title: 'Refill needs a visit first',
    body: 'Dr. Aisha Patel would like to see Kevin before renewing the albuterol inhaler. Book a follow-up from Find a Doctor.',
  },
  {
    user: 'admin', appt: 'bp-check', type: 'appointment_requested', hoursAgo: 30, read: false,
    title: 'New appointment request',
    body: 'John Doe requested a slot with Dr. Robert Osei. Approve or decline it from Appointments.',
  },
];

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------
/** Weekday -> clinic key for one physician, from their site assignments. */
function siteByWeekday(doctor) {
  const map = {};
  for (const [site, days] of Object.entries(doctor.sites)) {
    for (const day of days) map[day] = site;
  }
  return map;
}

/**
 * Resolve every appointment spec onto a concrete date, weekday, and clinic
 * site. Runs before the transaction opens so a bad spec fails without touching
 * the database, and enforces the two invariants the schema cares about: a
 * booking must sit on a day its doctor actually holds clinic, and no two live
 * bookings may claim the same doctor/date/time (idx_appt_no_double_book).
 */
function placeAppointments() {
  const sites = Object.fromEntries(DOCTORS.map((d) => [d.key, siteByWeekday(d)]));
  const claimed = new Set();

  return APPOINTMENTS.map((a) => {
    const when = a.ahead ? businessDaysAhead(a.ahead) : weekdayDate(a.week, a.day);
    const weekday = when.getDay();
    const site = sites[a.doctor][weekday];
    if (!site) {
      throw new Error(`Seed: ${a.doctor} holds no clinic on weekday ${weekday} ("${a.reason}")`);
    }

    const date = isoDate(when);
    // Cancelled rows are exempt from the unique index — a freed slot is meant
    // to be re-bookable — so only the live ones need to be distinct.
    if (a.status !== 'cancelled') {
      const slot = `${a.doctor} ${date} ${a.time}`;
      if (claimed.has(slot)) throw new Error(`Seed: two live appointments claim ${slot}`);
      claimed.add(slot);
    }

    return { ...a, date, weekday, site };
  });
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------
// The curated rows above cover the specific moments a demo has to hit. They do
// not make the clinic look busy, and two reports are only meaningful against a
// realistic book: Provider Utilization is a percentage of capacity, so a nearly
// empty schedule reads as a broken practice rather than a quiet one, and the
// Daily Appointment Report is run against a single day and needs that day to
// have patients on it.
//
// The filler below books the remaining slots up to a per-physician target. The
// targets differ on purpose — a utilization table where every row reads the same
// tells an administrator nothing about how to move work between providers.
// Targets stay well short of full so there are open slots left to book into
// during a live demonstration. A fully booked physician has nothing to show.
const FILL_TARGET = {
  skim: 0.72, rosei: 0.66, jdiaz: 0.48, apatel: 0.57,
  erossi: 0.54, dkim: 0.44, lbennett: 0.61,
};

// The demo window: last Monday through the Wednesday of the current week.
// Week -1 is wholly in the past; week 0 stops at Wednesday so the book ends on
// the evening of the demonstration date rather than trailing off into a future
// nobody will look at.
const FILL_WINDOW = [
  { week: -1, days: [MON, TUE, WED, THU, FRI] },
  { week: 0, days: [MON, TUE, WED] },
];

// Dr. Rossi is away on the Wednesday. Declared here as well as inserted below
// so the filler does not book slots the availability block removes.
const BLOCK = {
  doctor: 'erossi',
  week: 0,
  startDay: WED,
  endDay: WED,
  reason: 'Attending the national orthopedic conference',
};

const FILL_REASONS = [
  'Annual physical', 'Follow-up visit', 'Blood pressure check', 'Medication review',
  'Lab results review', 'Persistent cough', 'Back pain', 'Headaches',
  'Skin rash', 'Post-operative check', 'Fatigue', 'Joint pain',
  'Routine screening', 'Seasonal allergies', 'Sleep problems', 'Dizziness',
];
const FILL_NOTES = [
  'Patient stable. Continue current management and review at next visit.',
  'Symptoms improving. No change to treatment plan.',
  'Examination unremarkable. Reassurance given and safety-netting advised.',
  'Discussed lifestyle measures. Follow-up arranged in three months.',
  'Vitals within normal range. Routine bloods requested.',
  'Responding well to treatment. Dose unchanged.',
];
const FILL_PATIENT_CANCELS = [
  'Schedule conflict', 'Feeling better / no longer needed',
  'Transport or access problem', 'Cost or insurance concern',
];
const FILL_PRACTICE_CANCELS = [
  'Provider unavailable', 'Clinic closure', 'Duplicate booking',
];
const FILL_NO_SHOW = [
  'Did not attend, no contact', 'Arrived too late to be seen',
  'Patient called after the fact',
];

/** Deterministic 0..1 from a string, so a reseed reproduces the same book. */
function spread(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function pick(list, seed) {
  return list[Math.floor(spread(seed) * list.length) % list.length];
}

/** The 14 slot start times a 09:00-12:00 + 13:00-17:00 day generates. */
function daySlots() {
  const out = [];
  for (const [from, to] of [['09:00', '12:00'], ['13:00', '17:00']]) {
    const start = Number(from.slice(0, 2)) * 60;
    const end = Number(to.slice(0, 2)) * 60;
    for (let t = start; t + 30 <= end; t += 30) {
      out.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${t % 60 === 0 ? '00' : '30'}`);
    }
  }
  return out;
}

/**
 * Book the schedule up to each physician's target, around the curated rows.
 *
 * Status follows the calendar rather than being assigned at random: a visit in
 * the past has already resolved into completed, missed, or cancelled, and one in
 * the future is still awaiting approval or already confirmed. Generating a
 * "completed" visit for next Tuesday would put the reports into a state the
 * application itself can never produce.
 */
function fillSchedule(placed) {
  const sites = Object.fromEntries(DOCTORS.map((d) => [d.key, siteByWeekday(d)]));
  // Bulk volume goes to the background population. The named patients hold only
  // the curated visits above, so opening one of their records during a demo
  // shows a book a real person could have rather than a wall of rows.
  const patientKeys = BACKGROUND_PATIENTS.map((p) => p.key);
  const slots = daySlots();
  const today = isoDate(new Date());

  // Live curated rows own their slot; cancelled ones released it.
  const claimed = new Set(
    placed.filter((a) => a.status !== 'cancelled').map((a) => `${a.doctor} ${a.date} ${a.time}`)
  );

  // Days the availability block removes: booking into them would contradict
  // what the patient-facing availability search returns.
  const blocked = new Set();
  for (let d = BLOCK.startDay; d <= BLOCK.endDay; d += 1) {
    blocked.add(`${BLOCK.doctor} ${isoDate(weekdayDate(BLOCK.week, d))}`);
  }

  const extra = [];
  for (const doctor of DOCTORS) {
    const target = FILL_TARGET[doctor.key] ?? 0.7;

    for (const { week: w, days } of FILL_WINDOW) {
      for (const weekday of days) {
        const site = sites[doctor.key][weekday];
        if (!site) continue;
        const date = isoDate(weekdayDate(w, weekday));
        if (blocked.has(`${doctor.key} ${date}`)) continue;

        for (const time of slots) {
          const slot = `${doctor.key} ${date} ${time}`;
          if (claimed.has(slot)) continue;
          if (spread(slot) > target) continue;

          const roll = spread(`${slot}#s`);
          let status;
          let cancelReason = null;
          let cancelledBy = null;
          let notes = null;

          if (date < today) {
            // Past. Most visits happened; the rest are the losses the
            // Cancellation report exists to surface.
            if (roll < 0.78) {
              status = 'completed';
              notes = pick(FILL_NOTES, `${slot}#n`);
            } else if (roll < 0.87) {
              status = 'no_show';
              cancelReason = pick(FILL_NO_SHOW, `${slot}#c`);
            } else if (roll < 0.94) {
              status = 'cancelled';
              cancelledBy = 'patient';
              cancelReason = pick(FILL_PATIENT_CANCELS, `${slot}#c`);
            } else {
              status = 'cancelled';
              cancelledBy = 'practice';
              cancelReason = pick(FILL_PRACTICE_CANCELS, `${slot}#c`);
            }
          } else if (date === today) {
            // Today's clinic: earlier slots already seen, later ones still to come.
            if (time < '12:00' && roll < 0.7) {
              status = 'completed';
              notes = pick(FILL_NOTES, `${slot}#n`);
            } else {
              status = 'confirmed';
            }
          } else {
            // Future. A quarter are still awaiting approval so the admin queue
            // is never empty.
            status = roll < 0.25 ? 'pending' : 'confirmed';
          }

          if (status !== 'cancelled') claimed.add(slot);

          extra.push({
            patient: patientKeys[Math.floor(spread(`${slot}#p`) * patientKeys.length) % patientKeys.length],
            doctor: doctor.key,
            time,
            reason: pick(FILL_REASONS, `${slot}#r`),
            status,
            cancelReason,
            cancelledBy,
            notes,
            date,
            weekday,
            site,
          });
        }
      }
    }
  }
  return extra;
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
/**
 * Drop every table in the public schema, then let the schema be re-applied.
 *
 * A TRUNCATE would be enough to clear rows, but not to change shape: tables
 * left over from an earlier version of the schema keep their old columns, and
 * `CREATE TABLE IF NOT EXISTS` will not alter them. Dropping is what makes a
 * reset also a restructure. The table list is read from the catalogue rather
 * than hard-coded so tables this version of the code has never heard of — an
 * older schema's, or a migration ledger — are removed too.
 */
async function wipe() {
  const rows = await db.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  if (rows.length === 0) {
    console.log('• Database is already empty.');
    return;
  }
  const names = rows.map((r) => `"${r.tablename}"`).join(', ');
  await db.query(`DROP TABLE IF EXISTS ${names} CASCADE`);
  console.log(`• Dropped ${rows.length} existing tables.`);
}

async function alreadySeeded() {
  const row = await db.one('SELECT COUNT(*) AS n FROM users');
  return row.n > 0;
}

async function seed(placed) {
  await db.tx(async (c) => {
    const q = (text, params) => c.query(text, params);

    // --- Admin ---------------------------------------------------------------
    const admin = await q(
      `INSERT INTO users (email, password_hash, role, first_name, last_name, phone)
       VALUES ($1, $2, 'admin', 'Clinic', 'Administrator', '212-555-0100') RETURNING id`,
      ['admin@medisync.health', hash('admin123')]
    );
    const adminId = admin.rows[0].id;

    // --- Locations -----------------------------------------------------------
    const locationId = {};
    for (const l of LOCATIONS) {
      const r = await q(
        `INSERT INTO locations (name, address, city, state, zip, phone)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [l.name, l.address, l.city, l.state, l.zip, l.phone]
      );
      locationId[l.key] = r.rows[0].id;
    }

    // --- Specialties ---------------------------------------------------------
    const specialtyId = {};
    for (const [name, description] of SPECIALTIES) {
      const r = await q(
        `INSERT INTO specialties (name, description) VALUES ($1, $2) RETURNING id`,
        [name, description]
      );
      specialtyId[name] = r.rows[0].id;
    }

    // --- Physicians ----------------------------------------------------------
    // Each gets a portal login (role='doctor') linked to their directory entry.
    // users.phone stays null for them: their number is the public office line,
    // which belongs on the directory row, not on the reminder channel.
    const doctorId = {};
    const doctorUserId = {};
    for (const d of DOCTORS) {
      const u = await q(
        `INSERT INTO users (email, password_hash, role, first_name, last_name)
         VALUES ($1, $2, 'doctor', $3, $4) RETURNING id`,
        [d.email, hash('doctor123'), d.first, d.last]
      );
      const r = await q(
        `INSERT INTO doctors
           (prefix, first_name, last_name, specialty_id, email, phone, bio, room, active, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9) RETURNING id`,
        [d.prefix, d.first, d.last, specialtyId[d.specialty], d.email, d.phone, d.bio, d.room, u.rows[0].id]
      );
      doctorId[d.key] = r.rows[0].id;
      doctorUserId[d.key] = u.rows[0].id;
    }

    // --- Weekly schedules ----------------------------------------------------
    // Mon-Fri, a morning and an afternoon window, in 30-minute slots. The
    // window carries the site, so a physician working two buildings produces
    // slots at the right address for each day.
    for (const d of DOCTORS) {
      for (const [site, days] of Object.entries(d.sites)) {
        for (const weekday of days) {
          await q(
            `INSERT INTO doctor_schedules
               (doctor_id, location_id, weekday, start_time, end_time, slot_minutes)
             VALUES ($1, $2, $3, '09:00', '12:00', 30),
                    ($1, $2, $3, '13:00', '17:00', 30)`,
            [doctorId[d.key], locationId[site], weekday]
          );
        }
      }
    }

    // --- Patients ------------------------------------------------------------
    const patientId = {};
    const patientUserId = {};
    for (const p of PATIENTS) {
      const u = await q(
        `INSERT INTO users
           (email, password_hash, role, first_name, last_name, phone, notify_email, notify_sms)
         VALUES ($1, $2, 'patient', $3, $4, $5, $6, $7) RETURNING id`,
        [p.email, hash('patient123'), p.first, p.last, p.phone, p.notifyEmail, p.notifySms]
      );
      const r = await q(
        `INSERT INTO patients (user_id, date_of_birth, gender, address, insurance_provider)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [u.rows[0].id, p.dob, p.gender, p.address, p.insurance]
      );
      patientId[p.key] = r.rows[0].id;
      patientUserId[p.key] = u.rows[0].id;
    }

    // --- Appointments --------------------------------------------------------
    // Timestamps are derived from the appointment date so the audit trail reads
    // correctly whenever the seed runs: booked before it was approved, approved
    // before the visit, and never in the future. A no-show is stamped at the end
    // of its own day, which is when a front desk sweeps the schedule.
    const apptId = {};
    for (const a of placed) {
      const r = await q(
        `INSERT INTO appointments
           (patient_id, doctor_id, location_id, appt_date, appt_time, reason, status,
            approved_by, approved_at, cancel_reason, cancelled_by, cancelled_at,
            notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7,
                 CASE WHEN $7 IN ('confirmed', 'completed', 'no_show') THEN $8::integer END,
                 CASE WHEN $7 IN ('confirmed', 'completed', 'no_show')
                      THEN LEAST(now(), $4::date - INTERVAL '3 days') END,
                 $9, $10,
                 CASE WHEN $7 = 'cancelled' THEN LEAST(now(), $4::date - INTERVAL '2 days')
                      WHEN $7 = 'no_show'   THEN $4::date + INTERVAL '18 hours' END,
                 $11,
                 LEAST(now(), $4::date - INTERVAL '10 days'),
                 now())
         RETURNING id`,
        [
          patientId[a.patient], doctorId[a.doctor], locationId[a.site],
          a.date, a.time, a.reason, a.status, adminId,
          a.cancelReason || null, a.cancelledBy || null, a.notes || null,
        ]
      );
      if (a.key) apptId[a.key] = r.rows[0].id;
    }

    // A rescheduled booking points back at the row it replaced, exactly as the
    // reschedule endpoint records it. Linked after the fact because both rows
    // have to exist first.
    for (const a of placed) {
      if (!a.rescheduledFrom) continue;
      await q('UPDATE appointments SET rescheduled_from_id = $1 WHERE id = $2', [
        apptId[a.rescheduledFrom], apptId[a.key],
      ]);
    }

    // --- Schedule block ------------------------------------------------------
    // Dr. Rossi is away for three days in a fortnight. Flagging the bookings
    // caught inside it is the same statement the admin block endpoint runs, so
    // the "needs rescheduling" callout is live on a fresh database.
    const blockStart = isoDate(weekdayDate(BLOCK.week, BLOCK.startDay));
    const blockEnd = isoDate(weekdayDate(BLOCK.week, BLOCK.endDay));
    await q(
      `INSERT INTO schedule_blocks (doctor_id, start_date, end_date, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [doctorId[BLOCK.doctor], blockStart, blockEnd, BLOCK.reason, adminId]
    );
    await q(
      `UPDATE appointments
          SET reschedule_required = true, updated_at = now()
        WHERE doctor_id = $1
          AND appt_date BETWEEN $2 AND $3
          AND status IN ('pending', 'confirmed')`,
      [doctorId[BLOCK.doctor], blockStart, blockEnd]
    );

    // --- Prescriptions -------------------------------------------------------
    const rxId = {};
    for (const rx of PRESCRIPTIONS) {
      const r = await q(
        `INSERT INTO prescriptions
           (patient_id, doctor_id, appointment_id, medication, dosage, frequency,
            duration, instructions, refills_allowed, refills_used, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [
          patientId[rx.patient], doctorId[rx.doctor], apptId[rx.appt], rx.medication,
          rx.dosage, rx.frequency, rx.duration, rx.instructions,
          rx.allowed, rx.used, rx.status,
        ]
      );
      rxId[rx.key] = r.rows[0].id;
    }

    for (const req of REFILL_REQUESTS) {
      await q(
        `INSERT INTO refill_requests
           (prescription_id, patient_id, note, status, decision_note, decided_by,
            decided_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 CASE WHEN $4 <> 'pending' THEN now() - ($7 || ' days')::interval END,
                 now() - ($8 || ' days')::interval)`,
        [
          rxId[req.prescription], patientId[req.patient], req.note, req.status,
          req.decisionNote || null, req.decidedBy ? doctorId[req.decidedBy] : null,
          req.decidedDaysAgo || 0, req.daysAgo,
        ]
      );
    }

    // --- Notifications -------------------------------------------------------
    const userIdFor = (key) => (key === 'admin' ? adminId : patientUserId[key]);
    for (const n of NOTIFICATIONS) {
      await q(
        `INSERT INTO notifications
           (user_id, appointment_id, channel, type, title, body, status, read_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'sent',
                 CASE WHEN $7 THEN now() - INTERVAL '1 hour' END,
                 now() - ($8 || ' hours')::interval)`,
        [
          userIdFor(n.user), n.appt ? apptId[n.appt] : null, n.channel || 'in_app',
          n.type, n.title, n.body, n.read, n.hoursAgo,
        ]
      );
    }
  });

  console.log('• Seed complete.');
  console.log(
    `  ${LOCATIONS.length} locations · ${SPECIALTIES.length} specialties · ` +
      `${DOCTORS.length} physicians · ${PATIENTS.length} patients · ` +
      `${placed.length} appointments`
  );
  console.log('  Admin login:   admin@medisync.health / admin123');
  console.log('  Patient login: jdoe@example.com / patient123');
  console.log('  Doctor login:  skim@medisync.health / doctor123 (any seeded physician works)');
}

async function main() {
  const curated = placeAppointments();
  // Curated rows first: the filler books around whatever they already claimed.
  const placed = curated.concat(fillSchedule(curated));
  // On a reset the tables are dropped first and rebuilt from schema.sql, so the
  // shape is refreshed as well as the rows.
  if (RESET) await wipe();
  await db.init();
  if (!RESET && await alreadySeeded()) {
    console.log('Database already has data — skipping seed. Use "npm run reset-db" to force.');
    return;
  }
  await seed(placed);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
