# MediSync — Additions and Corrections to the Final Report

This document contains new sections and corrections for the MediSync CIS 9590 Final Report. It was
produced after the working prototype was brought into alignment with the report: features the report
described but the prototype lacked have been built, and capabilities the prototype had but the report
never documented are written up here. Every claim below has been verified against the source code and,
where the material is SQL, executed against the live database.

Page numbers refer to the 35-page PDF. Section numbers refer to the report's own numbering. Two new
sections are inserted in the body, which shifts the numbering of the sections that follow them; the
affected headings are called out where that happens.

---

## Merge summary

| # | Section | Where it goes | Action |
|---|---|---|---|
| 1 | Outputs — reporting and export | p. 6, §1.4 | Replaces the Outputs bullet list |
| 2 | Level 0 diagram — the reminder service | p. 8, §2.2 | Adds a clarifying paragraph |
| 3 | Physician Availability and Slot Generation | p. 10, after Figure 3 | **New §2.3** (old 2.3 → 2.4, old 2.4 → 2.5) |
| 4 | Menu Hierarchy | p. 10–11, §2.3 (renumbered 2.4) | Replaces all three menus |
| 5 | Report Design | p. 11, §2.4 (renumbered 2.5) | Replaces the intro sentence and the report table |
| 6 | Cancellation and Attendance Data | p. 15, after §3.5 | **New §3.6** (old 3.6 → 3.7, old 3.7 → 3.8) |
| 7 | Database Design / Schema | p. 15–16, §3.6 (renumbered 3.7) | Replaces the section and Table Summary |
| 8 | Sample SQL Queries | p. 16–18, §3.7 (renumbered 3.8) | Replaces all six queries, adds three |
| 9 | Implemented Features | p. 20, §4.4 | Replaces the table |
| 10 | Platform Decisions | p. 30, §5.2 | Replaces the stack table |
| — | Changes to make by hand | various | 14 items — deletions and edits, not paste-ins. See final section |

---

## 1. Outputs — reporting and export

**Insert at:** page 6, section 1.4 — *replaces the existing "Outputs" bullet list*

**Outputs**

- **Database updates:** new and modified patient profiles, appointments, physician schedules,
  availability blocks, and prescription refill requests.
- **On-screen confirmations:** booking requests, approval and cancellation notices, scheduling
  conflicts, and status changes shown to the user as they occur.
- **Notifications:** an in-application notification for every appointment event — request, approval,
  reschedule, cancellation, completion, and a prompt to move a booking the practice has blocked out —
  delivered to the affected user's notification tray. The same message is mirrored to email and to
  text message for users who have those channels switched on in their profile. Scheduled
  pre-appointment reminders (a message sent a fixed interval before a visit) are not built and remain
  a future enhancement; what exists today is event-driven.
- **Reports:** the five operational reports described in section 2.5, viewable on screen by clinic
  administrators. The Daily Appointment Report is run for a single date and defaults to today; the
  other four take a date range and default to the current calendar month. Every report can be
  downloaded as a CSV file for use in a spreadsheet, which is how a practice manager circulates
  figures to people who do not hold a MediSync account.

---

## 2. Level 0 diagram — the reminder service

**Insert at:** page 8, section 2.2, immediately after Figure 1 — *new paragraph*

The Email/SMS Reminder Service shown at the system boundary is implemented as an internal
notification service rather than as an integration with a commercial messaging provider. MediSync
decides which messages are due, records each one against the recipient and the appointment it
concerns, and honours the per-channel preferences the patient sets on their profile. Messages
addressed to the in-application notification tray are delivered in full. Messages addressed to email
or text message are recorded as sent but are not handed to a live carrier, because selecting a
messaging vendor is a procurement decision a clinic makes at deployment rather than a design decision
the prototype should pre-empt. The boundary and the data flows in the diagram are therefore accurate;
only the final delivery hop is simulated, and substituting a real provider is a change to one
function.

One limit is worth stating plainly, because the report calls automated reminders a future
enhancement in Phase 5 and that remains true. Messages are raised by events — a booking is requested,
approved, moved, or cancelled — not by a clock. There is no scheduled job that walks tomorrow's book
and sends a reminder ahead of each visit. The channel plumbing, the per-user preferences, and the
message wording for a reminder all exist; what is missing is the scheduler that would trigger them,
which is the piece a production deployment would add alongside the messaging vendor.

---

## 3. Physician Availability and Slot Generation

**Insert at:** page 10, immediately after Figure 3 and before the current heading "2.3 Menu
Hierarchy" — *new section 2.3. The existing 2.3 becomes 2.4, and 2.4 becomes 2.5.*

### 2.3   Physician Availability and Slot Generation

