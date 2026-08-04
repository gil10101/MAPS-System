/**
 * MediSync API client.
 *
 * Every network call the app makes is declared here, typed against the build
 * contract. Pages import these functions instead of writing `fetch` by hand —
 * one place knows the URL shapes, so a route rename is one edit rather than a
 * grep across twenty components.
 */

// ===========================================================================
// Domain types
// ===========================================================================

export type Role = 'patient' | 'doctor' | 'admin';

/**
 * A booking is a *request* until clinic staff approve it. One axis, no second
 * "did the patient confirm" flag:
 *
 *   pending → confirmed → completed | no_show
 *   pending | confirmed → cancelled
 */
export type ApptStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';

export type CancelledBy = 'patient' | 'practice' | 'unknown';

export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

export type RxStatus = 'active' | 'completed' | 'stopped';

export type RefillStatus = 'pending' | 'approved' | 'denied';

export type NotificationChannel = 'in_app' | 'email' | 'sms';

export type NotificationType =
  | 'appointment_requested'
  | 'appointment_approved'
  | 'appointment_cancelled'
  | 'appointment_rescheduled'
  | 'appointment_completed'
  | 'reschedule_required'
  | 'refill_approved'
  | 'refill_denied'
  | 'appointment_reminder';

/** Badge colouring, chosen from meaning rather than from a raw colour name. */
export type Tone = 'green' | 'amber' | 'red' | 'slate' | 'blue';

export interface User {
  id: number;
  email: string;
  role: Role;
  first_name: string;
  last_name: string;
  /** Generated column — display only. Never sent back to the server. */
  full_name: string;
  phone: string | null;
  notify_email: boolean;
  notify_sms: boolean;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
  /** Admin views only; the public list is filtered to active sites already. */
  active?: boolean;
}

export interface Specialty {
  id: number;
  name: string;
  description: string | null;
}

/** The sites a physician actually holds clinic at, derived from their schedule. */
export interface DoctorLocation {
  id: number;
  name: string;
  city: string;
}

export interface Doctor {
  id: number;
  prefix: string;
  first_name: string;
  last_name: string;
  full_name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  email: string | null;
  phone: string | null;
  bio: string | null;
  room: string | null;
  locations: DoctorLocation[];
  /** Admin directory extras. */
  active?: boolean;
  user_id?: number | null;
  login_email?: string | null;
}

/**
 * A bookable slot. The location rides along because a physician's Monday
 * clinic and Thursday clinic can be in different buildings — the patient has
 * to be told which one before they book, not after.
 */
export interface Slot {
  time: string; // 'HH:MM'
  location_id: number;
  location_name: string;
}

export interface Availability {
  date: string; // 'YYYY-MM-DD'
  slots: Slot[];
}

export interface Appointment {
  id: number;
  doctor_id: number;
  doctor_name: string;
  specialty_name: string | null;
  location_id: number | null;
  location_name: string | null;
  location_address?: string | null;
  appt_date: string; // 'YYYY-MM-DD'
  appt_time: string; // 'HH:MM'
  reason: string | null;
  status: ApptStatus;
  /** Set when an admin blocks the doctor over this slot; the booking stays
      live but the patient is asked to move it. */
  reschedule_required: boolean;
  cancel_reason: string | null;
  cancelled_by: CancelledBy | null;
  cancelled_at?: string | null;
  created_at: string;
  /** Staff views only. Visit notes are never returned to the patient. */
  notes?: string | null;
  patient_id?: number;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string | null;
  date_of_birth?: string | null;
  approved_at?: string | null;
  rescheduled_from_id?: number | null;
}

/** `GET /api/patients/me` — the user row and the patient row, flattened. */
export interface PatientProfile {
  user_id: number;
  patient_id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone: string | null;
  notify_email: boolean;
  notify_sms: boolean;
  date_of_birth: string | null;
  gender: Gender | null;
  address: string | null;
  insurance_provider: string | null;
}

export interface RefillRequest {
  id: number;
  prescription_id: number;
  patient_id: number;
  note: string | null;
  status: RefillStatus;
  decision_note: string | null;
  decided_by: number | null;
  decided_at: string | null;
  created_at: string;
  /** Physician queue extras — enough to decide without opening the chart. */
  medication?: string;
  dosage?: string;
  frequency?: string;
  refills_allowed?: number;
  refills_used?: number;
  prescription_status?: RxStatus;
  patient_name?: string;
  patient_email?: string;
}

