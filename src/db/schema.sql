-- ============================================================================
-- MediSync - Medical Appointment & Patient Scheduling System
-- PostgreSQL schema
-- ============================================================================
-- Executed automatically on server startup (see database.js). Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users: login credentials, name, and contact details for every person in the
-- system, whatever their role.
--   patient — self-registers; demographics in "patients"
--   doctor  — provisioned by an admin; directory entry in "doctors"
--   admin   — clinic operations staff
--
-- Names are stored as first/last and never as one string: reports sort by last
-- name, and a single field cannot be split back apart reliably. full_name is a
-- generated column so the display form is always derived and can never drift
-- out of sync with its parts.
--
-- phone lives here rather than on "patients" because it is a contact channel
-- for appointment reminders, which every role receives. A doctor's public
-- office line is a different thing and lives on "doctors".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'patient' CHECK (role IN ('patient', 'admin', 'doctor')),
    first_name    TEXT NOT NULL,
    last_name     TEXT NOT NULL,
    full_name     TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    phone         TEXT,

    -- Reminder preferences. The prototype simulates delivery (see
    -- notifications.channel) but records the choice as a real setting.
    notify_email  BOOLEAN NOT NULL DEFAULT true,
    notify_sms    BOOLEAN NOT NULL DEFAULT false,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- locations: the clinic sites a practice operates. A multi-site practice is the
-- normal case for the target customer, and patients filter providers by the
-- site they can actually travel to.
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

-- ----------------------------------------------------------------------------
-- patients: demographic profile for users with role = 'patient'.
-- Name, email, and phone live on "users" — this table holds only what is
-- specific to being a patient.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patients (
    id                 INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id            INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    date_of_birth      DATE,
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
-- doctors: the physician directory patients browse and book against.
-- prefix/first/last are stored separately for the same reason as on "users";
-- the credential prefix is part of how a physician is addressed, so it is a
-- field rather than something baked into the name.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctors (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prefix       TEXT NOT NULL DEFAULT 'Dr.',
    first_name   TEXT NOT NULL,
    last_name    TEXT NOT NULL,
    full_name    TEXT GENERATED ALWAYS AS (prefix || ' ' || first_name || ' ' || last_name) STORED,
    specialty_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL,
    email        TEXT,
    phone        TEXT,           -- public office line
    bio          TEXT,
    room         TEXT,
    active       BOOLEAN NOT NULL DEFAULT true,   -- accepting appointments
    -- Login for the physician's own portal. Nullable: the directory entry can
    -- exist before an admin creates the account.
    user_id      INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- doctor_schedules: weekly recurring availability, per site.
-- weekday: 0 = Sunday .. 6 = Saturday. Times are 'HH:MM' 24h strings.
-- Bookable slots are generated from these windows in slot_minutes chunks.
--
-- location_id is on the window, not on the doctor: a physician who holds
-- Monday clinic uptown and Thursday clinic downtown is the ordinary case, and
-- the slot a patient books has to know which building to send them to.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS doctor_schedules (
    id           INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id    INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    location_id  INTEGER NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    weekday      SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    start_time   VARCHAR(5) NOT NULL,   -- 'HH:MM'
    end_time     VARCHAR(5) NOT NULL,   -- 'HH:MM'
    slot_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_minutes > 0)
);

-- ----------------------------------------------------------------------------
-- schedule_blocks: a date range where a doctor is unavailable regardless of
-- their weekly pattern — vacation, conference, clinic closure.
-- Blocking removes those slots from patient search and flags any appointment
-- already sitting inside the window for rescheduling.
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
-- appointments: a booking between a patient and a doctor at a point in time.
--
--   status
--       pending ──┬──► confirmed ──┬──► completed   (patient was seen)
--                 │                └──► no_show     (never arrived, terminal)
--                 └──► cancelled                    (terminal, + reason + who)
--
--   A booking is created as `pending` and becomes `confirmed` when clinic staff
--   approve it. Cancellation is reachable from either open state.
--
-- location_id is captured on the appointment rather than looked up through the
-- doctor's schedule at read time: if the schedule is later edited, a visit that
-- already happened must still report the site it happened at.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    doctor_id   INTEGER NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
    appt_date   DATE NOT NULL,
    appt_time   VARCHAR(5) NOT NULL,     -- slot start, 'HH:MM'
    reason      TEXT,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),

    -- Who approved the request out of 'pending', and when.
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,

    -- Cancellations capture why and by whom: a bare status flip discards the
    -- data practices actually report on (late-cancel vs practice-bumped).
    cancel_reason TEXT,
    cancelled_by  TEXT CHECK (cancelled_by IS NULL
                              OR cancelled_by IN ('patient', 'practice', 'unknown')),
    cancelled_at  TIMESTAMPTZ,

    -- Set when an admin blocks the doctor's availability over this slot. The
    -- appointment stays live so the patient does not silently lose their place;
    -- it is surfaced as "needs rescheduling" until they move or cancel it.
    reschedule_required BOOLEAN NOT NULL DEFAULT false,

    -- When this booking replaced an earlier one, the row it came from. Keeps a
    -- reschedule auditable instead of mutating the original in place.
    rescheduled_from_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,

    notes      TEXT,      -- internal clinical/visit notes (staff-only)
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent two live appointments for the same doctor/date/time. Cancelled ones
-- are excluded so a freed slot can be re-booked; a no-show still consumed its
-- slot, so it keeps blocking. Enforcing this as a constraint rather than a
-- read-then-write check makes it safe against two patients booking at once.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_appt_patient     ON appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appt_doctor      ON appointments (doctor_id);
CREATE INDEX IF NOT EXISTS idx_appt_date_status ON appointments (appt_date, status);
CREATE INDEX IF NOT EXISTS idx_appt_location    ON appointments (location_id);
CREATE INDEX IF NOT EXISTS idx_doctor_specialty ON doctors (specialty_id);
CREATE INDEX IF NOT EXISTS idx_schedule_doctor  ON doctor_schedules (doctor_id, weekday);

-- ----------------------------------------------------------------------------
-- Prescriptions and refills.
--
-- A refill is the one place in this system with a genuine approval queue that
-- belongs to the physician: providers really do review refills before
-- authorizing them. The medication and the request for more of it have
-- independent lifecycles, so they are separate tables.
-- ----------------------------------------------------------------------------
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
-- One open request per prescription: a patient asking twice is the same ask.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refill_one_pending
    ON refill_requests (prescription_id)
    WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- notifications: everything the system tells a user about.
--
-- channel distinguishes what the prototype actually delivers from what it only
-- records. 'in_app' rows are real and render in the notification tray. 'email'
-- and 'sms' rows are written by the same code path a production integration
-- would use, but the delivery step is simulated — the row is the receipt that
-- the message *would* have been sent, which is what the reminder reporting and
-- the demo need. Swapping in a real provider means implementing one function.
-- ----------------------------------------------------------------------------
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
