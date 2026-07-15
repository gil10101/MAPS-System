import { useEffect, useState, type FormEvent } from 'react';
import { api, getToken, getUser, setSession, type Profile as ProfileT } from '../../lib/api';
import { Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function Profile() {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    date_of_birth: '',
    phone: '',
    gender: '',
    insurance_provider: '',
    address: '',
  });

  useEffect(() => {
    api<{ profile: ProfileT }>('/patients/me')
      .then(({ profile }) => {
        setForm({
          full_name: profile.full_name || '',
          email: profile.email || '',
          date_of_birth: profile.date_of_birth || '',
          phone: profile.phone || '',
          gender: profile.gender || '',
          insurance_provider: profile.insurance_provider || '',
          address: profile.address || '',
        });
        setLoaded(true);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const { profile } = await api<{ profile: ProfileT }>('/patients/me', {
        method: 'PUT',
        body: {
          full_name: form.full_name.trim(),
          date_of_birth: form.date_of_birth || null,
          phone: form.phone.trim() || null,
          gender: form.gender || null,
          insurance_provider: form.insurance_provider.trim() || null,
          address: form.address.trim() || null,
        },
      });
      // Reflect a potential name change in the stored session + sidebar.
      const user = getUser();
      const token = getToken();
      if (user && token) {
        setSession(token, { ...user, full_name: profile.full_name });
      }
      toast('Profile updated.', 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack" style={{ maxWidth: 640 }}>
      <div>
        <h1>My profile</h1>
        <p className="muted" style={{ margin: 0 }}>
          Keep your contact and insurance details up to date.
        </p>
      </div>

      <div className="card">
        {error && <div className="alert error">{error}</div>}
        {!loaded && !error && <Spinner />}
        {loaded && (
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="full_name">Full name</label>
              <input
                className="input"
                id="full_name"
                value={form.full_name}
                onChange={(e) => set('full_name', e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input className="input" id="email" value={form.email} disabled />
              <span className="muted small">Email is used for login and can't be changed here.</span>
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
            <button className="btn" type="submit" id="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
