/**
 * Sign in. Every role uses this one form — the server decides what the account
 * is, and homeFor() sends it to the matching portal.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { getToken, getUser, homeFor, login, setSession } from '../lib/api';
import { Alert, Button, Card, Field, Input } from '../components/ui';

/**
 * Seeded accounts (contract §6). This block is the demo's front door, so it has
 * to stay in step with src/db/seed.js — a stale password here reads as a broken
 * application.
 */
const DEMO_LOGINS = [
  { role: 'Patient', email: 'jdoe@example.com', password: 'patient123' },
  { role: 'Doctor', email: 'skim@medisync.health', password: 'doctor123' },
  { role: 'Admin', email: 'admin@medisync.health', password: 'admin123' },
];

/** The marketing and auth pages render outside the app shell (see Landing). */
function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-white">
      Medi<span className="text-accent-500">Sync</span>
    </span>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (user && getToken()) navigate(homeFor(user), { replace: true });
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await login(email.trim(), password);
      setSession(data.token, data.user);
      navigate(homeFor(data.user), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      // Only released on failure: a success navigates away, and re-enabling the
      // button first invites a second submit against a slow transition.
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-navy-900 px-4 py-10">
      <Link to="/" className="mb-6" aria-label="MediSync home">
        <Wordmark />
      </Link>

      <div className="w-full max-w-md">
        <Card>
          <h1 className="text-center">Welcome back</h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            Log in to manage your appointments.
          </p>

          {error && (
            <Alert tone="error" icon={AlertCircle} className="mt-5">
              {error}
            </Alert>
          )}

          <form onSubmit={onSubmit} className="mt-5">
            <Field label="Email" htmlFor="email" required>
              <Input
                type="email"
                id="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field label="Password" htmlFor="password" required>
              <Input
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" id="submit" variant="primary" block loading={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </form>

          <Alert tone="info" title="Demo logins" className="mt-6">
            <ul className="mt-1 space-y-1">
              {DEMO_LOGINS.map((d) => (
                <li key={d.role}>
                  {d.role}:{' '}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">{d.email}</code>{' '}
                  /{' '}
                  <code className="rounded bg-white px-1 py-0.5 font-mono text-xs">
                    {d.password}
                  </code>
                </li>
              ))}
            </ul>
          </Alert>
        </Card>

        <p className="mt-5 text-center text-sm text-white/60">
          New patient?{' '}
          <Link to="/register" className="font-semibold text-white hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
