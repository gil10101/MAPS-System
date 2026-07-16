import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getToken, getUser, homeFor, setSession, type User } from '../lib/api';

interface LoginResponse {
  token: string;
  user: User;
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
      const data = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: email.trim(), password },
      });
      setSession(data.token, data.user);
      navigate(homeFor(data.user), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">
          <Link className="brand" to="/">
            MAP<b>S</b>
          </Link>
        </div>
        <div className="card">
          <h1 className="center">Welcome back</h1>
          <p className="center muted small">Log in to manage your appointments.</p>

          {error && <div className="alert error">{error}</div>}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                className="input"
                type="email"
                id="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                className="input"
                type="password"
                id="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button className="btn block" type="submit" id="submit" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p className="center small" style={{ marginTop: 20 }}>
            New patient? <Link to="/register">Create an account</Link>
          </p>

          <div className="alert info small" style={{ marginTop: 16, marginBottom: 0 }}>
            <strong>Demo logins</strong>
            <br />
            Patient: <code>jdoe@example.com</code> / <code>patient123</code>
            <br />
            Doctor: <code>mreid@maps.health</code> / <code>doctor123</code>
            <br />
            Admin: <code>admin@maps.health</code> / <code>admin123</code>
          </div>
        </div>
      </div>
    </div>
  );
}