export interface Prescription {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_id: number | null;
  medication: string;
  dosage: string;
  frequency: string;
  duration: string | null;
  instructions: string | null;
  refills_allowed: number;
  refills_used: number;
  status: RxStatus;
  stopped_reason: string | null;
  created_at: string;
  doctor_name?: string;
  /** Patient view: the request currently waiting on a physician, if any. */
  open_request?: RefillRequest | null;
  /** Patient view: the outcome of the most recent decided request. */
  last_decision?: { status: RefillStatus; decision_note: string | null } | null;
  /** Doctor chart view: requests waiting on this prescription. */
  pending_refills?: number;
}

export interface Notification {
  id: number;
  user_id: number;
  appointment_id: number | null;
  channel: NotificationChannel;
  type: NotificationType;
  title: string;
  body: string;
  status: 'queued' | 'sent' | 'failed';
  read_at: string | null;
  created_at: string;
}

/** A weekly recurring availability window at one site. weekday 0 = Sunday. */
export interface Schedule {
  id: number;
  doctor_id: number;
  location_id: number;
  location_name?: string;
  weekday: number;
  start_time: string; // 'HH:MM'
  end_time: string; // 'HH:MM'
  slot_minutes: number;
}

/** A date range the doctor is away, overriding the weekly pattern. */
export interface ScheduleBlock {
  id: number;
  doctor_id: number;
  start_date: string;
  end_date: string;
  reason: string | null;
  created_by: number | null;
  created_at: string;
}

/** A row in the physician's patient list. */
export interface CarePatient {
  patient_id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  phone: string | null;
  email: string;
  visit_count: number;
  last_visit: string | null;
  next_visit: string | null;
}

export interface ChartPatient {
  patient_id: number;
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  date_of_birth: string | null;
  gender: Gender | null;
  address: string | null;
  insurance_provider: string | null;
}

export interface ChartVisit {
  id: number;
  appt_date: string;
  appt_time: string;
  reason: string | null;
  status: ApptStatus;
  notes: string | null;
  location_name: string | null;
}

