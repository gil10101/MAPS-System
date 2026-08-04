-- ============================================================================
-- 003 — MediSync reshape: structured names, multi-site clinics, one status axis
-- ============================================================================
-- Run once against an existing database:  npm run migrate
-- Fresh databases get this shape directly from schema.sql and can skip it.
--
-- WHY
-- ---
-- Four independent corrections land together because they touch the same rows
-- and a half-migrated database is worse than either end state:
--
--  1. NAMES. `full_name` as the only stored form cannot be sorted by surname,
--     cannot be addressed ("Dear Sarah"), and cannot be split back apart
--     reliably. first_name/last_name become the stored truth and full_name
--     becomes a GENERATED column so the display form can never drift from its
--     parts. Physicians additionally get `prefix`, because a credential is how
--     they are addressed and does not belong baked into a name string.
--
--  2. PHONE moves from `patients` to `users`. It is the contact channel for
--     appointment reminders, and doctors and admins receive those too. The
--     public office line stays on `doctors` — a different number for a
--     different purpose.
--
--  3. SITES. A practice runs more than one building. `locations` is created,
--     and a schedule window carries the site it is held at, so the slot a
--     patient books can tell them which address to travel to. Appointments
--     capture the location at booking time rather than looking it up later:
--     editing a schedule must not rewrite where a past visit happened.
--
--  4. STATUS collapses back to ONE axis. Migration 001 split confirmation off
--     the lifecycle on the argument that no clinic approves individual
--     bookings. That is wrong for this practice: the front desk vets requests
--     against insurance and provider fit before a slot is committed, which is
--     exactly an approval queue. `pending → confirmed → completed | no_show`
--     plus `cancelled`, and `confirmation_status` goes away entirely.
--
-- Also dropped: `medical_history` and `test_results`. A scheduling product has
-- no safe claim to be the system of record for diagnoses or lab values, and a
-- half-populated chart is more dangerous than no chart.
--
-- LOSSY STEPS are called out inline. The unavoidable one is name splitting.
--
-- ROLLBACK: 003_rollback.sql. See its header for what does not survive.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. users: structured names, phone custody, reminder preferences
-- ----------------------------------------------------------------------------
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS first_name   TEXT,
    ADD COLUMN IF NOT EXISTS last_name    TEXT,
    ADD COLUMN IF NOT EXISTS phone        TEXT,
    ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS notify_sms   BOOLEAN NOT NULL DEFAULT false;

-- LOSSY. Splitting a name that was only ever stored as one string cannot be
-- done correctly — "Ana Maria Ruiz Gomez" has no machine-recoverable boundary.
-- The rule here is: everything before the FIRST space is the given name, the
-- entire remainder is the surname. That keeps compound and multi-word
-- surnames intact (the common case) at the cost of misfiling middle names.
-- A name with no space at all cannot be split, so it is kept whole as the
-- surname — that is the part reports sort and address people by. The generated
-- full_name then carries an extra space, which is the visible cost of refusing
-- to invent a given name for someone who does not use one.
--
-- A leading credential is stripped first: physician logins were stored as
-- "Dr. Sarah Chen", and "Dr." is not anybody's given name. Users have no
-- prefix column, so the credential lives on the doctors row from here on.
WITH parsed AS (
    SELECT id,
           CASE WHEN split_part(full_name, ' ', 1)
                     IN ('Dr.', 'Dr', 'Prof.', 'Prof', 'Mr.', 'Ms.', 'Mrs.', 'Mx.')
                THEN btrim(substr(full_name, strpos(full_name, ' ') + 1))
                ELSE full_name END AS rest
      FROM users
)
UPDATE users u
   SET first_name = CASE WHEN strpos(p.rest, ' ') > 0
                         THEN split_part(p.rest, ' ', 1)
                         ELSE '' END,
       last_name  = CASE WHEN strpos(p.rest, ' ') > 0
                         THEN btrim(substr(p.rest, strpos(p.rest, ' ') + 1))
                         ELSE p.rest END
  FROM parsed p
 WHERE u.id = p.id
   AND u.first_name IS NULL;

-- Phone was recorded per patient; every role needs one to be reminded.
UPDATE users u
   SET phone = p.phone
  FROM patients p
 WHERE p.user_id = u.id
   AND p.phone IS NOT NULL
   AND u.phone IS NULL;

ALTER TABLE users
    ALTER COLUMN first_name SET NOT NULL,
    ALTER COLUMN last_name  SET NOT NULL;

