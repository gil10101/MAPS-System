import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, getToken, getUser, homeFor, setSession, type User } from '../lib/api';

interface RegisterResponse {
  token: string;
  user: User;
}

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    password: '',
    date_of_birth: '',
    phone: '',
    gender: '',
    insurance_provider: '',
    address: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const user = getUser();
    if (user && getToken()) navigate(homeFor(user), { replace: true });
  }, [navigate]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const data = await api<RegisterResponse>('/auth/register', {
        method: 'POST',
        auth: false,
        body: {
          full_name: form.full_name.trim(),
          email: form.email.trim(),
          password: form.password,
          date_of_birth: form.date_of_birth || null,
          phone: form.phone.trim() || null,
          gender: form.gender || null,
          insurance_provider: form.insurance_provider.trim() || null,
          address: form.address.trim() || null,
        },
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
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <div className="auth-logo">
          <Link className="brand" to="/">
            MAP<b>S</b>
          </Link>
        </div>
        <div className="card">
          <h1 className="center">Create your patient account</h1>
          <p className="center muted small">It only takes a minute.</p>

          {error && <div className="alert error">{error}</div>}

          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="full_name">Full name *</label>
              <input
                className="input"
                id="full_name"
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
                required
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="email">Email *</label>
                <input
                  className="input"
                  type="email"
                  id="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password *</label>
                <input
                  className="input"
                  type="password"
                  id="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="date_of_birth">Date of birth</label>
                <input
                  className="input"
                  type="date"
                  id="date_of_birth"
                  value={form.date_of_birth}
                  onChange={(e) => set('date_of_birth', e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input
                  className="input"
                  type="tel"
                  id="phone"
                  placeholder="e.g. 917-555-0100"
                  value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="gender">Gender</label>
                <select id="gender" value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="insurance_provider">Insurance provider</label>
                <input
                  className="input"
                  id="insurance_provider"
                  placeholder="e.g. BlueCross"
                  value={form.insurance_provider}
                  onChange={(e) => set('insurance_provider', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="address">Address</label>
              <input
                className="input"
                id="address"
                value={form.address}
                onChange={(e) => set('address', e.target.value)}
              />
            </div>
            <button className="btn block" type="submit" id="submit" disabled={busy}>
              {busy ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <p className="center small" style={{ marginTop: 20 }}>
            Already have an account? <Link to="/login">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