The Search Doctor Availability sub-process in the Level 2 diagram rests on a single design decision:
MediSync stores a physician's availability as a set of recurring weekly windows rather than as
individually created appointment slots. A window records one weekday, a start time, an end time, a
slot length in minutes, and the clinic location the window runs at. A physician who holds Monday
clinic at one site and Thursday clinic at another is described by two windows rather than by two
separate calendars, and because the location belongs to the window rather than to the physician, the
same provider can hold clinic at more than one site on different weekdays.

| Window field | What it records |
| --- | --- |
| Weekday | The day of the week the window repeats on, Sunday through Saturday |
| Start time / End time | The clinic hours on that weekday, in 24-hour form |
| Slot length | The number of minutes each bookable appointment occupies |
| Location | The clinic site the window runs at, which every slot generated from it carries |

Bookable slots are generated from these windows on demand, for the single date the patient is
viewing. When a patient opens a physician's availability for a date, the system reads the windows
that apply to that date's weekday, divides each window into slot-length chunks, and removes the times
already held by a live appointment. A trailing gap shorter than one slot is not offered, because a
visit booked into it would run past the end of the clinic window. Each slot returned to the patient
names its site, so the patient knows which building to travel to before choosing a time rather than
after.

A schedule block removes a date range from availability entirely. Blocks cover the situations the
weekly pattern cannot express — vacation, a conference, a clinic closure — and a date falling inside
one returns no slots at all, regardless of what the physician's usual week looks like. Appointments
already booked inside a blocked range are not cancelled: the patient keeps their place and the
booking is flagged for the patient to reschedule, which is the decision rule described in section 3.5.
Every live booking in the range is flagged, both the requests still awaiting approval and the ones the
clinic has already confirmed — a confirmed patient turning up to a closed clinic is the worse of the
two failures, so limiting the flag to pending requests would protect the wrong group. Lifting one
block clears the flag only from bookings that no longer fall inside any remaining block, so
overlapping absences do not cancel each other out.

The same slot-generation logic supplies the denominator for the Provider Utilization Report. Capacity
for a physician over a date range is calculated by expanding the same weekly windows across the range
and dropping the days covered by a block, so a physician on leave is not measured against slots they
never offered. Because availability and utilization are computed from one definition of what a
bookable slot is, the availability a patient sees and the utilization figure a clinic administrator
reads can never disagree; a denominator built from its own separate query would drift away from what
patients can actually book, and the percentage would stop describing anything real.

Generating slots on demand is preferable to materialising every future slot as a database row. A year
of open slots for every physician in the practice would be a large table that is almost entirely
empty, since the overwhelming majority of those rows never become appointments and exist only to be
read once and discarded. It would also make an ordinary administrative action expensive: changing a
physician's hours, or adding an afternoon at a second site, would require rewriting every future row
derived from the old pattern. Under the window model the pattern is the record, an edit takes effect
on the next search, and the only rows the database stores are appointments that genuinely exist.

---

## 4. Menu Hierarchy

**Insert at:** page 10–11, section 2.3 (renumbered 2.4) — *replaces all three menus*

### 2.4   Menu Hierarchy

MediSync presents three role-specific navigation menus, shown to a user only after successful login
and role verification:

**Patient Menu**
- Login / Register
- Dashboard
- Find a Doctor → Search by Name, Search by Specialty, Search by Location
- Book Appointment → Select Doctor, Select Date/Time, Confirm
- My Appointments → List View, Calendar View; All, Upcoming, Pending, Past; Reschedule, Cancel
- Medications → Request Refill, Refill Status
- Profile → Personal Info, Insurance Info, Reminder Preferences

**Doctor Menu**
- Schedule → Day View, Week View, Month View; Complete Visit with Note, Record Non-Attendance
- My Patients → Patient List, Patient Chart → Visit Notes, Prescribe, Stop Medication
- Refill Requests → Approve / Deny
- Reports → Daily Appointments, My Workload, Patient Visit History

**Administrator Menu**
- Overview
- Appointments → Approve, Reschedule, Cancel, Record Non-Attendance, Record Note
- Reports → Daily Appointments, Doctor Workload, Cancellations, Provider Utilization
- Physicians → Add Physician, Edit Physician, Create Portal Login, Deactivate
- Schedules → Weekly Availability, Availability Blocks
- Locations → Add Site, Edit Site
- Specialties → Add, Edit, Delete

Three changes from the original menu hierarchy are worth noting. Search by Location is now a working
filter rather than a planned one: a patient may narrow the physician directory to a single clinic
site, which matters in a practice operating from more than one building. The administrator menu no
longer offers a View Patient Records item. Clinic administrators are deliberately not given access to
clinical records, on the same need-to-know principle that governs the rest of the system —
administrators schedule care, and scheduling does not require reading a patient's chart.

