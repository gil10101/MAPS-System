-- ============================================================================
-- 001 — Split patient confirmation off the lifecycle status
-- ============================================================================
-- Run once against an existing database:  npm run migrate
-- Fresh databases get this shape directly from schema.sql and can skip it.
--
-- WHY
-- ---
-- The original model had one status axis: pending -> confirmed -> completed.
-- That conflated two independent things, and invented a third that no real
-- clinic system has:
--
--   * "pending" implied an admin approval queue. Real ambulatory systems have
--     no approve step — a booked slot is confirmed to go ahead the moment it
--     is booked (HL7 FHIR defines `booked` as "confirmed to go ahead at the
--     date/times specified"). Epic calls this Direct Scheduling: patients pick
--     a time "without any interaction from staff".
--   * "confirmed" actually means the PATIENT acknowledged a reminder. That is
--     patient-driven, orthogonal to where the visit sits in its lifecycle, and
--     athenahealth models it as a separate field for exactly that reason.
--
-- So: `status` becomes the lifecycle (FHIR-aligned), and `confirmation_status`
-- becomes the patient's own axis. An appointment is booked AND unconfirmed
-- until the patient says otherwise — two facts that could not coexist before.
--
-- Cancellations additionally record WHY and BY WHOM. A bare status flip throws
-- away the data a practice actually reports on (late-cancel vs practice-bumped
-- vs no-show), so cancel_reason/cancelled_by/cancelled_at are captured instead.
--
-- ROLLBACK
-- --------
-- See 001_rollback.sql — it collapses the two axes back into the old enum.
-- Note the round trip is lossy: cancel reasons and no-show records have no
-- home in the old model.
-- ============================================================================

BEGIN;

-- 1. New columns, nullable for now so existing rows stay valid.
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS confirmation_status TEXT,
    ADD COLUMN IF NOT EXISTS confirmed_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancel_reason       TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_by        TEXT,
    ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;

-- 2. Drop the old CHECK so the rewrite below can't trip over it.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;

-- 3. Rewrite existing rows onto the two axes.
--    'confirmed' carried both meanings, so it splits into booked + confirmed.
UPDATE appointments
   SET confirmation_status = CASE
         WHEN status = 'confirmed' THEN 'confirmed'
         WHEN status = 'completed' THEN 'confirmed'   -- they showed up; implied
         ELSE 'unconfirmed'
       END,
       confirmed_at = CASE
         WHEN status IN ('confirmed', 'completed') THEN COALESCE(updated_at, created_at)
         ELSE NULL
       END
 WHERE confirmation_status IS NULL;

UPDATE appointments
   SET cancelled_at = COALESCE(updated_at, created_at)
 WHERE status = 'cancelled' AND cancelled_at IS NULL;

-- Historic cancellations predate reason capture; record that honestly rather
-- than inventing a reason.
UPDATE appointments
   SET cancelled_by  = 'unknown',
       cancel_reason = 'Migrated from legacy data — reason not recorded'
 WHERE status = 'cancelled' AND cancelled_by IS NULL;

--    pending/confirmed both collapse to the single live state: booked.
UPDATE appointments
   SET status = 'booked'
 WHERE status IN ('pending', 'confirmed');

-- 4. Lock in the new domains and defaults.
UPDATE appointments SET confirmation_status = 'unconfirmed' WHERE confirmation_status IS NULL;

ALTER TABLE appointments
    ALTER COLUMN confirmation_status SET DEFAULT 'unconfirmed',
    ALTER COLUMN confirmation_status SET NOT NULL,
    ALTER COLUMN status SET DEFAULT 'booked';

ALTER TABLE appointments
    ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('booked', 'completed', 'cancelled', 'no_show'));

ALTER TABLE appointments
    ADD CONSTRAINT appointments_confirmation_status_check
    CHECK (confirmation_status IN ('unconfirmed', 'confirmed', 'cancel_requested'));

ALTER TABLE appointments
    ADD CONSTRAINT appointments_cancelled_by_check
    CHECK (cancelled_by IS NULL OR cancelled_by IN ('patient', 'practice', 'unknown'));

-- 5. The double-book guard keyed off status != 'cancelled'. A no-show still
--    consumed its slot, so it must keep blocking — but the freed slot from a
--    cancellation stays re-bookable. Rebuilt to name both terminal-free states.
DROP INDEX IF EXISTS idx_appt_no_double_book;
CREATE UNIQUE INDEX idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_confirmation ON appointments (confirmation_status);
CREATE INDEX IF NOT EXISTS idx_appt_date_status  ON appointments (appt_date, status);

COMMIT;
