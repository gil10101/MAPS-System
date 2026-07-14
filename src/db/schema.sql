-- ============================================================================
-- MAPS - Medical Appointment and Patient Scheduling System
-- SQLite schema
-- ============================================================================
-- This schema is executed automatically on server startup (see database.js).
-- It is written to be idempotent (CREATE TABLE IF NOT EXISTS).
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------------------
-- users: login credentials + role. A user is either a patient or an admin.
-- Patient-specific profile data lives in the "patients" table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'admin')),
    full_name     TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------------------
-- patients: extended profile for users with role = 'patient'
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER NOT NULL UNIQUE,
    date_of_birth  TEXT,
    phone          TEXT,
    gender         TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say') OR gender IS NULL),
    address        TEXT,
    insurance_provider TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- specialties: medical specialties a doctor can belong to
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS specialties (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    description TEXT
);

-- ----------------------------------------------------------------------------
-- doctors: physicians patients can book with
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name     TEXT NOT NULL,
    specialty_id  INTEGER,
    email         TEXT,
    phone         TEXT,
    bio           TEXT,
    room          TEXT,
    active        INTEGER NOT NULL DEFAULT 1,   -- 1 = accepting appointments
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (specialty_id) REFERENCES specialties(id) ON DELETE SET NULL
);

-- ----------------------------------------------------------------------------
-- doctor_schedules: weekly recurring availability for a doctor.
-- weekday: 0 = Sunday .. 6 = Saturday. Times are 'HH:MM' 24h strings.
-- Appointment slots are generated from these windows in slot_minutes chunks.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_schedules (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id     INTEGER NOT NULL,
    weekday       INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time    TEXT NOT NULL,   -- 'HH:MM'
    end_time      TEXT NOT NULL,   -- 'HH:MM'
    slot_minutes  INTEGER NOT NULL DEFAULT 30,
    FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------------------------
-- appointments: a booking between a patient and a doctor at a point in time.
-- status: pending -> confirmed / cancelled / completed
-- The UNIQUE index below prevents double-booking the same doctor slot for any
-- appointment that is not cancelled.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id    INTEGER NOT NULL,
    doctor_id     INTEGER NOT NULL,
    appt_date     TEXT NOT NULL,   -- 'YYYY-MM-DD'
    appt_time     TEXT NOT NULL,   -- 'HH:MM'
    reason        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed')),
    notes         TEXT,            -- clinical/visit notes (set on completion)
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
    FOREIGN KEY (doctor_id)  REFERENCES doctors(id)  ON DELETE CASCADE
);

-- Prevent two active (non-cancelled) appointments for the same doctor/date/time.
-- Cancelled appointments are excluded so a freed slot can be re-booked.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status != 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_patient ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor  ON appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_specialty ON doctors (specialty_id);