The third is that completing a visit is absent from the administrator's appointment actions and
present in the physician's. Marking a visit complete is the provider stating that they saw the
patient, and it is the row every workload and utilization figure is built on. An administrator can
see that a slot came and went; they cannot see that a consultation happened. The API refuses the
transition from an administrator and names the physician who owns it, rather than treating it as an
invalid request, so the person is told where to go instead of retrying something that can never
succeed. Recording non-attendance is the mirror case and sits in both menus: either the front desk or
the provider can state that the patient never arrived, because both were there to observe it.

---

## 5. Report Design

**Insert at:** page 11, section 2.4 (renumbered 2.5) — *replaces the introductory sentence and the
report table. The two "Sample Report Layout" subsections that follow on pages 11–12 stay, with the
one correction noted in the final section of this document.*

### 2.5   Report Design

MediSync generates the following five operational reports. The Daily Appointment Report is run for a
single date and defaults to today; the other four take a date range and default to the current
calendar month. Every report can be downloaded as a CSV file.

| Report Name | Data Produced | Who Can Run It | Purpose |
| --- | --- | --- | --- |
| Daily Appointment Report | All appointments for a selected date, by physician, time, site, and status | Admin, Doctor | Front-desk and provider view of the day's schedule |
| Doctor Workload Report | Appointment count and hours booked per physician over a date range | Admin, Doctor | Balance patient load across providers |
| Patient Visit History Report | Chronological list of one patient's visits and the notes recorded at each | Doctor | Clinical continuity and patient record review |
| Appointment Cancellation Report | Cancelled and missed appointments over a date range, with reason and initiator | Admin | Identify no-show trends and reduce lost capacity |
| Provider Utilization Report | Percentage of available appointment slots booked, per physician | Admin | Staffing and scheduling decisions |

Two points of definition. The Provider Utilization Report measures booked slots against genuine
capacity rather than against a fixed assumption about clinic hours: the denominator is produced by
expanding each physician's weekly availability windows across the selected range and removing any
days covered by an availability block, so a physician on leave is not penalised for slots they never
offered. Confirmed, completed, and missed appointments all count as booked, because each consumed the
slot; cancelled appointments do not, because the slot returned to the pool.

The Patient Visit History Report is surfaced in the physician's portal only. It is the one report that
exposes clinical notes, and the same need-to-know reasoning that keeps patient records out of the
administrator's menu applies to it: a physician may review the history of a patient under their care,
and the report restricts them to exactly that set — asking for a patient they have never seen is
refused outright rather than answered with an empty table, since an empty table would still confirm
the patient exists. The administrator's Reports screen offers the other four and not this one.

---

## 6. Cancellation and Attendance Data

**Insert at:** page 15, immediately after the bulleted rules of section 3.5 and before the current
heading "3.6 Database Design / Schema" — *new section 3.6. The existing 3.6 becomes 3.7, and 3.7
becomes 3.8.*

### 3.6   Cancellation and Attendance Data

Section 3.5 states that a cancellation is logged; this section describes what that log contains. When
an appointment is cancelled, MediSync records three facts alongside the status change: a free-text
reason, who initiated the cancellation, and the moment it was recorded. The reason is required rather
than optional in both the patient flow and the clinic flow, because cancellation reporting is the
reason the data is captured at all, and a row that says only "cancelled, reason not recorded"
contributes nothing an administrator can act on.

| Field | What it records | Where it is set |
| --- | --- | --- |
| Cancellation reason | Free text, chosen from a preset list or typed in | Patient cancellation, clinic cancellation, and non-attendance |
| Cancelled by | `patient`, `practice`, or `unknown` | Set automatically from which flow performed the cancellation |
| Cancelled at | Timestamp of the cancellation | Set automatically by the system |

The interface offers a different preset list depending on who is cancelling, because the two produce
different operational signals. A patient reporting a transport problem points at an access barrier
the practice may be able to remove; a clinic administrator recording "provider unavailable" points at
a staffing or scheduling problem inside the practice. Collapsing both into one list would force the
two into a shared vocabulary that fits neither. Each list also ends with an "Other…" option that
accepts free text, so an uncommon reason is captured rather than forced into the nearest preset.

| Recorded by | Preset reasons offered |
| --- | --- |
| Patient | Schedule conflict; Feeling better / no longer needed; Transport or access problem; Cost or insurance concern; Booking another time |
| Clinic administrator (cancellation) | Provider unavailable; Clinic closure; Rescheduled at patient request; Duplicate booking; Booked in error |
| Clinic staff — administrator or physician (non-attendance) | Did not attend, no contact; Arrived too late to be seen; Patient called after the fact |