/** No history, no test results — the chart is visits plus medications. */
export interface Chart {
  patient: ChartPatient;
  visits: ChartVisit[];
  prescriptions: Prescription[];
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportMeta {
  from: string;
  to: string;
  generated_at: string;
}

/** Every report answers in the same envelope so one page shell renders all five. */
export interface Report<Row> {
  rows: Row[];
  meta: ReportMeta;
}

export interface DailyAppointmentRow {
  appt_time: string;
  patient_name: string;
  doctor_name: string;
  specialty_name: string | null;
  location_name: string | null;
  status: ApptStatus;
}

export interface WorkloadRow {
  doctor_name: string;
  specialty_name: string | null;
  appointments: number;
  booked_hours: number;
  utilization_pct: number;
}

/**
 * Outcome counts for a whole workload range, and the same counts broken down
 * by day. The per-row figures answer "who was busy"; these answer "how did the
 * period actually go", which is the question a physician opens the report for.
 */
export interface WorkloadTotals {
  patients: number;
  pending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
}

export interface WorkloadDay {
  date: string; // 'YYYY-MM-DD'
  completed: number;
  confirmed: number;
  cancelled: number;
  no_show: number;
}

/** The physician's own workload report: the shared envelope plus the rollups. */
export interface WorkloadReport extends Report<WorkloadRow> {
  totals: WorkloadTotals;
  by_day: WorkloadDay[];
}

export interface PatientVisitRow {
  appt_date: string;
  appt_time: string;
  doctor_name: string;
  specialty_name: string | null;
  location_name: string | null;
  status: ApptStatus;
  notes: string | null;
}

export interface CancellationRow {
  appt_date: string;
  appt_time: string;
  patient_name: string;
  doctor_name: string;
  status: ApptStatus;
  cancel_reason: string | null;
  cancelled_by: CancelledBy | null;
  cancelled_at: string | null;
}

export interface UtilizationRow {
  doctor_name: string;
  specialty_name: string | null;
  slots_available: number;
  slots_booked: number;
  utilization_pct: number;
  completed: number;
  cancelled: number;
  no_show: number;
}

/** Admin Overview tiles — a different shape from the five §3 reports. */
export interface Summary {
  appointments: {
    total: number;
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
    no_show: number;
  };
  cancellation_rate: number;
  /** Missed / (kept + missed) — a future booking cannot have been missed yet. */
  no_show_rate: number;
  total_patients: number;
  active_doctors: number;
}

export interface PhysicianUtilization {
  id: number;
  full_name: string;
  specialty_name: string | null;
  total_appointments: number;
  completed: number;
  cancelled: number;
  no_show: number;
  upcoming: number;
}

export interface SpecialtyVolume {
  specialty_name: string;
  total_appointments: number;
}

/**
 * Everything the admin physician detail screen shows about one doctor.
 *
 * `utilization_pct` and `booked_hours` are the same measures the utilization
 * report uses, computed against this physician's own schedule — a doctor who
 * holds one clinic a week and fills it is at 100%, not "quiet".
 */
export interface DoctorStats {
  total: number;
  pending: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
  /** Live bookings still in the future — the ones cancelling them would hit. */
  upcoming: number;
  /** Distinct patients seen, not appointment count. */
  patients: number;
  utilization_pct: number;
  booked_hours: number;
  /**
   * The window utilization was measured over. Sent so the figure can be
   * labelled with its own date range: a bare percentage invites the reader to
   * assume it covers all time, which it does not.
   */
  window_from?: string;
  window_to?: string;
}

/**
 * One line of the physician's audit trail. `kind` is deliberately a bare
 * string: the server owns that vocabulary and grows it (a new schedule event,
 * a new decision type), and a closed union here would turn every addition into
 * a client build failure for data the page only ever prints.
 */
export interface DoctorActivity {
  at: string; // ISO timestamp
  kind: string;
  summary: string;
}

export interface DoctorDetail {
  doctor: Doctor;
  stats: DoctorStats;
  recent_appointments: Appointment[];
  recent_activity: DoctorActivity[];
}

// ===========================================================================
// Display vocabulary
// ===========================================================================

/**
 * The same status reads differently either side of the desk. A patient is told
 * "Pending approval" because that names what they are waiting on; staff see
 * "Pending" because they are the ones it is waiting on. Storage values never
 * reach the screen.
 */
export const PATIENT_STATUS_LABEL: Record<ApptStatus, string> = {
  pending: 'Pending approval',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'Missed',
};

export const STAFF_STATUS_LABEL: Record<ApptStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: "Didn't attend",
};

export const STATUS_TONE: Record<ApptStatus, Tone> = {
  pending: 'amber',
  confirmed: 'green',
  completed: 'slate',
  cancelled: 'red',
  no_show: 'red',
};

/** Statuses a patient can still act on. */
export const OPEN_STATUSES: ApptStatus[] = ['pending', 'confirmed'];

export function isOpen(status: ApptStatus): boolean {
  return OPEN_STATUSES.includes(status);
}

/**
 * The moment a slot begins, in the reader's own timezone.
 *
 * Built from the parts rather than parsed as one string: `new Date('2026-07-20')`
 * is UTC midnight, which is the previous evening for anyone west of Greenwich,
 * and a gate that is a day out is worse than no gate.
 */
