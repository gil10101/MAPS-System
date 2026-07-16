-- ============================================================================
-- MAPS - Medical Appointment and Patient Scheduling System
-- PostgreSQL schema
-- ============================================================================
-- Executed automatically on server startup (see database.js). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users: login credentials + role.
--   patient — self-registers; profile in "patients"
--   doctor  — created by an admin; linked from "doctors.user_id"
--   admin   — operational staff. Admins do NOT see clinical data (history,
--             notes, medications, results) — scheduling has no need-to-know.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'admin', 'doctor')),
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
    -- Login for the physician's own portal. Nullable: the directory entry can
    -- exist before an admin creates the account.
    user_id      INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
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

-- ----------------------------------------------------------------------------
-- Clinical records (see migrations/002 for the access model and rationale).
-- Visit notes live on appointments.notes — one visit, one note.
-- ----------------------------------------------------------------------------

-- medical_history: one row per fact. `source` records whether the patient
-- self-reported it or a doctor entered it — those carry different clinical
-- weight, so it is stored, never inferred.
CREATE TABLE IF NOT EXISTS medical_history (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN
                ('condition', 'allergy', 'surgery', 'immunization', 'family', 'other')),
    description TEXT NOT NULL,
    severity    TEXT CHECK (severity IN ('mild', 'moderate', 'severe') OR severity IS NULL),
    noted_on    DATE,
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
    source      TEXT NOT NULL CHECK (source IN ('patient', 'doctor')),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_patient ON medical_history (patient_id);

-- prescriptions: doctors create; patients ask via refill_requests, never by
-- editing the prescription.
CREATE TABLE IF NOT EXISTS prescriptions (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id      INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    medication     TEXT NOT NULL,
    dosage         TEXT NOT NULL,
    frequency      TEXT NOT NULL,
    duration       TEXT,
    instructions   TEXT,
    refills_allowed INTEGER NOT NULL DEFAULT 0 CHECK (refills_allowed >= 0),
    refills_used    INTEGER NOT NULL DEFAULT 0 CHECK (refills_used >= 0),
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'completed', 'stopped')),
    stopped_reason TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rx_patient ON prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_rx_doctor  ON prescriptions (doctor_id);

-- refill_requests: a real pending/approve flow — providers genuinely review
-- refills before authorizing them (unlike appointment booking).
CREATE TABLE IF NOT EXISTS refill_requests (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note            TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied')),
    decision_note   TEXT,
    decided_by      INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refill_rx     ON refill_requests (prescription_id);
CREATE INDEX IF NOT EXISTS idx_refill_status ON refill_requests (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_refill_one_pending
    ON refill_requests (prescription_id)
    WHERE status = 'pending';

-- test_results: two-phase like real orders — ordered (no result yet), then
-- completed. Patients see both; an ordered test shows as pending.
CREATE TABLE IF NOT EXISTS test_results (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id      INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    test_name      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ordered'
                   CHECK (status IN ('ordered', 'completed')),
    result_summary TEXT,
    result_flag    TEXT CHECK (result_flag IN ('normal', 'abnormal', 'critical')
                               OR result_flag IS NULL),
    ordered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resulted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_results_patient ON test_results (patient_id);
CREATE INDEX IF NOT EXISTS idx_results_doctor  ON test_results (doctor_id);