Non-attendance is a distinct status from cancellation. A cancelled appointment is one the practice was
told about in advance; a no-show is a confirmed appointment the patient never arrived for, and only
clinic staff can record it, since only they know whether the patient turned up. Either the front desk
or the treating physician may record it, from the same preset list. It can be recorded only against a
booking that was actually confirmed: a request nobody ever approved was never a commitment the patient
could fail to keep, and allowing a no-show against one would inflate the figure the practice measures
itself on. A no-show carries a reason in the same field a cancellation uses, so the reporting query
reads one column for both outcomes, but no initiator is attributed to it, because nobody cancelled
the visit — in the live database every no-show row has a reason and a null initiator, which is what
lets the report tell the two apart at a glance. A patient
rescheduling an existing booking produces a third case: the superseded booking is recorded as a
patient cancellation with the fixed reason "Rescheduled to another time", so a booking that moved can
be told apart from a patient who walked away.

The distinction drives one operational rule. A cancellation returns the slot to the pool and another
patient may book it; a no-show does not, because the appointment still consumed the physician's time
and the practice cannot sell that time twice. The rule is enforced by the database constraint that
prevents double-booking, which excludes cancelled appointments alone, and it carries through to the
reports: a no-show counts as a booked slot in the Provider Utilization Report, while a cancellation
does not.

This is what makes the Appointment Cancellation Report worth running. The report lists every cancelled
and missed appointment over a date range with its reason, its initiator, and its timestamp side by
side, so the two losses can be compared rather than summed. A report that knew only a count could not
separate a late patient cancellation, which the practice may be able to reduce with reminders, from a
clinic-initiated bump, which is a scheduling failure the practice caused itself; nor could it separate
either from a no-show, which is the most expensive outcome of the three because the slot was never
released. The remedies for those three cases are different, and a single cancellation rate would point
at none of them.

---

## 7. Database Design / Schema

**Insert at:** page 15–16, section 3.6 (renumbered 3.7) — *replaces the section and its Table Summary*

### 3.7   Database Design / Schema

MediSync's PostgreSQL database is organised around eleven tables. The Entity Relationship Diagram
shows each table's key fields and the relationships between them.

**Identity is separated from role.** Every person who can sign in — patient, physician, or clinic
administrator — has exactly one row in `users`, carrying the email address, the password hash, and the
role. Role-specific data lives in its own table alongside it: a patient's demographics in `patients`, a
physician's directory entry in `doctors`. Holding credentials on a single table means authentication is
written once and behaves identically for all three roles; distributing password columns across
`patients` and a separate `admins` table, as an early draft of this schema did, would have meant three
implementations of the same login and three places to correct a security fix.

The physician case shows why the separation earns its place. A physician has a `users` row, which is
their login, and a `doctors` row, which is their entry in the directory patients browse. The two are
linked by `doctors.user_id`, and that link is optional: a clinic can enter a physician into the
directory, publish their schedule, and take bookings before that physician has ever signed in. The
account is created afterwards by an administrator, because the clinic vouches for the identity of its
own physicians in a way it cannot vouch for a member of the public, and physicians therefore do not
self-register.

**There is no separate visit-record table.** The note a physician writes when completing a visit is a
column on `appointments`. A visit and its note are one-to-one, and a second table joined on the
appointment key would store the same identifier twice and buy nothing but an extra join on every read.

**A prescription and a request to refill it are separate tables.** The medication has one lifecycle —
active, completed, or stopped — and a refill request has another, moving from pending to approved or
denied and carrying its own decision note and decision timestamp. Folding the request into the
prescription would mean a prescription could only ever remember its most recent request, which would
make the refill queue impossible to audit. This continues the reasoning already recorded in the change
log at Appendix D, week 3, where prescriptions were promoted out of the appointment record for the same
reason.

**Names are stored in parts.** `users` and `doctors` each hold `first_name` and `last_name` separately,
with `full_name` defined as a generated column the database derives and maintains. Operational reports
sort physicians and patients by surname, which a single name field cannot support, and a combined field
cannot be reliably split back apart — "Mary Anne Van Der Berg" has no dependable division point. Because
`full_name` is generated rather than stored by the application, the display name can never drift out of
step with its parts, and the database rejects any attempt to write to it directly. On `doctors` the
credential prefix is a third part rather than something baked into the first name, so the generated
name reads "Dr. Sarah Kim" while the surname remains available on its own to sort by.

**A physician's portrait is a path, not an image.** `doctors.photo_url` points at a static file served
with the front end. Storing the picture itself in the database would mean pulling every face through
a query on every render of the directory, which is the slowest available way to draw a list of
photographs. The column is nullable, and a physician without one falls back to their initials.

#### Table Summary

