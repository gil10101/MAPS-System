-- ============================================================================
-- 001 — ROLLBACK: collapse the two axes back into the original status enum
-- ============================================================================
-- Run with:  npm run migrate -- --rollback 001
--
-- LOSSY. The old model has nowhere to put:
--   * no_show        -> folded into 'cancelled'
--   * cancel_reason / cancelled_by / cancelled_at  -> dropped
-- Take a backup first if any of that matters.
-- ============================================================================

BEGIN;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_confirmation_status_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_cancelled_by_check;
ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;

-- booked + confirmed  -> 'confirmed';  booked + unconfirmed -> 'pending'
UPDATE appointments
   SET status = CASE
         WHEN status = 'booked' AND confirmation_status = 'confirmed' THEN 'confirmed'
         WHEN status = 'booked'                                       THEN 'pending'
         WHEN status = 'no_show'                                      THEN 'cancelled'
         ELSE status
       END;

ALTER TABLE appointments
    ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE appointments
    ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed'));

ALTER TABLE appointments
    DROP COLUMN IF EXISTS confirmation_status,
    DROP COLUMN IF EXISTS confirmed_at,
    DROP COLUMN IF EXISTS cancel_reason,
    DROP COLUMN IF EXISTS cancelled_by,
    DROP COLUMN IF EXISTS cancelled_at;

DROP INDEX IF EXISTS idx_appt_confirmation;
DROP INDEX IF EXISTS idx_appt_date_status;

DROP INDEX IF EXISTS idx_appt_no_double_book;
CREATE UNIQUE INDEX idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status != 'cancelled';

COMMIT;