export function apptStart(appt_date: string, appt_time: string): Date {
  const [y, m, d] = appt_date.slice(0, 10).split('-').map(Number);
  const [hh, mm] = appt_time.split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

/**
 * Has the appointment come due?
 *
 * The server is the authority here — it refuses a completion or a no-show on a
 * slot that has not started yet, whatever the client believes the time is. This
 * exists so the UI can *say so first*: an action that will be rejected should
 * be visibly disabled with the reason, not offered and then refused. Hiding it
 * instead would leave the physician looking for a button that is not there.
 */
export function apptHasStarted(
  appt: { appt_date: string; appt_time: string },
  now: Date = new Date()
): boolean {
  return apptStart(appt.appt_date, appt.appt_time).getTime() <= now.getTime();
}

/**
 * Cancellation presets. "Other…" is appended by ReasonModal itself, so it is
 * absent here — listing it twice would render it twice.
 */
export const PATIENT_CANCEL_REASONS = [
  'Schedule conflict',
  'Feeling better / no longer needed',
  'Transport or access problem',
  'Cost or insurance concern',
  'Booking another time',
];

export const PRACTICE_CANCEL_REASONS = [
  'Provider unavailable',
  'Clinic closure',
  'Rescheduled at patient request',
  'Duplicate booking',
  'Booked in error',
];

export const NO_SHOW_REASONS = [
  'Did not attend, no contact',
  'Arrived too late to be seen',
  'Patient called after the fact',
];

/** Index = the `weekday` column's value (0 = Sunday, per the schema). */
export const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

export function roleLabel(role: Role): string {
  if (role === 'admin') return 'Administrator';
  if (role === 'doctor') return 'Physician';
  return 'Patient';
}

// ===========================================================================
// Session
// ===========================================================================

const TOKEN_KEY = 'medisync_token';
const USER_KEY = 'medisync_user';

export function setSession(token: string, user: User): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/** Refresh the cached user after a profile edit, keeping the token in place. */
export function updateCachedUser(patch: Partial<User>): void {
  const user = getUser();
  if (!user) return;
  localStorage.setItem(USER_KEY, JSON.stringify({ ...user, ...patch }));
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function logout(): void {
  clearSession();
  window.location.href = '/login';
}

/** Landing route for a role — each portal is a different application. */
export function homeFor(user: User | null): string {
  if (user?.role === 'admin') return '/admin';
  if (user?.role === 'doctor') return '/doctor';
  return '/app';
}

// ===========================================================================
// Fetch wrapper
// ===========================================================================

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Public endpoints pass false: a stale token must not bounce a visitor. */
  auth?: boolean;
}

export interface OkResponse {
  ok: boolean;
  message?: string;
}

export type QueryValue = string | number | boolean | null | undefined;

/**
 * Build a query string, dropping empties. Filter UIs bind '' to "no filter",
 * and `?status=` would otherwise reach the server as a real value.
 *
 * Generic rather than `Record<string, QueryValue>` so the declared filter
 * interfaces below can be passed straight in: an interface has no index
 * signature, so it is not assignable to a Record.
 */
export function qs<T extends object>(params: T = {} as T): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params) as [string, QueryValue][]) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

export async function api<T>(pathname: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* Some responses (and every network error page) carry no JSON body. */
  }

  if (res.status === 401 && auth) {
    // The token is gone or expired. Drop it and send them back to sign in.
    clearSession();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status}).`);
  }
  return data as T;
}

// ===========================================================================
// §2.1  /api/auth
// ===========================================================================

export interface AuthResponse {
  token: string;
  user: User;
}

export interface RegisterBody {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string;
  date_of_birth?: string;
  gender?: Gender | '';
  address?: string;
  insurance_provider?: string;
  notify_email?: boolean;
  notify_sms?: boolean;
}

export function register(body: RegisterBody): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/register', { method: 'POST', body, auth: false });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return api<AuthResponse>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
}

export function fetchMe(): Promise<{ user: User }> {
  return api<{ user: User }>('/auth/me');
}

// ===========================================================================
// §2.2  /api/locations  (public)
// ===========================================================================

export function listLocations(): Promise<{ locations: Location[] }> {
  return api<{ locations: Location[] }>('/locations', { auth: false });
}

// ===========================================================================
// §2.3  /api/doctors  (public directory)
// ===========================================================================

export interface DoctorFilters {
  q?: string;
  specialty?: number | string;
  location?: number | string;
}

export function listDoctors(filters: DoctorFilters = {}): Promise<{ doctors: Doctor[] }> {
  return api<{ doctors: Doctor[] }>(`/doctors${qs(filters)}`, { auth: false });
}

export function listSpecialties(): Promise<{ specialties: Specialty[] }> {
  return api<{ specialties: Specialty[] }>('/doctors/specialties', { auth: false });
}

export function getDoctor(id: number | string): Promise<{ doctor: Doctor }> {
  return api<{ doctor: Doctor }>(`/doctors/${id}`, { auth: false });
}

/** Slots already have blocked dates and taken times removed by the server. */
export function getAvailability(id: number | string, date: string): Promise<Availability> {
  return api<Availability>(`/doctors/${id}/availability${qs({ date })}`, { auth: false });
}

// ===========================================================================
// §2.4  /api/appointments  (the signed-in patient's own)
// ===========================================================================

export function listMyAppointments(): Promise<{ appointments: Appointment[] }> {
  return api<{ appointments: Appointment[] }>('/appointments');
}

export function getMyAppointment(id: number | string): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/appointments/${id}`);
}