| Table | Purpose | Key Relationships |
| --- | --- | --- |
| users | Login credentials, name, contact details, and role for every person in the system | 1 user → 0..1 patient; 1 user → 0..1 doctor |
| patients | Demographic profile for users holding the patient role | FK to users; 1 patient → many appointments, many prescriptions |
| specialties | Lookup table of medical specialties | 1 specialty → many doctors |
| locations | Clinic sites the practice operates from | 1 location → many schedule windows, many appointments |
| doctors | Physician directory entry patients browse and book against, including the portrait shown in it | FK to specialties; optional FK to users; 1 doctor → many appointments |
| doctor_schedules | Recurring weekly availability windows, each at one site | FK to doctors, FK to locations |
| schedule_blocks | Date ranges removed from a physician's availability | FK to doctors |
| appointments | Core transactional table linking a patient and a physician to a date, time, and site | FK to patients, doctors, locations; optional self-FK for a rescheduled booking |
| prescriptions | Medications written by a physician for a patient | FK to patients, doctors; optional FK to appointments |
| refill_requests | A patient's request for more of a prescription, and the physician's decision | FK to prescriptions, FK to patients |
| notifications | Messages raised for a user, per delivery channel | FK to users; optional FK to appointments |

#### Appointment status

An appointment moves along a single lifecycle. A booking is created as **pending**, becomes
**confirmed** when clinic staff approve it, and finishes as **completed** or **no_show**. A
**cancelled** appointment is terminal and reachable from either open state.

```
pending ──┬──► confirmed ──┬──► completed     (patient was seen)
          │                └──► no_show       (never arrived)
          └──► cancelled                      (terminal, with reason and initiator)
```

Double-booking is prevented by a partial unique index on physician, date, and time that excludes
cancelled appointments. Cancelled rows are excluded so that a released slot becomes bookable again;
missed appointments are not excluded, because the slot was consumed whether or not the patient arrived.

---

## 8. Sample SQL Queries

**Insert at:** page 16–18, section 3.7 (renumbered 3.8) — *replaces all six queries; two are added*

### 3.8   Sample SQL Queries

The following queries represent the core transactions and reports supported by the MediSync backend
API. Each has been executed against the live database.

**Create a new patient account.** The login and the demographic profile are written in one transaction,
so a half-created account cannot exist. `full_name` is not supplied — the database derives it.

```sql
INSERT INTO users (email, password_hash, role, first_name, last_name, phone)
VALUES ('jordan.alvarez@email.com', $1, 'patient', 'Jordan', 'Alvarez', '555-0142')
RETURNING id;                       -- $1 is the bcrypt hash; the id feeds the next statement

INSERT INTO patients (user_id, date_of_birth, gender, address, insurance_provider)
VALUES ($1, '1990-04-12', 'prefer_not_to_say', '88 Bleecker St, New York, NY', 'Aetna')
RETURNING id;                       -- $1 here is the users.id returned above
```

**Search available physicians by specialty and site.**

```sql
SELECT DISTINCT d.id, d.last_name, d.full_name, s.name AS specialty_name, d.room
FROM doctors d
JOIN specialties s ON s.id = d.specialty_id
JOIN doctor_schedules ds ON ds.doctor_id = d.id
JOIN locations l ON l.id = ds.location_id
WHERE d.active = true
  AND s.name = 'Cardiology'
  AND l.name = 'Midtown Clinic'
ORDER BY d.last_name;
```

**Find the open slots a physician has on a date.** The window is expanded into slot-length steps, the
times already taken are removed, and a date inside an availability block yields nothing.

```sql
SELECT ds.start_time, ds.end_time, ds.slot_minutes, l.name AS location_name
FROM doctor_schedules ds
JOIN locations l ON l.id = ds.location_id
WHERE ds.doctor_id = $1
  AND ds.weekday = EXTRACT(DOW FROM $2::date)
  AND NOT EXISTS (
    SELECT 1 FROM schedule_blocks b
    WHERE b.doctor_id = $1 AND $2::date BETWEEN b.start_date AND b.end_date
  );

SELECT appt_time FROM appointments
WHERE doctor_id = $1 AND appt_date = $2::date AND status <> 'cancelled';
```

**Book an appointment.** The booking is created as a request awaiting clinic approval.

```sql
INSERT INTO appointments (patient_id, doctor_id, location_id, appt_date, appt_time, reason, status)
VALUES ($1, $2, $3, $4, $5, $6, 'pending')
RETURNING id;
```

There is deliberately no `WHERE NOT EXISTS` conflict check on this statement. A check of that form
reads the table and then writes to it, and two patients booking the same slot at the same moment can
both pass the read before either performs the write, producing exactly the double-booking the check was
written to prevent. MediSync instead declares the rule as a constraint:

