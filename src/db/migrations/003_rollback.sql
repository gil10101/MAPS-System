-- ============================================================================
-- 003 — ROLLBACK: back to single-string names, one site, two status axes
-- ============================================================================
-- Run with:  npm run migrate -- --rollback 003
--
-- LOSSY. The old shape has nowhere to put:
--   * locations, and therefore which site any visit happened at
--   * schedule_blocks (vacation/closure ranges) — dropped entirely
--   * notifications — dropped entirely
--   * approved_by, reschedule_required, rescheduled_from_id — dropped
--   * the split between given and family name: they are glued back into one
--     string, and a doctor's prefix is glued back onto the front of it
--
-- medical_history and test_results are recreated EMPTY. Migration 003 dropped
-- them; nothing here can bring their rows back. Restore from a backup if they
-- mattered.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. notifications
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS notifications;

-- ----------------------------------------------------------------------------
-- 2. appointments: split the status axis apart again
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS confirmation_status TEXT,
    ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;

-- The old model had no approval queue, so both live states become 'booked'.
-- An approved booking is the closest thing it had to patient-confirmed, and a
-- completed visit implies the patient turned up, so both read as confirmed.
UPDATE appointments
   SET confirmation_status = CASE
         WHEN status IN ('confirmed', 'completed') THEN 'confirmed'
         ELSE 'unconfirmed'
       END,
       confirmed_at = approved_at,
       status = CASE
         WHEN status IN ('pending', 'confirmed') THEN 'booked'
         ELSE status
       END;

UPDATE appointments SET confirmation_status = 'unconfirmed' WHERE confirmation_status IS NULL;

ALTER TABLE appointments
    ALTER COLUMN confirmation_status SET DEFAULT 'unconfirmed',
    ALTER COLUMN confirmation_status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'booked',
    ADD CONSTRAINT appointments_status_check
        CHECK (status IN ('booked', 'completed', 'cancelled', 'no_show')),
    ADD CONSTRAINT appointments_confirmation_status_check
        CHECK (confirmation_status IN ('unconfirmed', 'confirmed', 'cancel_requested'));

ALTER TABLE appointments
    DROP COLUMN IF EXISTS location_id,
    DROP COLUMN IF EXISTS approved_by,
    DROP COLUMN IF EXISTS approved_at,
    DROP COLUMN IF EXISTS reschedule_required,
    DROP COLUMN IF EXISTS rescheduled_from_id;

DROP INDEX IF EXISTS idx_appt_location;
DROP INDEX IF EXISTS idx_appt_no_double_book;
CREATE UNIQUE INDEX idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_confirmation ON appointments (confirmation_status);

-- ----------------------------------------------------------------------------
-- 3. schedules and sites
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS schedule_blocks;

ALTER TABLE doctor_schedules DROP CONSTRAINT IF EXISTS doctor_schedules_slot_minutes_check;
ALTER TABLE doctor_schedules DROP COLUMN IF EXISTS location_id;

DROP TABLE IF EXISTS locations;

-- ----------------------------------------------------------------------------
-- 4. doctors: glue the credential and the name back together
-- ----------------------------------------------------------------------------
ALTER TABLE doctors DROP COLUMN IF EXISTS full_name;
ALTER TABLE doctors ADD COLUMN full_name TEXT;

-- Whitespace is collapsed, not just trimmed: a name that could not be split
-- into two parts on the way in left one of the halves empty, which would glue
-- back together with a doubled space.
UPDATE doctors
   SET full_name = btrim(regexp_replace(
         prefix || ' ' || first_name || ' ' || last_name, '\s+', ' ', 'g'));

ALTER TABLE doctors ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE doctors
    DROP COLUMN IF EXISTS prefix,
    DROP COLUMN IF EXISTS first_name,
    DROP COLUMN IF EXISTS last_name;

-- ----------------------------------------------------------------------------
-- 5. users: one name string again, phone back to patients
-- ----------------------------------------------------------------------------
ALTER TABLE patients ADD COLUMN IF NOT EXISTS phone TEXT;

-- Only patients had a phone before; doctor and admin numbers are discarded.
UPDATE patients p
   SET phone = u.phone
  FROM users u
 WHERE u.id = p.user_id
   AND p.phone IS NULL;

ALTER TABLE users DROP COLUMN IF EXISTS full_name;
ALTER TABLE users ADD COLUMN full_name TEXT;

UPDATE users
   SET full_name = btrim(regexp_replace(first_name || ' ' || last_name, '\s+', ' ', 'g'));

-- Physician logins carried the credential inside the name string in the old
-- model. doctors.full_name has just been glued back together with its prefix,
-- so it is the exact value to restore.
UPDATE users u
   SET full_name = d.full_name
  FROM doctors d
 WHERE d.user_id = u.id;

ALTER TABLE users ALTER COLUMN full_name SET NOT NULL;
ALTER TABLE users
    DROP COLUMN IF EXISTS first_name,
    DROP COLUMN IF EXISTS last_name,
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS notify_email,
    DROP COLUMN IF EXISTS notify_sms;

-- ----------------------------------------------------------------------------
-- 6. Chart tables, recreated empty (see header — the data is gone)
-- ----------------------------------------------------------------------------
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

COMMIT;
