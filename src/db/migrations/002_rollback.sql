-- ============================================================================
-- 002 — ROLLBACK: drop the clinical records layer
-- ============================================================================
-- Run with:  npm run migrate -- --rollback 002
--
-- DESTRUCTIVE. All medical history, prescriptions, refill requests, and test
-- results are dropped, doctor logins are demoted, and doctors are unlinked
-- from their user accounts. Take a backup first if any of that matters.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS test_results;
DROP TABLE IF EXISTS refill_requests;
DROP TABLE IF EXISTS prescriptions;
DROP TABLE IF EXISTS medical_history;

ALTER TABLE doctors DROP COLUMN IF EXISTS user_id;

-- Doctor logins have no valid role in the old model; demote to patient rather
-- than deleting accounts (deleting would cascade into nothing useful anyway,
-- since patients rows don't exist for them — they just become inert logins).
UPDATE users SET role = 'patient' WHERE role = 'doctor';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('patient', 'admin'));

COMMIT;