export interface BookBody {
  doctor_id: number;
  appt_date: string;
  appt_time: string;
  reason?: string;
}

/**
 * Creates a `pending` request, not a confirmed visit. A 409 means someone else
 * took the slot between the availability call and this one — surface the
 * server's message and re-fetch availability rather than retrying blind.
 */
export function bookAppointment(body: BookBody): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>('/appointments', { method: 'POST', body });
}

/** Returns the NEW appointment: rescheduling supersedes rather than mutates. */
export function rescheduleAppointment(
  id: number | string,
  appt_date: string,
  appt_time: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/appointments/${id}/reschedule`, {
    method: 'PATCH',
    body: { appt_date, appt_time },
  });
}

export function cancelAppointment(
  id: number | string,
  cancel_reason: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/appointments/${id}/cancel`, {
    method: 'PATCH',
    body: { cancel_reason },
  });
}

// ===========================================================================
// §2.5  /api/patients  (self only)
// ===========================================================================

export function fetchMyProfile(): Promise<{ profile: PatientProfile }> {
  return api<{ profile: PatientProfile }>('/patients/me');
}

export interface ProfileBody {
  first_name: string;
  last_name: string;
  phone: string | null;
  date_of_birth: string | null;
  gender: Gender | '' | null;
  address: string | null;
  insurance_provider: string | null;
  notify_email: boolean;
  notify_sms: boolean;
}

export function updateMyProfile(body: ProfileBody): Promise<{ profile: PatientProfile }> {
  return api<{ profile: PatientProfile }>('/patients/me', { method: 'PUT', body });
}

export function listMyPrescriptions(): Promise<{ prescriptions: Prescription[] }> {
  return api<{ prescriptions: Prescription[] }>('/patients/me/prescriptions');
}

/** 409 when a request is already open — the same ask twice is still one ask. */
export function requestRefill(
  prescriptionId: number | string,
  note?: string
): Promise<{ request: RefillRequest }> {
  return api<{ request: RefillRequest }>(
    `/patients/me/prescriptions/${prescriptionId}/refill-request`,
    { method: 'POST', body: { note } }
  );
}

// ===========================================================================
// §2.6  /api/notifications  (any signed-in role)
// ===========================================================================

export interface NotificationList {
  notifications: Notification[];
  unread_count: number;
}

export function listNotifications(unreadOnly = false): Promise<NotificationList> {
  return api<NotificationList>(`/notifications${qs({ unread_only: unreadOnly || undefined })}`);
}

export function markNotificationRead(id: number | string): Promise<{ notification: Notification }> {
  return api<{ notification: Notification }>(`/notifications/${id}/read`, { method: 'PATCH' });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return api<{ updated: number }>('/notifications/read-all', { method: 'POST' });
}

// ===========================================================================
// §2.7  /api/doctor  (physician portal)
// ===========================================================================

export function fetchDoctorMe(): Promise<{ doctor: Doctor }> {
  return api<{ doctor: Doctor }>('/doctor/me');
}

export interface DoctorApptFilters {
  date?: string;
  from?: string;
  to?: string;
}

export function listDoctorAppointments(
  filters: DoctorApptFilters = {}
): Promise<{ appointments: Appointment[] }> {
  return api<{ appointments: Appointment[] }>(`/doctor/appointments${qs(filters)}`);
}

/** Notes are required: "completed" with no record of the visit is not a record. */
export function completeAppointment(
  id: number | string,
  notes: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/doctor/appointments/${id}/complete`, {
    method: 'PATCH',
    body: { notes },
  });
}

/**
 * Record that the patient never arrived. The physician's half of the pair with
 * completeAppointment, and gated the same way: the server refuses both until
 * the slot's start time has passed, because a visit cannot have been missed
 * before it was due. `reason` is required — "didn't attend" with no account of
 * it is the row a practice can do nothing with.
 */
export function markAppointmentNoShow(
  id: number | string,
  reason: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/doctor/appointments/${id}/no-show`, {
    method: 'PATCH',
    body: { reason },
  });
}

