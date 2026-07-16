/**
 * API client + session storage + shared types and formatting helpers.
 */

// ---------- Types ----------------------------------------------------------

export type Role = 'patient' | 'admin' | 'doctor';

/**
 * Where the visit sits in its lifecycle. There is no "pending": a booking is
 * live the moment it's made, so nothing waits on staff approval.
 */
export type ApptStatus = 'booked' | 'completed' | 'cancelled' | 'no_show';

/** Whether the PATIENT has acknowledged the appointment. Independent of status. */
export type ConfirmationStatus = 'unconfirmed' | 'confirmed' | 'cancel_requested';

export type CancelledBy = 'patient' | 'practice' | 'unknown';

/**
 * Display text. The DB enum is storage, not user-facing copy — "Didn't attend"
 * tells someone what happened; "no_show" is a column value that leaked.
 */
export const STATUS_LABEL: Record<ApptStatus, string> = {
  booked: 'Booked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: "Didn't attend",
};

export const CONFIRMATION_LABEL: Record<ConfirmationStatus, string> = {
  unconfirmed: 'Not confirmed',
  confirmed: 'Confirmed by patient',
  cancel_requested: 'Cancellation requested',
};

/** Preset cancellation reasons; the clinic's are distinct from the patient's. */
export const PRACTICE_CANCEL_REASONS = [
  'Provider unavailable',
  'Clinic closure',
  'Rescheduled at patient request',
  'Duplicate booking',
  'Booked in error',
];

export const PATIENT_CANCEL_REASONS = [
  'Schedule conflict',
  'Feeling better / no longer needed',
  'Transport or access problem',
  'Cost or insurance concern',
  'Booking another time',
];

export const NO_SHOW_REASONS = [
  'Did not attend, no contact',
  'Arrived too late to be seen',
  'Patient called after the fact',
];

export interface User {
  id: number;
  email: string;
  role: Role;
  full_name: string;
}

export interface Specialty {
  id: number;
  name: string;
  description: string | null;
}

export interface Doctor {
  id: number;
  full_name: string;
  specialty_id: number | null;
  specialty_name: string | null;
  email?: string | null;
  phone?: string | null;
  bio?: string | null;
  room?: string | null;
  active?: boolean;
  /** Portal login linkage (admin view). */
  user_id?: number | null;
  login_email?: string | null;
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  appt_date: string; // 'YYYY-MM-DD'
  appt_time: string; // 'HH:MM'
  reason: string | null;
  status: ApptStatus;
  confirmation_status: ConfirmationStatus;
  confirmed_at: string | null;
  cancel_reason: string | null;
  cancelled_by: CancelledBy | null;
  cancelled_at: string | null;
  /** Clinical visit note. Absent from admin endpoints (no need-to-know). */
  notes?: string | null;
  doctor_name?: string;
  doctor_room?: string | null;
  specialty_name?: string | null;
  patient_name?: string;
  patient_email?: string;
  patient_phone?: string | null;
  date_of_birth?: string | null;
}

// ---------- Clinical records ----------

export type HistoryKind =
  | 'condition' | 'allergy' | 'surgery' | 'immunization' | 'family' | 'other';

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  condition: 'Condition',
  allergy: 'Allergy',
  surgery: 'Surgery',
  immunization: 'Immunization',
  family: 'Family history',
  other: 'Other',
};

export interface HistoryEntry {
  id: number;
  patient_id: number;
  kind: HistoryKind;
  description: string;
  severity: 'mild' | 'moderate' | 'severe' | null;
  noted_on: string | null;
  status: 'active' | 'resolved';
  /** Self-reported entries carry different clinical weight than diagnoses. */
  source: 'patient' | 'doctor';
  recorded_by_name?: string | null;
  created_at: string;
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
  status: 'active' | 'completed' | 'stopped';
  stopped_reason: string | null;
  created_at: string;
  doctor_name?: string;
  /** Patient view: the open request on this prescription, if any. */
  open_request_id?: number | null;
  last_request_status?: 'approved' | 'denied' | null;
  last_request_note?: string | null;
  /** Doctor chart view: count of requests waiting on this prescription. */
  pending_refills?: number;
}