-- full_name is replaced rather than converted: PostgreSQL cannot turn a plain
-- column into a generated one in place. Dropping and re-adding moves it to the
-- end of the column list, which is harmless — nothing selects by ordinal.
ALTER TABLE users DROP COLUMN full_name;
ALTER TABLE users
    ADD COLUMN full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED;

ALTER TABLE patients DROP COLUMN IF EXISTS phone;

-- ----------------------------------------------------------------------------
-- 2. doctors: credential prefix + structured names
-- ----------------------------------------------------------------------------
ALTER TABLE doctors
    ADD COLUMN IF NOT EXISTS prefix     TEXT NOT NULL DEFAULT 'Dr.',
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name  TEXT;

-- Directory names were stored with the credential inside them ("Dr. Sarah
-- Chen"). Lift a leading credential token into `prefix` first, then apply the
-- same first-space rule as above to what is left. Rows that never carried a
-- credential keep the 'Dr.' default rather than inventing something else.
WITH parsed AS (
    SELECT id,
           CASE WHEN split_part(full_name, ' ', 1)
                     IN ('Dr.', 'Dr', 'Prof.', 'Prof', 'Mr.', 'Ms.', 'Mrs.', 'Mx.')
                THEN split_part(full_name, ' ', 1)
                ELSE 'Dr.' END AS credential,
           CASE WHEN split_part(full_name, ' ', 1)
                     IN ('Dr.', 'Dr', 'Prof.', 'Prof', 'Mr.', 'Ms.', 'Mrs.', 'Mx.')
                THEN btrim(substr(full_name, strpos(full_name, ' ') + 1))
                ELSE full_name END AS rest
      FROM doctors
)
UPDATE doctors d
   SET prefix     = p.credential,
       first_name = CASE WHEN strpos(p.rest, ' ') > 0
                         THEN split_part(p.rest, ' ', 1)
                         ELSE '' END,
       last_name  = CASE WHEN strpos(p.rest, ' ') > 0
                         THEN btrim(substr(p.rest, strpos(p.rest, ' ') + 1))
                         ELSE p.rest END
  FROM parsed p
 WHERE d.id = p.id;

ALTER TABLE doctors
    ALTER COLUMN first_name SET NOT NULL,
    ALTER COLUMN last_name  SET NOT NULL;

ALTER TABLE doctors DROP COLUMN full_name;
ALTER TABLE doctors
    ADD COLUMN full_name TEXT
        GENERATED ALWAYS AS (prefix || ' ' || first_name || ' ' || last_name) STORED;

-- The directory row is the authority on a physician's name, so their login is
-- brought into line with it rather than parsed a second time from a string
-- that may have been edited on only one side.
UPDATE users u
   SET first_name = d.first_name,
       last_name  = d.last_name
  FROM doctors d
 WHERE d.user_id = u.id
   AND (u.first_name, u.last_name) IS DISTINCT FROM (d.first_name, d.last_name);

-- ----------------------------------------------------------------------------
-- 3. locations
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS locations (
    id      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    city    TEXT NOT NULL,
    state   TEXT NOT NULL,
    zip     TEXT NOT NULL,
    phone   TEXT,
    active  BOOLEAN NOT NULL DEFAULT true
);

-- Everything that already exists was booked when the practice was single-site,
-- so that site has to exist for those rows to point at. It is created here
-- rather than left to an admin because location_id is NOT NULL on schedules.
INSERT INTO locations (name, address, city, state, zip, phone)
SELECT 'Midtown Clinic', '500 5th Ave', 'New York', 'NY', '10018', '212-555-0100'
 WHERE NOT EXISTS (SELECT 1 FROM locations);

-- ----------------------------------------------------------------------------
-- 4. doctor_schedules: a window belongs to a site
-- ----------------------------------------------------------------------------
ALTER TABLE doctor_schedules
    ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id) ON DELETE RESTRICT;

UPDATE doctor_schedules
   SET location_id = (SELECT MIN(id) FROM locations)
 WHERE location_id IS NULL;

ALTER TABLE doctor_schedules ALTER COLUMN location_id SET NOT NULL;

-- A zero or negative slot length would make slot generation loop forever.
ALTER TABLE doctor_schedules DROP CONSTRAINT IF EXISTS doctor_schedules_slot_minutes_check;
ALTER TABLE doctor_schedules
    ADD CONSTRAINT doctor_schedules_slot_minutes_check CHECK (slot_minutes > 0);

