# MAPS — Medical Appointment & Patient Scheduling System

A web-based appointment scheduling platform for outpatient clinics and medical
offices. Patients create accounts, search for doctors, and book appointments
directly into open slots; clinic administrators manage physicians, record how
visits ended, and view operational reports.

> **CIS 9590 group project** — Liu Maggie · Lopez Raylene · Lu Gil · Mammadov Mehdi

---

## Tech stack

| Layer     | Technology                                        |
|-----------|----------------------------------------------------|
| Frontend  | React 18 + TypeScript, Vite, react-router, lucide-react |
| Backend   | Node.js + Express (REST API)                       |
| Database  | PostgreSQL (hosted free on [Neon](https://neon.tech)) |
| Auth      | JWT (`jsonwebtoken`) + bcrypt password hashing     |

One Node process serves both the API and the built React app, so deployment is
a single service.

---

## Features

**Patients**
- Register, log in, and manage a personal profile (contact + insurance info)
- Search doctors by name or specialty
- See a doctor's real-time available time slots for any date
- Book an appointment, with **double-booking prevention**
- View appointment history and cancel upcoming appointments

**Clinic administrators**
- Add, edit, and deactivate physicians and their specialties
- View and filter all appointments by status, patient reply, physician, or date
- Record visit outcomes: completed, cancelled, or didn't attend — the last two
  require a reason, which is what the reports are built from
- Operational reports: appointment volume, physician utilization, no-show rate,
  cancellation rate, and status breakdown

Administrators deliberately **cannot** approve a booking or mark a patient as
confirmed — see "Appointment model" below.

---

## Quick start

Requires **Node.js 18+** and a PostgreSQL connection string.

### 1. Get a free Postgres database (Neon)

1. Sign up at [neon.tech](https://neon.tech) (free, no credit card).
2. Create a project (e.g. `maps`) and copy the **connection string** from the
   dashboard. It looks like
   `postgres://USER:PASS@ep-xxx.aws.neon.tech/neondb?sslmode=require`.
3. Teammates can share the same connection string — everyone sees the same data.

(A local Postgres works too: `postgres://postgres:postgres@localhost:5432/maps`.)

### 2. Configure and run

```bash
npm install                # server dependencies
cp .env.example .env       # then paste your DATABASE_URL into .env
npm run seed               # create tables + demo data
npm run build              # build the React frontend (client/dist)
npm start                  # serve everything on http://localhost:3000
```

### Demo logins

| Role    | Email                | Password     |
|---------|----------------------|--------------|
| Admin   | `admin@maps.health`  | `admin123`   |
| Patient | `jdoe@example.com`   | `patient123` |

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

> **Existing database?** Run `npm run migrate` once after pulling. Fresh
> databases get the current shape from `schema.sql` and need nothing.

---

## Appointment model (two axes, not one)

The most common way to get clinic software wrong is to model appointments with
a single status running `pending → confirmed → completed`. This project used to
do that. It's wrong in a way worth explaining, because the mistake looks
sensible until you compare it to a real system.

**There is no approval step.** A booking is live the moment the patient makes
it. HL7 FHIR — the interop standard every EHR maps to — defines `booked` as
*"confirmed to go ahead at the date/times specified."* Epic calls its
self-scheduling flow Direct Scheduling: *"Patients choose their appointment day
and time without any interaction from staff."* No admin sits in a queue
approving bookings, so there is no status for it and no button to press.

**"Confirmed" means the patient replied to a reminder** — not that a supervisor
signed off. That's patient-driven and completely independent of where the visit
sits in its lifecycle, so athenahealth models it as a *separate field*. Folding
it into `status` is what made the old `confirmed` ambiguous: it couldn't
express "booked, but the patient hasn't answered yet" — exactly the appointments
a front desk chases.

So there are two independent columns:

| `status` (lifecycle — staff and time drive it) | `confirmation_status` (the patient drives it) |
|---|---|
| `booked` → `completed` | `unconfirmed` |
| `booked` → `cancelled` (+ reason + who) | `confirmed` |
| `booked` → `no_show` (+ reason) | `cancel_requested` |

Consequences that fall out of this, enforced in `src/routes/`:

- **Staff cannot set `confirmation_status`.** Only the patient can, via
  `PATCH /api/appointments/:id/confirm`. Letting staff forge it would
  manufacture the exact data the field exists to measure.
- **Staff cannot set `status` back to `booked`.** There's no approval to give
  and no un-cancelling — matching Epic, where *"you cannot undo an appointment
  cancellation... you must create a new appointment to replace it."*
- **Cancelling and no-showing require a reason**, and cancellations record
  `cancelled_by` (`patient` or `practice`). A bare status flip throws away the
  only thing the practice reports on. This is why `no_show_rate` is possible at
  all — the old model had nowhere to put a missed visit.

`no_show_rate` is measured against appointments that came due (kept + missed),
not every row ever created: a booking three weeks out hasn't had the chance to
be missed yet, and counting it would dilute the rate toward zero.

See `src/db/migrations/001_split_confirmation_from_lifecycle.sql` for the
migration and its rollback.

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
                                   requireRole ─▶ patient | admin
                                        │
                                   route handler (req.user)
```

---

## How double-booking is prevented

1. **Availability check** — the API recomputes a doctor's open slots from
   their weekly schedule minus existing bookings before accepting a booking.
2. **Database constraint** — a Postgres **partial unique index**
   (`doctor_id, appt_date, appt_time` `WHERE status != 'cancelled'`) makes it
   impossible for two active appointments to occupy the same slot, even if two
   requests race — the second insert fails and the API returns 409.

---

## Project structure

```
MAPS-System/
├── server.js                  # Entry point — init DB, start HTTP server
├── src/                       # Express backend
│   ├── app.js                 # Middleware, routes, SPA serving
│   ├── db/
│   │   ├── database.js        # pg Pool + query/tx helpers (DATABASE_URL)
│   │   ├── schema.sql         # PostgreSQL schema (tables, indexes)
│   │   └── seed.js            # Demo data seeder
│   ├── middleware/auth.js     # JWT sign/verify + role guards
│   ├── routes/                # auth, doctors, appointments, patients, admin
│   └── utils/                 # slot generation, async handler wrapper
└── client/                    # React + TypeScript frontend (Vite)
    ├── index.html
    └── src/
        ├── main.tsx, App.tsx  # Entry + routes
        ├── lib/api.ts         # Typed API client + session + helpers
        ├── components/        # Layout (sidebar shell), guards, modal, toast
        ├── pages/             # Landing, Login, Register
        │   ├── patient/       # Dashboard, Doctors, Appointments, Profile
        │   └── admin/         # Overview, Appointments, Doctors
        └── styles.css         # Design system (navy shell, blue accent)
```

---

## API overview

All `/api` routes return JSON. Authenticated routes expect an
`Authorization: Bearer <token>` header.

| Method | Endpoint                              | Role    | Purpose                       |
|--------|---------------------------------------|---------|-------------------------------|
| POST   | `/api/auth/register`                  | public  | Patient sign-up               |
| POST   | `/api/auth/login`                     | public  | Log in, receive a token       |
| GET    | `/api/auth/me`                        | any     | Current user + profile        |
| GET    | `/api/doctors`                        | patient | Search doctors (`q`, `specialty`) |
| GET    | `/api/doctors/:id/availability?date=` | patient | Open slots for a date         |
| GET    | `/api/appointments`                   | patient | Own appointments              |
| POST   | `/api/appointments`                   | patient | Book an appointment           |
| PATCH  | `/api/appointments/:id/confirm`       | patient | Confirm they'll attend        |
| PATCH  | `/api/appointments/:id/cancel`        | patient | Cancel own appointment (+reason) |
| GET/PUT| `/api/patients/me`                    | patient | Read / update profile         |
| GET/POST/PUT/DELETE | `/api/admin/doctors`     | admin   | Manage physicians             |
| GET    | `/api/admin/appointments`             | admin   | All appointments (filterable) |
| PATCH  | `/api/admin/appointments/:id/status`  | admin   | Record outcome: completed / cancelled / no_show |
| GET    | `/api/admin/reports/summary`          | admin   | Headline metrics              |
| GET    | `/api/admin/reports/physician-utilization` | admin | Per-doctor counts       |
| GET    | `/api/admin/reports/volume-by-specialty`   | admin | Volume per specialty    |

---

## Deployment

- **Free hosting:** deploy to **Render** via the included `render.yaml`
  blueprint — set `DATABASE_URL` to your Neon connection string in the Render
  dashboard. Data lives in Neon, so it persists across deploys.
- **AWS:** see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a step-by-step
  EC2 guide plus other options.

---

## License

MIT — for educational use as part of CIS 9590.
