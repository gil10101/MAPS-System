/**
 * Patient self-registration.
 *
 * Name is collected as first and last, never as one string: the database stores
 * them apart and derives full_name from them, and reports sort people by last
 * name. Phone sits with the account rather than the demographics because it is
 * a reminder channel every role has, not a patient detail.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import {
  GENDER_OPTIONS, getToken, getUser, homeFor, register, setSession,
  type Gender, type RegisterBody,
} from '../lib/api';
import { Alert, Button, Card, Checkbox, Field, Input, Select } from '../components/ui';

interface FormState {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone: string;
  date_of_birth: string;
  gender: Gender | '';
  insurance_provider: string;
  address: string;
  notify_email: boolean;
  notify_sms: boolean;
}

/** Email on, SMS off — matches the column defaults, so an untouched form and a
    row created any other way agree about what this patient asked for. */
const EMPTY: FormState = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  date_of_birth: '',
  gender: '',
  insurance_provider: '',
  address: '',
  notify_email: true,
  notify_sms: false,
};

/** The marketing and auth pages render outside the app shell (see Landing). */
function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-white">
      Medi<span className="text-accent-500">Sync</span>
    </span>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (user && getToken()) navigate(homeFor(user), { replace: true });
  }, [navigate]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Blank optionals go out as undefined, which JSON.stringify drops: an
      // untouched field arrives absent rather than as an empty string the
      // server would have to tell apart from a deliberate erasure.
      const body: RegisterBody = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        date_of_birth: form.date_of_birth || undefined,
        gender: form.gender || undefined,
        insurance_provider: form.insurance_provider.trim() || undefined,
        address: form.address.trim() || undefined,
        notify_email: form.notify_email,
        notify_sms: form.notify_sms,
      };
      const data = await register(body);
      setSession(data.token, data.user);
      navigate(homeFor(data.user), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-900 px-4 py-10">
      <Link to="/" className="mb-6" aria-label="MediSync home">
        <Wordmark />
      </Link>

      <div className="w-full max-w-xl">
        <Card>
          <h1 className="text-center">Create your patient account</h1>
          <p className="mt-1 text-center text-sm text-slate-500">It only takes a minute.</p>

          {error && (
            <Alert tone="error" icon={AlertCircle} className="mt-5">
              {error}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-5">
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="First name" htmlFor="first_name" required>
                <Input
                  id="first_name"
                  autoComplete="given-name"
                  value={form.first_name}
                  onChange={(e) => set('first_name', e.target.value)}
                  required
                />
              </Field>
              <Field label="Last name" htmlFor="last_name" required>
                <Input
                  id="last_name"
                  autoComplete="family-name"
                  value={form.last_name}
                  onChange={(e) => set('last_name', e.target.value)}
                  required
                />
              </Field>

              <Field label="Email" htmlFor="email" required>
                <Input
                  type="email"
                  id="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                />
              </Field>
              <Field label="Password" htmlFor="password" required>
                <Input
                  type="password"
                  id="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  required
                />
              </Field>

              <Field label="Phone" htmlFor="phone" hint="Used for appointment reminders.">
                <Input
                  type="tel"
                  id="phone"
                  autoComplete="tel"
                  placeholder="e.g. 917-555-0100"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>
              <Field label="Date of birth" htmlFor="date_of_birth">
                <Input
                  type="date"
                  id="date_of_birth"
                  autoComplete="bday"
                  value={form.date_of_birth}
                  onChange={(e) => set('date_of_birth', e.target.value)}
                />
              </Field>

              <Field label="Gender" htmlFor="gender">
                <Select
                  id="gender"
                  value={form.gender}
                  onChange={(e) => set('gender', e.target.value as Gender | '')}
                >
                  <option value="">Not specified</option>
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Insurance provider" htmlFor="insurance_provider">
                <Input
                  id="insurance_provider"
                  placeholder="e.g. BlueCross"
                  value={form.insurance_provider}
                  onChange={(e) => set('insurance_provider', e.target.value)}
                />
              </Field>

              <Field label="Address" htmlFor="address" className="sm:col-span-2">
                <Input
                  id="address"
                  autoComplete="street-address"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                />
              </Field>
            </div>

            {/* A labelled group rather than fieldset/legend: a legend is laid
                out against the border box, so in a borderless padded panel it
                sits flush with the top edge instead of inside the padding. */}
            <div
              role="group"
              aria-labelledby="reminders-heading"
              className="mb-5 rounded-lg bg-slate-50 px-4 py-3"
            >
              <p id="reminders-heading" className="text-sm font-semibold text-slate-600">
                Reminders
              </p>
              <Checkbox
                label="Email reminders"
                checked={form.notify_email}
                onChange={(e) => set('notify_email', e.target.checked)}
              />
              <Checkbox
                label="Text message (SMS) reminders"
                checked={form.notify_sms}
                onChange={(e) => set('notify_sms', e.target.checked)}
              />
              <p className="mt-1 text-xs text-slate-500">
                Reminders are simulated in this prototype.
              </p>
            </div>

            <Button type="submit" id="submit" variant="primary" block loading={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-sm text-white/60">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-white hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
