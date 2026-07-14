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
 */
'use strict';

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./database');

const RESET = process.argv.includes('--reset');

function wipe() {
  // Order matters because of foreign keys.
  db.exec(`
    DELETE FROM appointments;
    DELETE FROM doctor_schedules;
    DELETE FROM doctors;
    DELETE FROM specialties;
    DELETE FROM patients;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  console.log('• Existing data wiped.');
}

function alreadySeeded() {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  return row.n > 0;
}

function hash(pw) {
  return bcrypt.hashSync(pw, 10);
}

function seed() {
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, role, full_name) VALUES (?, ?, ?, ?)`
  );
  const insertPatient = db.prepare(
    `INSERT INTO patients (user_id, date_of_birth, phone, gender, address, insurance_provider)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertSpecialty = db.prepare(
    `INSERT INTO specialties (name, description) VALUES (?, ?)`
  );
  const insertDoctor = db.prepare(
    `INSERT INTO doctors (full_name, specialty_id, email, phone, bio, room, active)
     VALUES (?, ?, ?, ?, ?, ?, 1)`
  );
  const insertSchedule = db.prepare(
    `INSERT INTO doctor_schedules (doctor_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertAppt = db.prepare(
    `INSERT INTO appointments (patient_id, doctor_id, appt_date, appt_time, reason, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // --- Admin -----------------------------------------------------------------
  insertUser.run('admin@maps.health', hash('admin123'), 'admin', 'Clinic Administrator');

  // --- Specialties -----------------------------------------------------------
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
    const info = insertSpecialty.run(name, desc);
    specialtyIds[name] = info.lastInsertRowid;
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
    const info = insertDoctor.run(name, specialtyIds[specialty], email, phone, bio, room);
    doctorIds.push(info.lastInsertRowid);
  }

  // --- Doctor weekly schedules ----------------------------------------------
  // Give every doctor Mon-Fri (weekday 1..5) morning + afternoon windows.
  for (const docId of doctorIds) {
    for (let weekday = 1; weekday <= 5; weekday++) {
      insertSchedule.run(docId, weekday, '09:00', '12:00', 30);
      insertSchedule.run(docId, weekday, '13:00', '17:00', 30);
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
    const uInfo = insertUser.run(email, hash('patient123'), 'patient', name);
    const pInfo = insertPatient.run(uInfo.lastInsertRowid, dob, phone, gender, address, insurance);
    patientIds.push(pInfo.lastInsertRowid);
  }

  // --- Sample appointments ---------------------------------------------------
  // A couple of upcoming + past appointments to make dashboards/reports non-empty.
  // Dates are relative to a fixed base to keep the seed deterministic.
  const appts = [
    [patientIds[0], doctorIds[0], '2026-07-20', '09:30', 'Annual checkup', 'confirmed'],
    [patientIds[0], doctorIds[1], '2026-07-22', '13:30', 'Blood pressure follow-up', 'pending'],
    [patientIds[1], doctorIds[2], '2026-07-21', '10:00', 'Skin rash consultation', 'confirmed'],
    [patientIds[1], doctorIds[0], '2026-06-15', '11:00', 'Flu symptoms', 'completed'],
    [patientIds[0], doctorIds[3], '2026-06-10', '14:00', 'Consultation', 'cancelled'],
  ];
  for (const a of appts) insertAppt.run(...a);

  console.log('• Seed complete.');
  console.log('  Admin login:   admin@maps.health / admin123');
  console.log('  Patient login: jdoe@example.com / patient123');
}

function main() {
  if (RESET) {
    wipe();
  } else if (alreadySeeded()) {
    console.log('Database already has data — skipping seed. Use "npm run reset-db" to force.');
    return;
  }
  const tx = db.transaction(seed);
  tx();
}

main();