export function saveVisitNote(
  id: number | string,
  notes: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/doctor/appointments/${id}/note`, {
    method: 'PATCH',
    body: { notes },
  });
}

export function listDoctorPatients(): Promise<{ patients: CarePatient[] }> {
  return api<{ patients: CarePatient[] }>('/doctor/patients');
}

export interface PatientSearchFilters {
  q?: string;
  limit?: number;
  offset?: number;
}

/**
 * Paged search across the physician's own patient list.
 *
 * `total` is the size of the whole match, not of this page: a pager cannot say
 * "31–40 of 214" from the rows it was handed, and a list that only knows
 * whether another page exists can never show a reader where they are.
 */
export interface PatientSearchResult {
  patients: CarePatient[];
  total: number;
  limit: number;
  offset: number;
}

export function searchDoctorPatients(
  filters: PatientSearchFilters = {}
): Promise<PatientSearchResult> {
  return api<PatientSearchResult>(`/doctor/patients/search${qs(filters)}`);
}

export function fetchPatientChart(patientId: number | string): Promise<Chart> {
  return api<Chart>(`/doctor/patients/${patientId}/chart`);
}

export interface PrescriptionBody {
  medication: string;
  dosage: string;
  frequency: string;
  duration?: string;
  instructions?: string;
  refills_allowed?: number;
}

export function createPrescription(
  patientId: number | string,
  body: PrescriptionBody
): Promise<{ prescription: Prescription }> {
  return api<{ prescription: Prescription }>(`/doctor/patients/${patientId}/prescriptions`, {
    method: 'POST',
    body,
  });
}

export function stopPrescription(
  id: number | string,
  stopped_reason: string
): Promise<{ prescription: Prescription }> {
  return api<{ prescription: Prescription }>(`/doctor/prescriptions/${id}/stop`, {
    method: 'PATCH',
    body: { stopped_reason },
  });
}

export function listRefillRequests(
  status: RefillStatus | '' = 'pending'
): Promise<{ requests: RefillRequest[] }> {
  return api<{ requests: RefillRequest[] }>(`/doctor/refill-requests${qs({ status })}`);
}

/** Denials must say why — the patient is told to book a follow-up instead. */
export function decideRefillRequest(
  id: number | string,
  status: 'approved' | 'denied',
  decision_note?: string
): Promise<{ request: RefillRequest }> {
  return api<{ request: RefillRequest }>(`/doctor/refill-requests/${id}`, {
    method: 'PATCH',
    body: { status, decision_note },
  });
}

// --- Doctor reports (§3, scoped to the signed-in physician) -----------------

export function doctorDailyAppointmentsReport(date: string): Promise<Report<DailyAppointmentRow>> {
  return api<Report<DailyAppointmentRow>>(`/doctor/reports/daily-appointments${qs({ date })}`);
}

/** Same `{ rows, meta }` envelope as every other report, plus §4 rollups. */
export function doctorWorkloadReport(from: string, to: string): Promise<WorkloadReport> {
  return api<WorkloadReport>(`/doctor/reports/workload${qs({ from, to })}`);
}

/** Patient visit history is exposed in the doctor portal only, own patients only. */
export function doctorPatientVisitsReport(
  patient_id: number | string,
  from: string,
  to: string
): Promise<Report<PatientVisitRow>> {
  return api<Report<PatientVisitRow>>(
    `/doctor/reports/patient-visits${qs({ patient_id, from, to })}`
  );
}

// ===========================================================================
// §2.8  /api/admin
// ===========================================================================

export function adminListDoctors(): Promise<{ doctors: Doctor[] }> {
  return api<{ doctors: Doctor[] }>('/admin/doctors');
}

/**
 * One physician, assembled: the directory entry, their figures, the last of
 * their book, and their audit trail. A single call rather than four because
 * the screen is useless until all of it has arrived, and four requests would
 * only give the reader four chances to see a half-drawn page.
 */
export function adminDoctorDetail(id: number | string): Promise<DoctorDetail> {
  return api<DoctorDetail>(`/admin/doctors/${id}/detail`);
}

export interface DoctorBody {
  prefix: string;
  first_name: string;
  last_name: string;
  specialty_id: number | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  room?: string | null;
  active?: boolean;
}

export function adminCreateDoctor(body: DoctorBody): Promise<{ doctor: Doctor }> {
  return api<{ doctor: Doctor }>('/admin/doctors', { method: 'POST', body });
}

export function adminUpdateDoctor(
  id: number | string,
  body: DoctorBody
): Promise<{ doctor: Doctor }> {
  return api<{ doctor: Doctor }>(`/admin/doctors/${id}`, { method: 'PUT', body });
}

/** Soft delete: the physician stops accepting bookings, their history stays. */
export function adminDeactivateDoctor(id: number | string): Promise<OkResponse> {
  return api<OkResponse>(`/admin/doctors/${id}`, { method: 'DELETE' });
}

/**
 * Provisions the portal login for a directory entry that has none yet.
 * Answers with the address that was actually stored — it is lowercased on the
 * way in, so echoing it back is what tells the admin what to read out.
 */
export function adminCreateDoctorAccount(
  id: number | string,
  email: string,
  password: string
): Promise<OkResponse & { login_email: string }> {
  return api<OkResponse & { login_email: string }>(`/admin/doctors/${id}/account`, {
    method: 'POST',
    body: { email, password },
  });
}

export function adminListSpecialties(): Promise<{ specialties: Specialty[] }> {
  return api<{ specialties: Specialty[] }>('/admin/specialties');
}

export function adminCreateSpecialty(
  name: string,
  description?: string
): Promise<{ specialty: Specialty }> {
  return api<{ specialty: Specialty }>('/admin/specialties', {
    method: 'POST',
    body: { name, description },
  });
}

export interface AdminApptFilters {
  status?: ApptStatus | '';
  doctor_id?: number | string;
  location_id?: number | string;
  date?: string;
  from?: string;
  to?: string;
}

export function adminListAppointments(
  filters: AdminApptFilters = {}
): Promise<{ appointments: Appointment[] }> {
  return api<{ appointments: Appointment[] }>(`/admin/appointments${qs(filters)}`);
}

/**
 * The single lever staff have over an appointment. `confirmed` is the approval
 * of a pending request; `cancelled` and `no_show` want a reason, which the
 * cancellation report then has something to group by.
 */
export function adminSetAppointmentStatus(
  id: number | string,
  status: ApptStatus,
  reason?: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/admin/appointments/${id}/status`, {
    method: 'PATCH',
    body: { status, reason },
  });
}