```sql
CREATE UNIQUE INDEX idx_appt_no_double_book
    ON appointments (doctor_id, appt_date, appt_time)
    WHERE status <> 'cancelled';
```

The database enforces this on every insert, and a race is impossible because the second write fails
rather than being evaluated against a stale read. The API catches the resulting unique-violation and
returns a message asking the patient to choose another time. Declaring the invariant once in the schema
is also what keeps it true for every future code path that inserts an appointment.

**Approve a pending appointment.** The status guard in the `WHERE` clause makes the transition legal
only from `pending`, so a double submission cannot re-approve a visit that has already been completed.

```sql
UPDATE appointments
SET status = 'confirmed', approved_by = $2, approved_at = now(), updated_at = now()
WHERE id = $1 AND status = 'pending'
RETURNING id;
```

**Cancel an appointment.** The reason and the initiator are recorded with the status change.

```sql
UPDATE appointments
SET status = 'cancelled', cancel_reason = $3, cancelled_by = 'patient',
    cancelled_at = now(), updated_at = now()
WHERE id = $1 AND patient_id = $2 AND status IN ('pending', 'confirmed');
```

**Daily Appointment Report.**

```sql
SELECT a.appt_time, pu.full_name AS patient, d.full_name AS doctor,
       s.name AS specialty_name, l.name AS location_name, a.status
FROM appointments a
JOIN patients p  ON p.id = a.patient_id
JOIN users pu    ON pu.id = p.user_id
JOIN doctors d   ON d.id = a.doctor_id
LEFT JOIN specialties s ON s.id = d.specialty_id
LEFT JOIN locations l   ON l.id = a.location_id
WHERE a.appt_date = CURRENT_DATE
ORDER BY a.appt_time, d.last_name;
```

**Doctor Workload Report.** Booked hours are derived from the slot length of the window each
appointment falls in, so a practice running appointments of different lengths reports correctly: a
fifteen-minute dermatology follow-up and a forty-five-minute new-patient visit are one appointment
each and nothing like one hour each.

```sql
SELECT d.full_name AS doctor, s.name AS specialty_name,
       COUNT(a.id) AS appointments,
       ROUND(COALESCE(SUM(COALESCE(w.slot_minutes, 30))
                      FILTER (WHERE a.id IS NOT NULL), 0) / 60.0, 1) AS booked_hours
FROM doctors d
LEFT JOIN specialties s ON s.id = d.specialty_id
LEFT JOIN appointments a
       ON a.doctor_id = d.id
      AND a.appt_date BETWEEN $1::date AND $2::date
      AND a.status IN ('confirmed', 'completed', 'no_show')
LEFT JOIN LATERAL (
  SELECT ds.slot_minutes
  FROM doctor_schedules ds
  WHERE ds.doctor_id = a.doctor_id
    AND ds.weekday   = EXTRACT(DOW FROM a.appt_date)
    AND a.appt_time >= ds.start_time
    AND a.appt_time <  ds.end_time
  ORDER BY ds.start_time
  LIMIT 1
) w ON true
WHERE d.active = true
GROUP BY d.id, d.full_name, d.last_name, s.name
ORDER BY appointments DESC, d.last_name;
```

Three details in that statement are load-bearing. The physician join is a `LEFT JOIN`, so a provider
with an empty book reads as a row of zeroes rather than vanishing from the report — a missing row
looks like a data problem, while a zero is an answer. The `FILTER (WHERE a.id IS NOT NULL)` is what
keeps that row honest: without it the outer join's single null appointment still passes through
`COALESCE(w.slot_minutes, 30)` and the physician is credited with half an hour they never worked. And
the schedule lookup is a `LATERAL … LIMIT 1` rather than a plain join, so one appointment can only
ever match one window and contribute its length once. The fallback to thirty minutes covers an
appointment whose window has since been narrowed or deleted: a visit that already happened has to keep
contributing hours rather than silently dropping out of the sum.

**Appointment Cancellation Report.** Cancellations and non-attendance are read together so the two
losses can be compared.

```sql
SELECT a.appt_date, a.appt_time, pu.full_name AS patient, d.full_name AS doctor,
       a.status, a.cancel_reason, a.cancelled_by, a.cancelled_at
FROM appointments a
JOIN patients p ON p.id = a.patient_id
JOIN users pu   ON pu.id = p.user_id
JOIN doctors d  ON d.id = a.doctor_id
WHERE a.status IN ('cancelled', 'no_show')
  AND a.appt_date BETWEEN $1::date AND $2::date
ORDER BY a.appt_date DESC, a.appt_time;
```

---

## 9. Implemented Features (Prototype Scope)

**Insert at:** page 20, section 4.4 — *replaces the table*

