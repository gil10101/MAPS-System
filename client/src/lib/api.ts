/**
 * API client + session storage + shared types and formatting helpers.
 */

// ---------- Types ----------------------------------------------------------

export type Role = 'patient' | 'admin';
export type ApptStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

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
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  appt_date: string; // 'YYYY-MM-DD'
  appt_time: string; // 'HH:MM'
  reason: string | null;
  status: ApptStatus;
  notes: string | null;
  doctor_name: string;
  doctor_room?: string | null;
  specialty_name: string | null;
  patient_name?: string;
  patient_email?: string;
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
    pending: number;
    confirmed: number;
    completed: number;
    cancelled: number;
  };
  cancellation_rate: number;
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
  return user && user.role === 'admin' ? '/admin' : '/app';
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

/** 'HH:MM' 24h -> '9:30 AM' */
export function formatTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 || 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** First letters of the first two words: 'Sarah Chen' -> 'SC' */
export function initials(name: string | null): string {
  return (name || '')
    .split(/\s+/)
    .filter(Boolean)
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
