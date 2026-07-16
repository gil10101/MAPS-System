/**
 * Seed script — populates the database with demo data so the app is usable
 * immediately for a demo/presentation.
 *
 *   npm run seed            # insert demo data (skips if data already exists)
 *   npm run reset-db        # wipe all tables, then re-seed
 *
 * Demo logins created:
 *   admin@maps.health    / admin123     (clinic administrator)
 *   jdoe@example.com     / patient123   (patient)
 *   msmith@example.com   / patient123   (patient)
 *   schen@maps.health    / doctor123    (physician — Dr. Sarah Chen)
 *   mreid@maps.health    / doctor123    (physician — Dr. Marcus Reid)
 *   (every seeded physician gets a login: their directory email / doctor123)
 */
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const RESET = process.argv.includes('--reset');

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

async function wipe() {
  await db.query(`
    TRUNCATE test_results, refill_requests, prescriptions, medical_history,
             appointments, doctor_schedules, doctors, specialties, patients, users
    RESTART IDENTITY CASCADE
  `);
  console.log('• Existing data wiped.');
}

async function alreadySeeded() {
  const row = await db.one('SELECT COUNT(*) AS n FROM users');
  return row.n > 0;
}

async function seed() {
  await db.tx(async (c) => {
    const q = (text, params) => c.query(text, params);

    // --- Admin ---------------------------------------------------------------
    await q(
      `INSERT INTO users (email, password_hash, role, full_name) VALUES ($1, $2, 'admin', $3)`,
      ['admin@maps.health', hash('admin123'), 'Clinic Administrator']
    );

    // --- Specialties ---------------------------------------------------------
    const specialties = [
      ['Family Medicine', 'General and preventive care for patients of all ages.'],
      ['Cardiology', 'Diagnosis and treatment of heart and vascular conditions.'],
      ['Dermatology', 'Care for skin, hair, and nail conditions.'],
      ['Pediatrics', 'Medical care for infants, children, and adolescents.'],
      ['Orthopedics', 'Treatment of the musculoskeletal system.'],
      ['Neurology', 'Care for disorders of the nervous system.'],
    ];
    const specialtyIds = {};
    for (const [name, desc] of specialties) {
      const r = await q(
        `INSERT INTO specialties (name, description) VALUES ($1, $2) RETURNING id`,
        [name, desc]
      );
      specialtyIds[name] = r.rows[0].id;
    }

    // --- Doctors ---------------------------------------------------------------
    const doctors = [
      ['Dr. Sarah Chen', 'Family Medicine', 'schen@maps.health', '212-555-0101',
        'Board-certified family physician with 12 years of experience in preventive care.', 'A-101'],
      ['Dr. Marcus Reid', 'Cardiology', 'mreid@maps.health', '212-555-0102',
        'Cardiologist specializing in hypertension and heart failure management.', 'B-204'],
      ['Dr. Aisha Patel', 'Dermatology', 'apatel@maps.health', '212-555-0103',
        'Dermatologist focused on skin cancer screening and acne treatment.', 'C-110'],
      ['Dr. James Okafor', 'Pediatrics', 'jokafor@maps.health', '212-555-0104',
        'Pediatrician with a gentle approach to childhood wellness and vaccinations.', 'A-115'],
      ['Dr. Elena Rossi', 'Orthopedics', 'erossi@maps.health', '212-555-0105',
        'Orthopedic surgeon treating sports injuries and joint pain.', 'D-320'],
      ['Dr. David Kim', 'Neurology', 'dkim@maps.health', '212-555-0106',
        'Neurologist experienced in migraine and seizure disorders.', 'B-210'],
      ['Dr. Laura Bennett', 'Family Medicine', 'lbennett@maps.health', '212-555-0107',
        'Family medicine physician passionate about chronic disease management.', 'A-103'],
    ];
    const doctorIds = [];
    for (const [name, specialty, email, phone, bio, room] of doctors) {
      // Each physician gets a portal login (role='doctor') linked to their
      // directory entry. Same email as the directory, password doctor123.
      const u = await q(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES ($1, $2, 'doctor', $3) RETURNING id`,
        [email, hash('doctor123'), name]
      );
      const r = await q(
        `INSERT INTO doctors (full_name, specialty_id, email, phone, bio, room, active, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7) RETURNING id`,
        [name, specialtyIds[specialty], email, phone, bio, room, u.rows[0].id]
      );
      doctorIds.push(r.rows[0].id);
    }

    // --- Doctor weekly schedules ----------------------------------------------
    // Every doctor works Mon-Fri (weekday 1..5), morning + afternoon windows.
    for (const docId of doctorIds) {
      for (let weekday = 1; weekday <= 5; weekday++) {
        await q(
          `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes)
           VALUES ($1, $2, '09:00', '12:00', 30), ($1, $2, '13:00', '17:00', 30)`,
          [docId, weekday]
        );
      }
    }

    // --- Sample patients -------------------------------------------------------
    const patientSpecs = [
      ['John Doe', 'jdoe@example.com', '1988-04-12', '917-555-2001', 'male',
        '123 Main St, New York, NY', 'BlueCross'],
      ['Mary Smith', 'msmith@example.com', '1995-09-30', '917-555-2002', 'female',
        '456 Oak Ave, Brooklyn, NY', 'Aetna'],
    ];
    const patientIds = [];
    for (const [name, email, dob, phone, gender, address, insurance] of patientSpecs) {
      const u = await q(
        `INSERT INTO users (email, password_hash, role, full_name)
         VALUES ($1, $2, 'patient', $3) RETURNING id`,
        [email, hash('patient123'), name]
      );
      const p = await q(
        `INSERT INTO patients (user_id, date_of_birth, phone, gender, address, insurance_provider)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [u.rows[0].id, dob, phone, gender, address, insurance]
      );
      patientIds.push(p.rows[0].id);
    }

    // --- Sample appointments ---------------------------------------------------
    // Covers every lifecycle state and both confirmation states, so dashboards
    // and the no-show report have something real to show. Completed visits
    // carry a clinical note (written by the doctor at completion).
    // Columns: patient, doctor, date, time, reason, status, confirmation,
    //          cancel_reason, cancelled_by, notes
    const appts = [
      // Booked and confirmed — patient answered a reminder.
      [patientIds[0], doctorIds[0], '2026-07-20', '09:30', 'Annual checkup', 'booked', 'confirmed', null, null, null],
      [patientIds[1], doctorIds[2], '2026-07-21', '10:00', 'Skin rash consultation', 'booked', 'confirmed', null, null, null],
      // Booked but silent — the ones a front desk actually chases.
      [patientIds[0], doctorIds[1], '2026-07-22', '13:30', 'Blood pressure follow-up', 'booked', 'unconfirmed', null, null, null],
      [patientIds[0], doctorIds[4], '2026-07-28', '15:00', 'Knee pain', 'booked', 'unconfirmed', null, null, null],
      // Past: kept (with visit notes), missed, and cancelled by each side.
      [patientIds[1], doctorIds[0], '2026-06-15', '11:00', 'Flu symptoms', 'completed', 'confirmed', null, null,
        'Presented with fever (38.4°C), sore throat, and myalgia for 3 days. Rapid flu test positive (influenza A). ' +
        'Advised rest, fluids, and OTC antipyretics; prescribed oseltamivir. Return if symptoms worsen or persist past 7 days.'],
      [patientIds[0], doctorIds[1], '2026-05-28', '10:30', 'Chest tightness on exertion', 'completed', 'confirmed', null, null,
        'Reports occasional chest tightness climbing stairs, resolves with rest. BP 148/92, HR 78 regular. ' +
        'ECG unremarkable. Started lisinopril for hypertension; ordered lipid panel. Follow up in 4 weeks to reassess BP.'],
      [patientIds[0], doctorIds[3], '2026-06-10', '14:00', 'Consultation', 'cancelled', 'unconfirmed', 'Patient cancelled — schedule conflict', 'patient', null],
      [patientIds[1], doctorIds[1], '2026-06-24', '09:00', 'Cardiology review', 'cancelled', 'confirmed', 'Provider unavailable — clinic rescheduled', 'practice', null],
      [patientIds[0], doctorIds[2], '2026-06-30', '16:00', 'Mole check', 'no_show', 'unconfirmed', 'Did not attend, no contact', null, null],
    ];
    const apptIds = [];
    for (const a of appts) {
      const r = await q(
        `INSERT INTO appointments
           (patient_id, doctor_id, appt_date, appt_time, reason, status,
            confirmation_status, cancel_reason, cancelled_by, notes,
            confirmed_at, cancelled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 CASE WHEN $7 = 'confirmed' THEN now() END,
                 CASE WHEN $6 = 'cancelled' THEN now() END)
         RETURNING id`,
        a
      );
      apptIds.push(r.rows[0].id);
    }

    // --- Clinical records --------------------------------------------------
    // Doctor user ids for recorded_by (users were inserted before doctors).
    const docUser = async (doctorId) =>
      (await q('SELECT user_id FROM doctors WHERE id = $1', [doctorId])).rows[0].user_id;
    const patientUser = async (patientId) =>
      (await q('SELECT user_id FROM patients WHERE id = $1', [patientId])).rows[0].user_id;

    // Medical history: mix of doctor-entered and patient self-reported.
    const historyRows = [
      // patient_id, kind, description, severity, noted_on, status, source, recorded_by
      [patientIds[0], 'condition', 'Essential hypertension', null, '2026-05-28', 'active', 'doctor', await docUser(doctorIds[1])],
      [patientIds[0], 'allergy', 'Penicillin — hives and facial swelling', 'severe', '2010-03-01', 'active', 'doctor', await docUser(doctorIds[1])],
      [patientIds[0], 'surgery', 'Appendectomy', null, '2005-08-15', 'resolved', 'patient', await patientUser(patientIds[0])],
      [patientIds[0], 'family', 'Father: type 2 diabetes; mother: hypertension', null, null, 'active', 'patient', await patientUser(patientIds[0])],
      [patientIds[1], 'allergy', 'Seasonal pollen — rhinitis', 'mild', null, 'active', 'patient', await patientUser(patientIds[1])],
      [patientIds[1], 'immunization', 'Influenza vaccine', null, '2025-10-12', 'resolved', 'doctor', await docUser(doctorIds[0])],
    ];
    for (const h of historyRows) {
      await q(
        `INSERT INTO medical_history
           (patient_id, kind, description, severity, noted_on, status, source, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        h
      );
    }

    // Prescriptions: John on lisinopril (from the cardiology visit) with an
    // open refill request; Mary's oseltamivir course completed.
    const rx1 = await q(
      `INSERT INTO prescriptions
         (patient_id, doctor_id, appointment_id, medication, dosage, frequency,
          duration, instructions, refills_allowed, status)
       VALUES ($1, $2, $3, 'Lisinopril', '10 mg', 'once daily', 'ongoing',
               'Take in the morning. Report persistent dry cough.', 3, 'active')
       RETURNING id`,
      [patientIds[0], doctorIds[1], apptIds[5]]
    );
    await q(
      `INSERT INTO prescriptions
         (patient_id, doctor_id, appointment_id, medication, dosage, frequency,
          duration, instructions, refills_allowed, status)
       VALUES ($1, $2, $3, 'Oseltamivir', '75 mg', 'twice daily', '5 days',
               'Take with food to reduce nausea.', 0, 'completed')`,
      [patientIds[1], doctorIds[0], apptIds[4]]
    );
    await q(
      `INSERT INTO refill_requests (prescription_id, patient_id, note)
       VALUES ($1, $2, 'Down to my last week of tablets.')`,
      [rx1.rows[0].id, patientIds[0]]
    );

    // Test results: one resulted (the lipid panel from the cardiology visit),
    // one still pending so the portal shows both states.
    await q(
      `INSERT INTO test_results
         (patient_id, doctor_id, appointment_id, test_name, status,
          result_summary, result_flag, resulted_at)
       VALUES ($1, $2, $3, 'Lipid panel', 'completed',
               'Total cholesterol 212 mg/dL (borderline high), LDL 138 mg/dL (borderline high), ' ||
               'HDL 48 mg/dL, triglycerides 130 mg/dL. Recommend dietary changes; recheck in 3 months.',
               'abnormal', now())`,
      [patientIds[0], doctorIds[1], apptIds[5]]
    );
    await q(
      `INSERT INTO test_results (patient_id, doctor_id, test_name)
       VALUES ($1, $2, 'Complete blood count (CBC)')`,
      [patientIds[0], doctorIds[1]]
    );
  });

  console.log('• Seed complete.');
  console.log('  Admin login:   admin@maps.health / admin123');
  console.log('  Patient login: jdoe@example.com / patient123');
  console.log('  Doctor login:  mreid@maps.health / doctor123 (any seeded doctor works)');
}

async function main() {
  await db.init();
  if (RESET) {
    await wipe();
  } else if (await alreadySeeded()) {
    console.log('Database already has data — skipping seed. Use "npm run reset-db" to force.');
    return;
  }
  await seed();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exit(1);
  });