| Feature | Status |
| --- | --- |
| Responsive login and role-based authentication | Implemented |
| Patient self-registration | Implemented |
| Physician search by name, specialty, and clinic location | Implemented |
| Real-time availability from physician schedules | Implemented |
| Appointment booking with database-enforced conflict prevention | Implemented |
| Administrator approval of pending appointment requests | Implemented |
| Patient rescheduling of an existing appointment | Implemented |
| Administrator rescheduling on the patient's behalf | Implemented |
| Appointment cancellation with reason and initiator captured | Implemented |
| Non-attendance recording by administrator or physician | Implemented |
| Visit completion with clinical note (physician only) | Implemented |
| Day, week, and month calendar views | Implemented |
| Physician weekly schedule management | Implemented |
| Physician availability blocks with automatic rescheduling flags | Implemented |
| Multi-site clinic locations | Implemented |
| Specialty management | Implemented |
| Physician portal account provisioning | Implemented |
| Physician directory portraits | Implemented |
| Prescribing and discontinuing medications from the patient chart | Implemented |
| Prescription refill requests and physician approval | Implemented |
| Administrator dashboard | Implemented |
| Five operational reports with date filters | Implemented |
| CSV export of every report | Implemented |
| In-application notifications | Implemented |
| Email and SMS notification channels with per-user preferences | Implemented (delivery simulated) |
| Backend database integration (PostgreSQL / Neon) | Implemented |
| Automated pre-appointment reminders on a schedule | Planned (Future Enhancement) |
| Telemedicine / video visits | Planned (Future Enhancement) |
| Insurance eligibility verification | Planned (Future Enhancement) |
| Online co-pay and bill payment | Planned (Future Enhancement) |
| Patient-facing mobile application | Planned (Future Enhancement) |
| Analytics dashboard with trend charts over time | Planned (Future Enhancement) |

The reminder row is worth reading carefully, because it is the one line in this table that is neither
a plain "Implemented" nor a plain "Planned". The channels, the per-user preferences, and the message
wording are built and exercised on every appointment event; the delivery hop to a carrier is
simulated, and the scheduler that would fire a reminder ahead of a visit is not built at all. The
report's Phase 5 entry for automated reminders therefore stands as written.

---

## 10. Platform Decisions

**Insert at:** page 30, section 5.2 — *replaces the stack table*

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Frontend build | Vite |
| Routing | React Router |
| Icons | Lucide |
| Backend | Node.js, Express (REST API) |
| Authentication | JSON Web Tokens (JWT) + bcrypt password hashing |
| Database | PostgreSQL, hosted on Neon |
| Database driver | node-postgres (pg) |
| Version Control | Git / GitHub |
| Deployment / Hosting | Vercel |
| Development Hardware | Team-owned laptops; no on-premise servers required |

Vite was added to the table because it is the tool that compiles and bundles the front end, and a
reader reproducing the build needs to know it. Tailwind CSS supplies the styling: the interface is
built from utility classes configured against a small set of project design tokens, rather than from a
hand-maintained stylesheet, which is what keeps the three role interfaces visually consistent without
duplicating rules across pages.

---

## Changes the team must make by hand

These are deletions and edits to existing report text rather than material to paste in. They are in
page order, so the list can be worked through in one pass. Items 8 to 11 are passages that turn out to
be correct as written; they are recorded so nobody "fixes" them by mistake.

1. **Page 11, section 2.3 — remove the administrator menu line `Patients → View Patient Records`.**
   Clinic administrators do not have access to patient clinical records in MediSync. The replacement
   menu in section 4 of this document already omits it; the note is here so the change is not missed
   if the menus are edited by hand instead.

2. **Page 11, section 2.3 — remove `Patient Visit History` from the administrator menu's Reports
   line.** The original reads `Reports → Daily Appointments, Doctor Workload, Cancellations, Patient
   Visit History, Provider Utilization`. The administrator's Reports screen offers four reports and
   not that one, for the same need-to-know reason as the item above. This is the same correction as
   item 3, applied to the menu rather than to the report table; both places have to change or the two
   pages contradict each other.

3. **Page 11, section 2.4 — change the Patient Visit History Report audience from "Admin, Doctor" to
   "Doctor".** This is already reflected in the replacement table in section 5 above.

4. **Page 11, section 2.4 — the sentence introducing the report table is replaced, not just the
   table.** It currently reads "All reports are available to Clinic Administrators from the Reports
   menu; the Daily Appointment Report and Doctor Workload Report are also available to individual
   doctors for their own schedule." Both halves are now wrong: administrators do not get the Patient
   Visit History Report, and physicians get three reports rather than two. The replacement sentence is
   in section 5 above.