export function adminSaveAppointmentNote(
  id: number | string,
  notes: string
): Promise<{ appointment: Appointment }> {
  return api<{ appointment: Appointment }>(`/admin/appointments/${id}/note`, {
    method: 'PATCH',
    body: { notes },
  });
}

// --- Schedules & blocks (A3) ------------------------------------------------

export function adminListSchedules(doctorId: number | string): Promise<{ schedules: Schedule[] }> {
  return api<{ schedules: Schedule[] }>(`/admin/doctors/${doctorId}/schedules`);
}

export interface ScheduleBody {
  location_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number;
}

/** 409 when the window overlaps one the doctor already holds that weekday. */
export function adminCreateSchedule(
  doctorId: number | string,
  body: ScheduleBody
): Promise<{ schedule: Schedule }> {
  return api<{ schedule: Schedule }>(`/admin/doctors/${doctorId}/schedules`, {
    method: 'POST',
    body,
  });
}

/**
 * How many live appointments sit inside a recurring window, asked before it is
 * deleted. Removing a Thursday clinic is not an edit to a row, it is a decision
 * about the people already booked into it — so the count is available to put in
 * front of the admin while the choice is still theirs to make.
 */
export function adminScheduleImpact(
  scheduleId: number | string
): Promise<{ affected: number }> {
  return api<{ affected: number }>(`/admin/schedules/${scheduleId}/impact`);
}

/** Answers with the same `affected` count, now as a record of what it did. */
export function adminDeleteSchedule(
  scheduleId: number | string
): Promise<OkResponse & { affected: number }> {
  return api<OkResponse & { affected: number }>(`/admin/schedules/${scheduleId}`, {
    method: 'DELETE',
  });
}

export function adminListBlocks(doctorId: number | string): Promise<{ blocks: ScheduleBlock[] }> {
  return api<{ blocks: ScheduleBlock[] }>(`/admin/doctors/${doctorId}/blocks`);
}

export interface BlockBody {
  start_date: string;
  end_date: string;
  reason?: string;
}

/**
 * `affected` is how many live appointments were flagged for rescheduling —
 * show it, because blocking a week of clinic is not a silent operation.
 */
