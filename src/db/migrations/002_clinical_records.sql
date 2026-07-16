-- ============================================================================
-- 002 — Clinical records: doctor logins, medical history, prescriptions,
--       refill requests, test results
-- ============================================================================
-- Run once against an existing database:  npm run migrate
-- Fresh databases get this shape directly from schema.sql.
--
-- WHY
-- ---
-- The system had scheduling but no clinical record: nothing a doctor could
-- log into, no chart, no medications, no results. This migration adds the
-- EHR-lite layer around the existing appointment model.
--
-- ACCESS MODEL (enforced in src/routes/, documented here because the schema
-- only makes sense against it):
--   * doctor  — a users row (role='doctor') linked 1:1 to a doctors row via
--     doctors.user_id. Sees their own schedule, and the chart of any patient
--     they share a non-cancelled appointment with (their care relationship).
--   * patient — reads their own record; adds self-reported history entries;
--     requests prescription refills.
--   * admin   — operational only. Admins schedule and staff the clinic; they
--     do NOT read charts, notes, medications, or results ("minimum
--     necessary" — the front desk has no clinical need-to-know).
--
-- Visit notes reuse appointments.notes (written by the doctor on completion)
-- rather than a new table: one visit, one note, already joined everywhere.
--
-- ROLLBACK: 002_rollback.sql drops all of it. Clinical data does not survive.
-- ============================================================================

BEGIN;

-- 1. Third role: doctor.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('patient', 'admin', 'doctor'));

-- 2. Link a doctors row to its login. Nullable — a physician can exist in the
--    directory before anyone creates their account (admin does that).
ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL;

-- 3. Medical history: one row per fact (condition, allergy, surgery, ...).
--    `source` records whether the patient self-reported it or a doctor entered
--    it — clinically those carry different weight, so it is never guessed
--    from recorded_by after the fact.
CREATE TABLE IF NOT EXISTS medical_history (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN
                ('condition', 'allergy', 'surgery', 'immunization', 'family', 'other')),
    description TEXT NOT NULL,
    severity    TEXT CHECK (severity IN ('mild', 'moderate', 'severe') OR severity IS NULL),
    noted_on    DATE,                       -- when diagnosed / occurred, if known
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
    source      TEXT NOT NULL CHECK (source IN ('patient', 'doctor')),
    recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_history_patient ON medical_history (patient_id);

-- 4. Prescriptions. Only doctors create these; patients ask for refills via
--    refill_requests, never by editing the prescription.
CREATE TABLE IF NOT EXISTS prescriptions (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id      INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    medication     TEXT NOT NULL,
    dosage         TEXT NOT NULL,           -- '10 mg'
    frequency      TEXT NOT NULL,           -- 'once daily'
    duration       TEXT,                    -- '30 days', 'ongoing'
    instructions   TEXT,                    -- 'take with food'
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

-- 5. Refill requests: the patient-initiated half of medications. This IS a
--    legitimate pending/approve flow (unlike appointment booking): a provider
--    genuinely reviews refills before authorizing them.
CREATE TABLE IF NOT EXISTS refill_requests (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prescription_id INTEGER NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
    patient_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note            TEXT,                   -- patient's message with the request
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'denied')),
    decision_note   TEXT,                   -- doctor's reply, required on deny
    decided_by      INTEGER REFERENCES doctors(id) ON DELETE SET NULL,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refill_rx      ON refill_requests (prescription_id);
CREATE INDEX IF NOT EXISTS idx_refill_status  ON refill_requests (status);

-- One open request per prescription: prevents a patient spamming the queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refill_one_pending
    ON refill_requests (prescription_id)
    WHERE status = 'pending';

-- 6. Test results. Two-phase like real orders: the doctor orders (status
--    'ordered', no result yet), then enters the result ('completed').
--    Patients see both — an ordered test shows as pending in their portal.
CREATE TABLE IF NOT EXISTS test_results (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id     INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id      INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    test_name      TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'ordered'
                   CHECK (status IN ('ordered', 'completed')),
    result_summary TEXT,                    -- filled when completed
    result_flag    TEXT CHECK (result_flag IN ('normal', 'abnormal', 'critical')
                               OR result_flag IS NULL),
    ordered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resulted_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_results_patient ON test_results (patient_id);
CREATE INDEX IF NOT EXISTS idx_results_doctor  ON test_results (doctor_id);

COMMIT;