export interface RefillRequest {
  id: number;
  prescription_id: number;
  patient_id: number;
  note: string | null;
  status: 'pending' | 'approved' | 'denied';
  decision_note: string | null;
  created_at: string;
  medication?: string;
  dosage?: string;
  frequency?: string;
  refills_allowed?: number;
  refills_used?: number;
  prescription_status?: string;
  patient_name?: string;
  patient_email?: string;
}

export interface TestResult {
  id: number;
  patient_id: number;
  doctor_id: number;
  appointment_id: number | null;
  test_name: string;
  status: 'ordered' | 'completed';
  result_summary: string | null;
  result_flag: 'normal' | 'abnormal' | 'critical' | null;
  ordered_at: string;
  resulted_at: string | null;
  doctor_name?: string;
}

/** A patient row in the doctor's care list. */
export interface CarePatient {
  id: number;
  full_name: string;
  email: string;
  date_of_birth: string | null;
  phone: string | null;
  next_visit: string | null;
  last_visit: string | null;
  visit_count: number;
}

export interface ChartVisit {
  id: number;
  appt_date: string;
  appt_time: string;
  reason: string | null;
  status: ApptStatus;
  notes: string | null;
  doctor_name: string;
  specialty_name: string | null;
}

export interface Chart {
  profile: {
    patient_id: number;
    full_name: string;
    email: string;
    date_of_birth: string | null;
    phone: string | null;
    gender: string | null;
    address: string | null;
    insurance_provider: string | null;
  };
  history: HistoryEntry[];
  prescriptions: Prescription[];
  results: TestResult[];
  visits: ChartVisit[];
}

export interface Profile {
  user_id: number;
  email: string;
  full_name: string;
  patient_id: number;
  date_of_birth: string | null;
  phone: string | null;
  gender: string | null;
  address: string | null;
  insurance_provider: string | null;
}

export interface Summary {
  appointments: {
    total: number;
    booked: number;
    completed: number;
    cancelled: number;
    no_show: number;
    unconfirmed: number;
  };
  cancellation_rate: number;
  /** Missed / (kept + missed) — future bookings can't have been missed yet. */
  no_show_rate: number;
  total_patients: number;
  active_doctors: number;
}

export interface Utilization {
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

// ---------- Session --------------------------------------------------------

const TOKEN_KEY = 'maps_token';
const USER_KEY = 'maps_user';

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

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function logout(): void {
  clearSession();
  window.location.href = '/login';
}

/** Home route for a user's role. */
export function homeFor(user: User | null): string {
  if (user?.role === 'admin') return '/admin';
  if (user?.role === 'doctor') return '/doctor';
  return '/app';
}

// ---------- Fetch wrapper ---------------------------------------------------

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
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
    /* no body */
  }

  if (res.status === 401 && auth) {
    // Session expired/invalid — bounce to login.
    clearSession();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
  }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    throw new Error(message);
  }
  return data as T;
}

// ---------- Formatting helpers ----------------------------------------------

/** 'YYYY-MM-DD' -> 'Mon, Jul 20, 2026' */
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** ISO timestamp -> 'Jul 16, 2026' (results, request dates). */
export function formatStamp(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** 'HH:MM' 24h -> '9:30 AM' */
export function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** First letters of the first two words: 'Sarah Chen' -> 'SC'.
    Honorifics are skipped: 'Dr. Marcus Reid' -> 'MR', not 'DM'. */
export function initials(name: string | null | undefined): string {
  return (name || '')
    .split(/\s+/)
    .filter((w) => w && !/^dr\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/** Today's date as 'YYYY-MM-DD' in local time. */
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}