export function adminCreateBlock(
  doctorId: number | string,
  body: BlockBody
): Promise<{ block: ScheduleBlock; affected: number }> {
  return api<{ block: ScheduleBlock; affected: number }>(
    `/admin/doctors/${doctorId}/blocks`,
    { method: 'POST', body }
  );
}

export function adminDeleteBlock(blockId: number | string): Promise<OkResponse> {
  return api<OkResponse>(`/admin/blocks/${blockId}`, { method: 'DELETE' });
}

// --- Locations (A6) ---------------------------------------------------------

export function adminListLocations(): Promise<{ locations: Location[] }> {
  return api<{ locations: Location[] }>('/admin/locations');
}

export interface LocationBody {
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone?: string | null;
  active?: boolean;
}

export function adminCreateLocation(body: LocationBody): Promise<{ location: Location }> {
  return api<{ location: Location }>('/admin/locations', { method: 'POST', body });
}

export function adminUpdateLocation(
  id: number | string,
  body: LocationBody
): Promise<{ location: Location }> {
  return api<{ location: Location }>(`/admin/locations/${id}`, { method: 'PUT', body });
}

// --- Overview tiles ---------------------------------------------------------

export function adminSummary(): Promise<Summary> {
  return api<Summary>('/admin/reports/summary');
}

export function adminPhysicianUtilization(): Promise<{ doctors: PhysicianUtilization[] }> {
  return api<{ doctors: PhysicianUtilization[] }>('/admin/reports/physician-utilization');
}

export function adminVolumeBySpecialty(): Promise<{ specialties: SpecialtyVolume[] }> {
  return api<{ specialties: SpecialtyVolume[] }>('/admin/reports/volume-by-specialty');
}

// --- The five §3 reports ----------------------------------------------------

export function reportDailyAppointments(date: string): Promise<Report<DailyAppointmentRow>> {
  return api<Report<DailyAppointmentRow>>(`/admin/reports/daily-appointments${qs({ date })}`);
}

export function reportWorkload(from: string, to: string): Promise<Report<WorkloadRow>> {
  return api<Report<WorkloadRow>>(`/admin/reports/workload${qs({ from, to })}`);
}

export function reportPatientVisits(
  patient_id: number | string,
  from: string,
  to: string
): Promise<Report<PatientVisitRow>> {
  return api<Report<PatientVisitRow>>(
    `/admin/reports/patient-visits${qs({ patient_id, from, to })}`
  );
}

export function reportCancellations(from: string, to: string): Promise<Report<CancellationRow>> {
  return api<Report<CancellationRow>>(`/admin/reports/cancellations${qs({ from, to })}`);
}

export function reportUtilization(from: string, to: string): Promise<Report<UtilizationRow>> {
  return api<Report<UtilizationRow>>(`/admin/reports/utilization${qs({ from, to })}`);
}

// ===========================================================================
// Formatting helpers
// ===========================================================================

/**
 * 'YYYY-MM-DD' -> 'Mon, Jul 20, 2026'.
 * Parsed at noon: `new Date('2026-07-20')` is UTC midnight, which is the
 * previous day for anyone west of Greenwich.
 */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** 'YYYY-MM-DD' -> 'Jul 20' — for dense table columns. */
export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** ISO timestamp -> 'Jul 16, 2026'. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 'HH:MM' 24h -> '9:30 AM'. */
export function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${ampm}`;
}

/**
 * ISO timestamp -> 'just now' / '4m' / '3h' / '2d' / 'Jul 16'.
 * Notification trays are scanned, not read: an exact timestamp costs more
 * attention than it returns.
 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return formatStamp(iso);
}

/**
 * First letters of the first two words: 'Sarah Kim' -> 'SK'.
 * The honorific is skipped, so 'Dr. Sarah Kim' is 'SK' and not 'DS'.
 */
export function initials(name: string | null | undefined): string {
  return (name || '')
    .split(/\s+/)
    .filter((w) => w && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Today as 'YYYY-MM-DD' in local time — never the UTC date. */
export function todayStr(): string {
  return dateToStr(new Date());
}

export function dateToStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Default report window: the calendar month containing `ref`. */
export function monthRange(ref: Date = new Date()): { from: string; to: string } {
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { from: dateToStr(from), to: dateToStr(to) };
}

/** 'YYYY-MM-DD' + n days, as 'YYYY-MM-DD'. */
export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}