-- ----------------------------------------------------------------------------
-- 5. schedule_blocks: vacation / closure overrides on the weekly pattern
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schedule_blocks (
    id         INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id  INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date   DATE NOT NULL,
    reason     TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_block_doctor ON schedule_blocks (doctor_id, start_date, end_date);

-- ----------------------------------------------------------------------------
-- 6. appointments: site, approval trail, reschedule trail, one status axis
-- ----------------------------------------------------------------------------
ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS location_id         INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reschedule_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS rescheduled_from_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL;

-- Backfill the site from the window the visit fell in. Times are zero-padded
-- 'HH:MM' strings, so plain string comparison orders them correctly.
UPDATE appointments a
   SET location_id = (
         SELECT s.location_id
           FROM doctor_schedules s
          WHERE s.doctor_id = a.doctor_id
            AND s.weekday   = EXTRACT(DOW FROM a.appt_date)::SMALLINT
            AND s.start_time <= a.appt_time
            AND s.end_time   >  a.appt_time
          ORDER BY s.start_time
          LIMIT 1)
 WHERE a.location_id IS NULL;

-- Visits booked outside any current window (the schedule has since been edited,
-- or the doctor no longer holds that day) still happened somewhere: the
-- single pre-migration site is the only honest answer available.
UPDATE appointments
   SET location_id = (SELECT MIN(id) FROM locations)
 WHERE location_id IS NULL;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ALTER COLUMN status DROP DEFAULT;

-- Merge the two axes. A live booking the patient had acknowledged is treated
-- as already approved; everything else live goes back into the queue as
-- pending, including 'cancel_requested' — an unactioned request to cancel is
-- still an appointment the desk has to deal with.
UPDATE appointments
   SET status = CASE
         WHEN status = 'booked' AND confirmation_status = 'confirmed' THEN 'confirmed'
         WHEN status = 'booked'                                       THEN 'pending'
         ELSE status
       END;

-- confirmed_at recorded when the booking became firm. That is not the same
-- event as staff approval, but it is the only timestamp the old model kept, so
-- it seeds approved_at. approved_by stays NULL: nobody was ever recorded.
UPDATE appointments
   SET approved_at = confirmed_at
 WHERE confirmed_at IS NOT NULL
   AND approved_at IS NULL;

ALTER TABLE appointments
    ALTER COLUMN status SET DEFAULT 'pending',
    ADD CONSTRAINT appointments_status_check
        CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'));

DROP INDEX IF EXISTS idx_appt_confirmation;

ALTER TABLE appointments
    DROP CONSTRAINT IF EXISTS appointments_confirmation_status_check,
    DROP COLUMN IF EXISTS confirmation_status,
    DROP COLUMN IF EXISTS confirmed_at;

-- Rebuilt rather than left alone: every row's status was just rewritten, and
-- recreating the unique index re-validates all of them. 'pending' is a new live
-- state and must hold its slot exactly like 'confirmed' does — a slot awaiting
-- approval is not free for someone else to take.
DROP INDEX IF EXISTS idx_appt_no_double_book;
CREATE UNIQUE INDEX idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_location    ON appointments (location_id);
CREATE INDEX IF NOT EXISTS idx_appt_date_status ON appointments (appt_date, status);

-- ----------------------------------------------------------------------------
-- 7. notifications
-- ----------------------------------------------------------------------------
-- 'in_app' rows are real and render in the tray. 'email' and 'sms' rows are
-- written by the same code path a production integration would use, but the
-- delivery step is simulated — the row is the receipt that the message would
-- have been sent, which is what reminder reporting needs.
CREATE TABLE IF NOT EXISTS notifications (
    id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
    channel        TEXT NOT NULL DEFAULT 'in_app'
                   CHECK (channel IN ('in_app', 'email', 'sms')),
    type           TEXT NOT NULL,
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'sent'
                   CHECK (status IN ('queued', 'sent', 'failed')),
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread
    ON notifications (user_id) WHERE read_at IS NULL AND channel = 'in_app';

-- ----------------------------------------------------------------------------
-- 8. Drop the chart tables
-- ----------------------------------------------------------------------------
-- DESTRUCTIVE and deliberate: diagnoses, allergies, and lab values leave the
-- product. Visit notes stay on appointments.notes, prescriptions stay, because
-- both are things this system genuinely produces rather than transcribes.
DROP TABLE IF EXISTS test_results;
DROP TABLE IF EXISTS medical_history;

COMMIT;