5. **Page 11, "Sample Report Layout — Daily Appointment Report" — add a Location column.** The layout
   shows Time, Patient, Doctor, Specialty, Status. The report as built also names the clinic site,
   which is the point of supporting a multi-site practice at all, and the replacement description in
   section 5 says so. Adding the column keeps the sample layout consistent with the table above it.
   The Doctor Workload sample layout on page 12 needs no change.

6. **Page 15, section 3.4, Use Case 3 — remove the words "or an administrator".** The sentence
   currently reads that a visit note is "stored as part of the visit record for future reference by
   that provider or an administrator". Administrators cannot read visit notes through any patient-facing
   or record-browsing screen. They may record or amend a note against a specific appointment they are
   administering, which is a scheduling action; they have no route that lists a patient's clinical
   history. The phrase should end at "that provider".

7. **Page 15, section 3.5, first bullet — drop "and returns the next available slots".** The bullet
   claims that a request for a taken slot is rejected "and returns the next available slots". The
   system rejects the request and tells the patient to pick another time; the remaining open slots are
   already on screen from the availability search, so nothing is re-sent with the rejection. The
   bullet should end at "(prevents double-booking)".

8. **Page 15, section 3.5, third bullet — widen "any pending requests" to "any live bookings".** The
   bullet reads that blocking a doctor's availability flags "any pending requests for that window".
   The system flags every booking still on the book inside the range, confirmed ones included — a
   confirmed patient arriving at a closed clinic is the worse of the two failures. The sentence should
   read "any bookings still live in that window, whether pending or confirmed, are flagged for the
   patient to reschedule".

9. **Page 20, section 4.5, and the screenshots throughout — the running application is branded
   MediSync.** The parenthetical note stating that the prototype is "branded MAPS in the running
   application" should be deleted, and the screenshots in section 4.5 recaptured, as the interface has
   been restyled and several screens are new. While recapturing, note that the Figure 9 caption on
   page 22 reads "Find a Doctor — search by name or specialty"; the screen now also filters by clinic
   location, so the caption should say so.

10. **Page 34, Appendix D — add a change-log row for the schema.** The change log records the week-3
    decision to promote prescriptions out of the appointment record, and section 7 of this document
    cites it. It does not record the later growth from the seven-table design to the eleven-table one.
    A row reading something like "Split login credentials onto a shared `users` table and added
    locations, schedules, availability blocks, refill requests, and notifications — one authentication
    path for all three roles, and multi-site scheduling the seven-table design could not express" keeps
    the appendix consistent with section 7.

11. **Page 5, sections 1.1 and 1.3 — the phrase "approve or cancel appointment requests" is now
    correct and needs no change.** It is listed here only because it was previously inconsistent with
    the prototype; the approval workflow has since been built, and these sentences are accurate as
    written.

12. **Page 19, section 4.3 — the demo story is accurate and needs no change,** with one addition worth
    making: the patient's edit of their appointment is now a genuine reschedule that releases the
    original slot and creates a new request, and the administrator's approval step operates on a real
    pending queue. Both are worth naming explicitly during the demonstration.

13. **Page 34, Appendix C, week 4 — the meeting log recording that a seven-table schema was approved
    is history and is correct as written.** It records what the team decided in week 4, not what the
    database ended up as. Appendix D is where the later growth belongs, which is item 10.

14. **Page 8 (§2.1), page 30 (§5.1), page 31 (§5.6), and page 34 (Appendix B, Scope Out) — the
    statements that SMS and email reminders were deferred are correct and need no change.** They are
    listed here only because section 9 of this document marks the notification channels as
    implemented, which looks like a contradiction and is not one. What was deferred, and remains
    deferred, is the automated reminder sent ahead of a visit on a schedule. What exists is
    event-driven notification with the email and SMS channels wired to per-user preferences and the
    final delivery hop simulated. If any of those four passages is edited, keep the distinction; do
    not promote them to "implemented".

---

## Notes

- Where this document and the original report disagree on a fact, this document reflects the code as
  built and verified. Every SQL statement in section 8 was executed against the live database before
  being included, including against a date range with no appointments in it — that is the case that
  exposed the booked-hours error described under the Doctor Workload query.
- The two new sections (2.3 Physician Availability and Slot Generation, and 3.6 Cancellation and
  Attendance Data) shift the numbering of the sections that follow them within their chapters. The
  table of contents on pages 2–3 needs regenerating once they are merged. Section 3.7's table of
  contents entries also change: the six query subheadings become nine, since the availability, the
  approval, and the cancellation report queries are new.
- Section 10 lists Vercel as the deployment target, which is where the live demo runs. The repository
  also carries a Render blueprint and an AWS walkthrough as alternative deployment paths; neither is
  what the report should claim, and neither needs mentioning, but they exist if a reader asks.
