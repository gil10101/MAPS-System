-- ============================================================================
-- MAPS - Medical Appointment and Patient Scheduling System
-- PostgreSQL schema
-- ============================================================================
-- Executed automatically on server startup (see database.js). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users: login credentials + role. A user is either a patient or an admin.
-- Patient-specific profile data lives in the "patients" table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'admin')),
    full_name     TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- patients: extended profile for users with role = 'patient'
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth      DATE,
    phone              TEXT,
    gender             TEXT CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say') OR gender IS NULL),
    address            TEXT,
    insurance_provider TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- specialties: medical specialties a doctor can belong to
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS specialties (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT
);

-- ----------------------------------------------------------------------------
-- doctors: physicians patients can book with
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name    TEXT NOT NULL,
    specialty_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL,
    email        TEXT,
    phone        TEXT,
    bio          TEXT,
    room         TEXT,
    active       BOOLEAN NOT NULL DEFAULT true,   -- accepting appointments
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- doctor_schedules: weekly recurring availability for a doctor.
-- weekday: 0 = Sunday .. 6 = Saturday. Times are 'HH:MM' 24h strings.
-- Appointment slots are generated from these windows in slot_minutes chunks.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_schedules (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id    INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time   VARCHAR(5) NOT NULL,   -- 'HH:MM'
    end_time     VARCHAR(5) NOT NULL,   -- 'HH:MM'
    slot_minutes INTEGER NOT NULL DEFAULT 30
);

-- ----------------------------------------------------------------------------
-- appointments: a booking between a patient and a doctor at a point in time.
--
-- Two INDEPENDENT axes — see migrations/001 for the full rationale:
--
--   status  (lifecycle, staff/time-driven, aligned to HL7 FHIR)
--       booked ──┬──► completed              (patient was seen)
--                ├──► cancelled              (+ reason + who, terminal)
--                └──► no_show                (never arrived, terminal)
--     There is deliberately no "pending"/approval state: booking is atomic and
--     self-confirming, exactly as FHIR's `booked` ("confirmed to go ahead")
--     and Epic's Direct Scheduling define it. No clinic supervisor approves
--     individual bookings, so no status models one.
--
--   confirmation_status  (patient-driven, orthogonal)
--       unconfirmed ──► confirmed         (patient acknowledged a reminder)
--                   └─► cancel_requested  (patient asked to cancel)
--     A visit can be booked-and-unconfirmed; those are the ones a front desk
--     chases. Folding this into `status` is what made "confirmed" ambiguous.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id  INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appt_date  DATE NOT NULL,
    appt_time  VARCHAR(5) NOT NULL,     -- slot start, 'HH:MM'
    reason     TEXT,
    status     TEXT NOT NULL DEFAULT 'booked'
               CHECK (status IN ('booked', 'completed', 'cancelled', 'no_show')),

    confirmation_status TEXT NOT NULL DEFAULT 'unconfirmed'
               CHECK (confirmation_status IN ('unconfirmed', 'confirmed', 'cancel_requested')),
    confirmed_at TIMESTAMPTZ,

    -- Cancellations capture why and by whom: a bare status flip discards the
    -- data practices actually report on (late-cancel vs practice-bumped).
    cancel_reason TEXT,
    cancelled_by  TEXT CHECK (cancelled_by IS NULL
                              OR cancelled_by IN ('patient', 'practice', 'unknown')),
    cancelled_at  TIMESTAMPTZ,

    notes      TEXT,                    -- clinical/visit notes (set on completion)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent two live appointments for the same doctor/date/time. Cancelled ones
-- are excluded so a freed slot can be re-booked; a no-show still consumed its
-- slot, so it keeps blocking.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_patient      ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor       ON appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appt_confirmation ON appointments (confirmation_status);
CREATE INDEX IF NOT EXISTS idx_appt_date_status  ON appointments (appt_date, status);
CREATE INDEX IF NOT EXISTS idx_doctor_specialty  ON doctors (specialty_id);
CREATE INDEX IF NOT EXISTS idx_schedule_doctor   ON doctor_schedules (doctor_id, weekday);
