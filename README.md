# MediSync — Medical Appointment & Patient Scheduling System

A web-based appointment scheduling platform for outpatient clinics and medical
offices. Patients create accounts, search for doctors across the practice's
sites, and **request** appointments in open slots; clinic staff approve those
requests, manage physician availability, and run the operational reports the
practice is measured on.

> **CIS 9590 group project** — Liu Maggie · Lopez Raylene · Lu Gil · Mammadov Mehdi

**[Live demo](https://maps-system-three.vercel.app/login)** · sign in with any of
the seeded accounts below.

---

## Screenshots

Three portals, one codebase. Each role sees only the screens its job needs.

### Patients

| Find a doctor | My appointments |
|---|---|
| ![Physician directory, filtered by name, specialty, or clinic site](docs/screenshots/patient-find-doctor.png) | ![A month of the patient's bookings, coloured by status](docs/screenshots/patient-calendar.png) |

Search the directory by name, specialty, or the site you can actually travel
to, then request one of the physician's open slots. Bookings arrive as requests
and stay `Pending approval` until clinic staff confirm them.

### Physicians

![The physician's day, with each visit ready to be completed and noted](docs/screenshots/doctor-schedule.png)

A physician sees their own book and nothing else — day, week, or month — and
closes each visit out with a clinical note. Completing a visit is the one
transition the system reserves to the treating provider.

### Clinic administrators

| Clinic overview | Approval queue |
|---|---|
| ![Appointment totals, no-show and cancellation rates, and utilization per physician](docs/screenshots/admin-overview.png) | ![Pending requests waiting on clinic staff, above the filterable book](docs/screenshots/admin-appointments.png) |

![Weekly availability projected onto real dates, with blocked days removed](docs/screenshots/admin-availability.png)

Availability is stored as a recurring weekly pattern rather than a table of
slots. The calendar shows what that pattern produces on real dates and how many
bookable slots each day yields — and blocking a physician out removes those days
from patient search while flagging, rather than deleting, the bookings already
inside the range.

---

## Tech stack

| Layer     | Technology                                        |
|-----------|----------------------------------------------------|
| Frontend  | React 18 + TypeScript, Vite, react-router, Tailwind CSS, lucide-react |
| Backend   | Node.js + Express (REST API)                       |
| Database  | PostgreSQL (hosted free on [Neon](https://neon.tech)) |
| Auth      | JWT (`jsonwebtoken`) + bcrypt password hashing     |

One Node process serves both the API and the built React app, so deployment is
a single service.

---

## Features

**Patients**
- Register, log in, and manage a personal profile (contact, insurance, and
  reminder preferences)
- Search the physician directory by name, specialty, or **clinic location**
- See a doctor's real-time open slots for any date — each slot carries the site
  it is held at
- Request an appointment, with **double-booking prevention**; the request lands
  as `Pending approval` until staff confirm it
- **Reschedule** an upcoming appointment into a different slot, or cancel it
  with a reason
- See a `Needs rescheduling` callout when the clinic blocks out a doctor's
  dates over an existing booking
- Medications list with **refill requests**, and the physician's decision on each

**Physicians** (role `doctor`, linked to their directory entry)
- Day-by-day schedule; complete visits by **signing a clinical note**
  (a note is required — no undocumented visits)
- Patient charts for everyone under their care: demographics, visit history
  with notes, and current medications
- Prescribe and stop medications (stopping requires a reason)
- Approve/deny refill requests on their own prescriptions (denials require a
  note to the patient, which prompts booking a follow-up); approving dispenses
  one refill
- Reports scoped to their own data: Daily Appointments and Workload

**Clinic administrators**
- **Approve pending booking requests**, and record how visits ended: completed,
  cancelled, or didn't attend — the last two require a reason
- Add, edit, and deactivate physicians; create their portal logins
- Manage **clinic locations**, **weekly availability windows** per doctor per
  site, and **schedule blocks** (vacation, conference, closure)
- View and filter every appointment by status, physician, location, or date
- Five operational reports plus an at-a-glance Overview — see
  [Reports](#reports) below

Notifications are generated for every state change worth telling someone about
(request received, approved, cancelled, rescheduled, refill decided, needs
rescheduling) and land in an in-app tray. See
[Notifications](#notifications-in-app-real-email--sms-simulated).

Two deliberate boundaries, both enforced server-side:
- **Doctors only open charts of patients they share a non-cancelled appointment
  with** — their care relationship. There is no way to browse the patient list.
- **Administrators get no patient-records browser.** Scheduling staff need
  appointment data, not clinical histories; the admin UI exposes appointments,
  availability, and aggregate reports only.

---

## Quick start

Requires **Node.js 18+** and a PostgreSQL connection string.

### 1. Get a free Postgres database (Neon)

1. Sign up at [neon.tech](https://neon.tech) (free, no credit card).
2. Create a project (e.g. `medisync`) and copy the **connection string** from
   the dashboard. It looks like
   `postgres://USER:PASS@ep-xxx.aws.neon.tech/neondb?sslmode=require`.
3. Teammates can share the same connection string — everyone sees the same data.

(A local Postgres works too: `postgres://postgres:postgres@localhost:5432/medisync`.)

### 2. Configure and run

```bash
npm install                # server dependencies
cp .env.example .env       # then paste your DATABASE_URL into .env
npm run seed               # create tables + demo data
npm run build              # build the React frontend (client/dist)
npm start                  # serve everything on http://localhost:3000
```

### Demo logins

| Role    | Email                    | Password     |
|---------|--------------------------|--------------|
| Admin   | `admin@medisync.health`  | `admin123`   |
| Patient | `jdoe@example.com`       | `patient123` |
| Doctor  | `skim@medisync.health`   | `doctor123`  |

Every seeded physician has a login: their directory email
(`<first-initial><last>@medisync.health`) with `doctor123`.

The seed loads pending requests, confirmed and completed visits, cancellations
with reasons, and no-shows, so the approval flow and every report have data on
first run.

### Development mode (hot reload)

Run the API and the Vite dev server in two terminals:

```bash
npm run dev          # Express API on :3000 (restarts on change)
npm run dev:client   # React app on :5173 (hot reload, proxies /api to :3000)
```

Open http://localhost:5173 while developing. `npm run build && npm start`
produces the single-server production setup.

### All scripts

| Command              | Description                                      |
|----------------------|--------------------------------------------------|
| `npm start`          | Start the server (API + built frontend)          |
| `npm run dev`        | API only, restarts on file changes               |
| `npm run dev:client` | Vite dev server for the React app (hot reload)   |
| `npm run build`      | Install client deps + build React app to `client/dist` |
| `npm run seed`       | Create schema + demo data (skips if data exists) |
| `npm run reset-db`   | Wipe all tables and re-seed from scratch         |
| `npm run migrate`    | Apply pending schema migrations to an existing DB |
| `npm run migrate -- --status` | List applied vs pending migrations, change nothing |

> **Upgrading from an older copy of this database?** The schema changed shape in
> this version — appointments moved to a single status axis, and locations,
> schedule blocks, and notifications were added. Run `npm run reset-db` to
> rebuild from `schema.sql`. Fresh databases need nothing: the schema is applied
> on startup.

---

## Data model

Eleven tables, created from [`src/db/schema.sql`](src/db/schema.sql) on startup.
Every `CREATE` is `IF NOT EXISTS`, so booting against an existing database is a
no-op.

| Table              | What it holds                                                        |
|--------------------|----------------------------------------------------------------------|
| `users`            | Login, role (`patient`/`doctor`/`admin`), name, phone, reminder prefs |
| `patients`         | Demographics for users with role `patient`                           |
| `specialties`      | Medical specialties a doctor belongs to                              |
| `doctors`          | The physician directory patients browse and book against             |
| `locations`        | The clinic sites the practice operates                               |
| `doctor_schedules` | Weekly recurring availability windows — **per doctor, per site**     |
| `schedule_blocks`  | Date ranges a doctor is unavailable regardless of the weekly pattern |
| `appointments`     | A booking between a patient and a doctor at a point in time          |
| `prescriptions`    | Medications a physician prescribed                                   |
| `refill_requests`  | A patient's ask for more of one, and the physician's decision        |
| `notifications`    | Everything the system tells a user, per delivery channel             |

**Names are stored as parts, never as one string.** `users` and `doctors` carry
`first_name`/`last_name` (plus `prefix` on doctors); `full_name` is a
**generated column** derived from them. Reports sort by last name, and a single
name field cannot be split back apart reliably — so the display form is derived
and can never drift out of sync with its parts. Application code reads
`full_name` and never writes it.

**`location_id` sits on the schedule window, not on the doctor.** A physician
who holds Monday clinic uptown and Thursday clinic downtown is the ordinary
case, and a booked slot has to know which building to send the patient to. The
appointment then captures its own `location_id` at booking time, so a visit that
already happened still reports the site it happened at even if the schedule is
edited later.

---

## Appointment model

An appointment has **one** status, and every state has exactly one owner and one
obvious next action:

```
pending ──┬──► confirmed ──┬──► completed   (patient was seen)
          │                └──► no_show     (never arrived, terminal)
          └──► cancelled                    (terminal, + reason + who)
```

**A new booking is a request that clinic staff approve.** `pending` is not
decoration: the front desk checks coverage and provider availability before the
practice commits to the slot, so the request needs a state with a real owner and
a real queue behind it. Approval sets `approved_by` and `approved_at`, so "who
let this on the calendar" is answerable afterwards.

Consequences that fall out of this, enforced in `src/routes/`:

- **A pending request holds its slot.** The partial unique index on
  `(doctor_id, appt_date, appt_time)` excludes only `cancelled` rows, so two
  patients cannot both be sitting in the queue for the same time — approving one
  would otherwise fail at the last moment.
- **A `no_show` keeps blocking its slot.** The patient never arrived, but the
  time was consumed and cannot be resold retroactively. Only cancelling frees a
  slot for rebooking.
- **Cancelling requires a reason and records who cancelled** (`patient`,
  `practice`, or `unknown`) and when. A bare status flip throws away the only
  thing the practice reports on — the Cancellation report is built entirely from
  these columns, and late-cancel and practice-bumped are different problems.
- **There is no un-cancelling.** `cancelled` and the two terminal outcomes are
  end states; to put a patient back on the calendar you create a new appointment.

### Rescheduling creates a row, it does not move one

`PATCH /api/appointments/:id/reschedule` runs in one transaction: it inserts a
**new** `pending` appointment carrying the original reason and pointing back at
its predecessor through `rescheduled_from_id`, then cancels the old row with
`cancelled_by = 'patient'` and reason `Rescheduled to another time`.

Mutating the original in place would be simpler and would destroy the history —
the practice could no longer tell a clean first-time booking apart from one that
moved three times, which is exactly the pattern worth spotting. The new slot
goes back through approval because it is a different commitment of the doctor's
time.

### When the clinic blocks a doctor's dates

Adding a `schedule_blocks` range takes those slots out of patient search, and in
the same transaction flags every live appointment inside the range with
`reschedule_required = true` and notifies the affected patients.

The appointments are flagged, **not cancelled** — the patient does not silently
lose their place while the clinic sorts itself out. The patient dashboard raises
an amber `Needs rescheduling` callout at the very top with a `Reschedule`
button, and removing the block clears the flag from any appointment no longer
covered.

### Status vocabulary

The same status reads differently depending on who is looking, so the labels are
fixed rather than derived from the column value:

| status      | patient sees      | staff see        |
|-------------|-------------------|------------------|
| `pending`   | Pending approval  | Pending          |
| `confirmed` | Confirmed         | Confirmed        |
| `completed` | Completed         | Completed        |
| `cancelled` | Cancelled         | Cancelled        |
| `no_show`   | Missed            | Didn't attend    |

---

## How double-booking is prevented

1. **Availability check** — the API recomputes a doctor's open slots from their
   weekly schedule, minus schedule blocks, minus existing bookings, before
   accepting a request.
2. **Database constraint** — a Postgres **partial unique index**
   (`doctor_id, appt_date, appt_time` `WHERE status <> 'cancelled'`) makes it
   impossible for two live appointments to occupy the same slot, even if two
   requests race. The second insert fails with `23505` and the API returns 409
   *"That time was just taken. Pick another slot."*

The constraint is the real guarantee; the availability check exists so the
common case produces a useful list rather than a rejected write.

---

## Reports

Five reports, all under `/api/admin/reports`. Each accepts `from`/`to` date
parameters (defaulting to the current month) and returns
`{ rows, meta: { from, to, generated_at } }`.

| Report                    | Answers                                                        |
|---------------------------|----------------------------------------------------------------|
| Daily Appointment         | Who is on the schedule today, by time, with doctor and site     |
| Doctor Workload           | Appointments and booked hours per physician over a range        |
| Patient Visit History     | Every visit for one patient, with the notes                     |
| Appointment Cancellation  | Cancellations *and* no-shows, with reason and who cancelled     |
| Provider Utilization      | Slots available vs booked per physician, plus outcome breakdown |

Admins get all five. A doctor gets Daily Appointments and Workload **scoped to
their own patients** through the parallel `/api/doctor/reports` routes.
Patient Visit History exists as an admin endpoint but is surfaced in the doctor
portal only — see the boundaries note under [Features](#features).

**`utilization_pct` is a real ratio, not a proxy.** The denominator is the count
of bookable slots actually generated from `doctor_schedules` across the range,
minus slots falling inside a `schedule_blocks` window; the numerator counts
appointments in `confirmed`, `completed`, or `no_show`. That slot-counting lives
in `src/utils/slots.js` as `countSlotsInRange(doctorId, from, to)` and is the
same code path patient-facing availability uses, so the two can never disagree
about what a doctor's capacity is.

Every report page has a **Download CSV** button. Export is done client-side from
the rows already on screen (`client/src/lib/csv.ts`) — the server has no export
endpoint to keep in sync with the table the user is looking at.

The Overview page keeps its own headline endpoints (`/reports/summary`,
`/reports/physician-utilization`, `/reports/volume-by-specialty`).

---

## Notifications (in-app real, email & SMS simulated)

`src/services/notify.js` exposes one function:

```js
notify({ userId, appointmentId, type, title, body, channels })
```

It writes one `notifications` row per channel. The `in_app` row is always
written and renders in the topbar tray. `email` and `sms` rows are written
**only if the user turned that reminder on** in their profile, and the delivery
step is a `console.log` — the row is the receipt that the message *would* have
been sent, which is what the demo and the reporting need. Swapping in a real
provider means implementing one function, not rewriting the callers.

`notify()` never throws. A notification failure must not roll back the booking
that caused it, so the body is wrapped and errors are logged.

Types: `appointment_requested`, `appointment_approved`, `appointment_cancelled`,
`appointment_rescheduled`, `appointment_completed`, `reschedule_required`,
`refill_approved`, `refill_denied`, `appointment_reminder`.

---

## How authentication works (JWT + bcrypt)

We implemented authentication ourselves rather than using a hosted auth
provider — it follows the standard production pattern for Express APIs and
every step is inspectable in this repo.

**1. Passwords are never stored — only bcrypt hashes.**
On registration (`src/routes/auth.js`), the password is run through
`bcrypt.hashSync(password, 10)`. bcrypt is a deliberately *slow*, salted,
one-way hash: even if the database leaked, the original passwords could not
be recovered, and identical passwords produce different hashes because each
gets a random salt.

**2. Login exchanges credentials for a signed token.**
On login the server compares the submitted password against the stored hash
with `bcrypt.compareSync`. If it matches, the server issues a **JSON Web
Token** (`src/middleware/auth.js`): a Base64-encoded payload
(`{ id, role, email, full_name }` + expiry) **signed** with a server-side
secret (`JWT_SECRET`). The signature means the server can later verify the
token was issued by us and was not tampered with — no session storage needed.

**3. The client sends the token on every request.**
The React app stores the token and attaches it as an
`Authorization: Bearer <token>` header (`client/src/lib/api.ts`). Tokens
expire after `JWT_EXPIRES_IN` (default 7 days); an expired/invalid token
gets a 401 and the client redirects to the login page.

**4. Middleware enforces authentication and roles.**
- `requireAuth` verifies the token signature and expiry, then attaches the
  decoded user to `req.user`.
- `requireRole('admin')` / `requireRole('patient')` gate each route by role,
  so a patient token can never call admin endpoints (it gets a 403), and all
  patient data access is scoped to the logged-in user's own records.

```
Register/Login                    Authenticated request
──────────────                    ─────────────────────
password ──bcrypt──▶ hash in DB   Authorization: Bearer <JWT>
credentials ──▶ verify ──▶ JWT            │
      ◀────────── token ◀─┘        requireAuth ─▶ verify signature/expiry
                                   requireRole ─▶ patient | doctor | admin
                                        │
                                   route handler (req.user)
```

---

## Project structure

```
MAPS-System/
├── server.js                  # Entry point — init DB, start HTTP server
├── src/                       # Express backend
│   ├── app.js                 # Middleware, route mounts, SPA serving
│   ├── db/
│   │   ├── database.js        # pg Pool + query/one/tx helpers (DATABASE_URL)
│   │   ├── schema.sql         # PostgreSQL schema (tables, indexes)
│   │   └── seed.js            # Demo data seeder
│   ├── middleware/auth.js     # JWT sign/verify + role guards
│   ├── routes/
│   │   ├── auth.js            # register / login / me
│   │   ├── locations.js       # public clinic-site list
│   │   ├── doctors.js         # public directory + availability
│   │   ├── appointments.js    # patient bookings, reschedule, cancel
│   │   ├── patients.js        # own profile + medications + refill asks
│   │   ├── notifications.js   # tray, any signed-in role
│   │   ├── doctor-portal.js   # physician schedule, charts, refills
│   │   ├── doctor-reports.js  # physician's own data only
│   │   ├── admin.js           # physicians, schedules, blocks, locations
│   │   └── admin-reports.js   # clinic-wide reporting
│   ├── services/notify.js     # notification fan-out (in_app / email / sms)
│   └── utils/                 # slots.js (generation + counting), wrap.js
└── client/                    # React + TypeScript frontend (Vite + Tailwind)
    ├── index.html
    └── src/
        ├── main.tsx, App.tsx  # Entry + routes
        ├── lib/               # api.ts (typed client + session), csv.ts (export)
        ├── components/        # Layout (shell + notification tray), guards, modal, toast
        ├── pages/             # Landing, Login, Register
        │   ├── patient/       # Dashboard, Doctors, Appointments, Profile
        │   ├── doctor/        # Schedule, Patients, Chart, Refills, Reports
        │   └── admin/         # Overview, Appointments, Doctors, Schedules,
        │                      #   Locations, Specialties, Reports
        └── styles.css         # Tailwind directives + shared component layer
```

---

## API overview

All `/api` routes return JSON; errors are `{ error: "message" }` with a 4xx/5xx
status. Authenticated routes expect an `Authorization: Bearer <token>` header.

### Auth and shared

| Method | Endpoint                        | Role   | Purpose                          |
|--------|---------------------------------|--------|----------------------------------|
| POST   | `/api/auth/register`            | public | Patient sign-up                  |
| POST   | `/api/auth/login`               | public | Log in, receive a token          |
| GET    | `/api/auth/me`                  | any    | Current user                     |
| GET    | `/api/locations`                | public | Active clinic sites              |
| GET    | `/api/notifications`            | any    | Tray contents + unread count     |
| PATCH  | `/api/notifications/:id/read`   | any    | Mark one read                    |
| POST   | `/api/notifications/read-all`   | any    | Mark everything read             |

### Patient

| Method | Endpoint                                   | Purpose                                  |
|--------|--------------------------------------------|------------------------------------------|
| GET    | `/api/doctors?q=&specialty=&location=`     | Search the directory                     |
| GET    | `/api/doctors/specialties`                 | Specialty filter options                 |
| GET    | `/api/doctors/:id`                         | One physician + their sites              |
| GET    | `/api/doctors/:id/availability?date=`      | Open slots for a date (each with a site) |
| GET    | `/api/appointments`                        | Own appointments                         |
| GET    | `/api/appointments/:id`                    | One of their own                         |
| POST   | `/api/appointments`                        | Request an appointment (`pending`)       |
| PATCH  | `/api/appointments/:id/reschedule`         | Move to a new slot (new row, re-approved)|
| PATCH  | `/api/appointments/:id/cancel`             | Cancel own appointment (+ reason)        |
| GET    | `/api/patients/me`                         | Read profile                             |
| PUT    | `/api/patients/me`                         | Update profile + reminder preferences    |
| GET    | `/api/patients/me/prescriptions`           | Own medications + refill state           |
| POST   | `/api/patients/me/prescriptions/:id/refill-request` | Ask for a refill                |

### Physician

| Method | Endpoint                                        | Purpose                              |
|--------|-------------------------------------------------|--------------------------------------|
| GET    | `/api/doctor/me`                                | Own physician profile                |
| GET    | `/api/doctor/appointments?date=&from=&to=`      | Own schedule                         |
| PATCH  | `/api/doctor/appointments/:id/complete`         | Complete a visit (note required)     |
| PATCH  | `/api/doctor/appointments/:id/note`             | Amend a visit's note                 |
| GET    | `/api/doctor/patients`                          | Patients under their care            |
| GET    | `/api/doctor/patients/:id/chart`                | Chart: visits + medications          |
| POST   | `/api/doctor/patients/:id/prescriptions`        | Prescribe                            |
| PATCH  | `/api/doctor/prescriptions/:id/stop`            | Stop a medication (+ reason)         |
| GET    | `/api/doctor/refill-requests?status=`           | Refill queue                         |
| PATCH  | `/api/doctor/refill-requests/:id`               | Approve / deny (denial needs a note) |
| GET    | `/api/doctor/reports/daily-appointments?date=`  | Own day, as a report                 |
| GET    | `/api/doctor/reports/workload?from=&to=`        | Own workload over a range            |

### Administrator

| Method | Endpoint                                                  | Purpose                              |
|--------|-----------------------------------------------------------|--------------------------------------|
| GET/POST/PUT/DELETE | `/api/admin/doctors[/:id]`                   | Manage physicians                    |
| POST   | `/api/admin/doctors/:id/account`                          | Create a physician's login           |
| GET/POST | `/api/admin/specialties`                                | List / add specialties               |
| GET/POST | `/api/admin/locations`, PUT `/api/admin/locations/:id`  | Manage clinic sites                  |
| GET/POST | `/api/admin/doctors/:id/schedules`                      | Weekly availability windows          |
| DELETE | `/api/admin/schedules/:id`                                | Remove a window                      |
| GET/POST | `/api/admin/doctors/:id/blocks`                         | Unavailability ranges                |
| DELETE | `/api/admin/blocks/:id`                                   | Remove a block, clear its flags      |
| GET    | `/api/admin/appointments?status=&doctor_id=&location_id=&date=&from=&to=` | All appointments |
| PATCH  | `/api/admin/appointments/:id/status`                      | Approve, complete, cancel, no-show   |
| PATCH  | `/api/admin/appointments/:id/note`                        | Amend a visit's note                 |
| GET    | `/api/admin/reports/daily-appointments?date=`             | Daily Appointment report             |
| GET    | `/api/admin/reports/workload?from=&to=`                   | Doctor Workload report               |
| GET    | `/api/admin/reports/patient-visits?patient_id=&from=&to=` | Patient Visit History report         |
| GET    | `/api/admin/reports/cancellations?from=&to=`              | Cancellation report (incl. no-shows) |
| GET    | `/api/admin/reports/utilization?from=&to=`                | Provider Utilization report          |
| GET    | `/api/admin/reports/summary`                              | Overview headline metrics            |
| GET    | `/api/admin/reports/physician-utilization`                | Overview: per-doctor counts          |
| GET    | `/api/admin/reports/volume-by-specialty`                  | Overview: volume per specialty       |

---

## Deployment

- **Free hosting:** deploy to **Render** via the included `render.yaml`
  blueprint — set `DATABASE_URL` to your Neon connection string in the Render
  dashboard. Data lives in Neon, so it persists across deploys.
- **Vercel:** `vercel.json` builds the client and routes `/api/*` to the Express
  app through `api/index.js`.
- **AWS:** see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a step-by-step
  EC2 guide plus other options.

---

## License

MIT — for educational use as part of CIS 9590.
