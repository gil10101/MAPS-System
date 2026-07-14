# MAPS — Medical Appointment & Patient Scheduling System

A web-based appointment scheduling platform for outpatient clinics and medical
offices. Patients create accounts, search for doctors, and book appointments;
clinic administrators manage physicians, approve or cancel bookings, and view
operational reports.

> **CIS 9590 group project** — Liu Maggie · Lopez Raylene · Lu Gil · Mammadov Mehdi

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
- View and filter all appointments; approve, complete, or cancel them
- Operational reports: appointment volume, physician utilization,
  cancellation rate, and status breakdown

**Platform**
- JWT authentication with hashed passwords (bcrypt) and role-based access
- Single Node process serves both the REST API and the frontend — easy to deploy
- SQLite database, created and seeded automatically — no DB server to install

---

## Tech stack

| Layer     | Technology                              |
|-----------|-----------------------------------------|
| Backend   | Node.js + Express                       |
| Database  | SQLite (via `better-sqlite3`)           |
| Auth      | JSON Web Tokens (`jsonwebtoken`) + `bcryptjs` |
| Frontend  | Vanilla HTML/CSS/JavaScript (no build step) |

---

## Quick start

Requires **Node.js 18+**.

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
cp .env.example .env

# 3. Seed the database with demo data (doctors, an admin, sample patients)
npm run seed

# 4. Start the server
npm start
```

Then open **http://localhost:3000**.

### Demo logins

| Role    | Email                | Password     |
|---------|----------------------|--------------|
| Admin   | `admin@maps.health`  | `admin123`   |
| Patient | `jdoe@example.com`   | `patient123` |

New patients can also self-register from the sign-up page.

### Useful scripts

| Command            | Description                                        |
|--------------------|----------------------------------------------------|
| `npm start`        | Start the server                                   |
| `npm run dev`      | Start with auto-reload on file changes             |
| `npm run seed`     | Insert demo data (skips if data already exists)    |
| `npm run reset-db` | Wipe all tables and re-seed from scratch           |

---

## Project structure

```
MAPS-System/
├── server.js                 # Entry point — starts the HTTP server
├── src/
│   ├── app.js                # Express app: middleware, routes, static serving
│   ├── db/
│   │   ├── database.js        # SQLite connection + schema init
│   │   ├── schema.sql         # Database schema (tables, indexes)
│   │   └── seed.js            # Demo data seeder
│   ├── middleware/auth.js     # JWT sign/verify + role guards
│   ├── routes/
│   │   ├── auth.js            # register / login / me
│   │   ├── doctors.js         # doctor search + availability (patient)
│   │   ├── appointments.js    # book / list / cancel (patient)
│   │   ├── patients.js        # profile read/update (patient)
│   │   └── admin.js           # doctor CRUD, appointment mgmt, reports (admin)
│   └── utils/slots.js         # Turns weekly schedules into open time slots
├── public/                   # Frontend (served statically)
│   ├── index.html             # Landing page
│   ├── login.html / register.html
│   ├── app/                   # Patient pages
│   └── admin/                 # Administrator pages
└── data/                     # SQLite database file (created at runtime)
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
| PATCH  | `/api/appointments/:id/cancel`        | patient | Cancel own appointment        |
| GET/PUT| `/api/patients/me`                    | patient | Read / update profile         |
| GET/POST/PUT/DELETE | `/api/admin/doctors`     | admin   | Manage physicians             |
| GET    | `/api/admin/appointments`             | admin   | All appointments (filterable) |
| PATCH  | `/api/admin/appointments/:id/status`  | admin   | Approve / complete / cancel   |
| GET    | `/api/admin/reports/summary`          | admin   | Headline metrics              |
| GET    | `/api/admin/reports/physician-utilization` | admin | Per-doctor counts       |
| GET    | `/api/admin/reports/volume-by-specialty`   | admin | Volume per specialty    |

---

## How double-booking is prevented

Two layers protect against conflicting bookings:

1. **Availability check** — the API recomputes a doctor's open slots from their
   weekly schedule minus existing bookings before accepting a new appointment.
2. **Database constraint** — a partial unique index
   (`doctor_id, appt_date, appt_time` where `status != 'cancelled'`) makes it
   impossible for two active appointments to occupy the same slot, even under a
   race condition.

---

## Deployment

The app is a single Node process, so it deploys anywhere Node runs. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for a step-by-step **AWS EC2** guide
(the setup used for the class demo), plus notes on environment variables and
running it as a background service.

---

## License

MIT — for educational use as part of CIS 9590.
