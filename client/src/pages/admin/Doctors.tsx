import { useCallback, useEffect, useState } from 'react';
import { Plus, Stethoscope } from 'lucide-react';
import { api, type Doctor, type Specialty } from '../../lib/api';
import { Empty, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

const EMPTY_FORM = {
  full_name: '',
  specialty_id: '',
  room: '',
  email: '',
  phone: '',
  bio: '',
  active: true,
};

export default function AdminDoctors() {
  const toast = useToast();
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState('');

  // Add/Edit modal
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ specialties: Specialty[] }>('/admin/specialties')
      .then((d) => setSpecialties(d.specialties))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    api<{ doctors: Doctor[] }>('/admin/doctors')
      .then((d) => setDoctors(d.doctors))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openModal(doc?: Doctor) {
    setModalError('');
    if (doc) {
      setEditingId(doc.id);
      setForm({
        full_name: doc.full_name,
        specialty_id: doc.specialty_id ? String(doc.specialty_id) : '',
        room: doc.room || '',
        email: doc.email || '',
        phone: doc.phone || '',
        bio: doc.bio || '',
        active: !!doc.active,
      });
    } else {
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
    setOpen(true);
  }

  async function save() {
    if (!form.full_name.trim()) {
      setModalError('Name is required.');
      return;
    }
    const body: Record<string, unknown> = {
      full_name: form.full_name.trim(),
      specialty_id: form.specialty_id || null,
      room: form.room.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      bio: form.bio.trim() || null,
    };
    setBusy(true);
    setModalError('');
    try {
      if (editingId) {
        body.active = form.active;
        await api(`/admin/doctors/${editingId}`, { method: 'PUT', body });
      } else {
        await api('/admin/doctors', { method: 'POST', body });
      }
      setOpen(false);
      toast('Physician saved.', 'success');
      load();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate(id: number) {
    if (!window.confirm('Deactivate this physician? They will stop accepting new appointments.')) {
      return;
    }
    try {
      await api(`/admin/doctors/${id}`, { method: 'DELETE' });
      toast('Physician deactivated.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="container stack">
      <div className="row between">
        <div>
          <h1>Physicians</h1>
          <p className="muted" style={{ margin: 0 }}>
            Add, edit, or deactivate providers.
          </p>
        </div>
        <button className="btn" onClick={() => openModal()}>
          <Plus className="lucide in-btn" /> Add physician
        </button>
      </div>

      <div className="card">
        {error && <div className="alert error">{error}</div>}
        {!doctors && !error && <Spinner />}
        {doctors && doctors.length === 0 && (
          <Empty icon={Stethoscope}>
            <p>No physicians yet.</p>
          </Empty>
        )}
        {doctors && doctors.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Specialty</th>
                  <th>Contact</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {doctors.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <strong>{d.full_name}</strong>
                    </td>
                    <td className="muted">{d.specialty_name || '—'}</td>
                    <td className="muted small">
                      {d.email || ''}
                      {d.phone && (
                        <>
                          <br />
                          {d.phone}
                        </>
                      )}
                    </td>
                    <td>{d.room || '—'}</td>
                    <td>
                      {d.active ? (
                        <span className="badge completed">Active</span>
                      ) : (
                        <span className="badge cancelled">Inactive</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button className="btn secondary sm" onClick={() => openModal(d)}>
                          Edit
                        </button>
                        {d.active && (
                          <button className="btn danger sm" onClick={() => deactivate(d.id)}>
                            Deactivate
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={open}
        title={editingId ? 'Edit physician' : 'Add physician'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {modalError && <div className="alert error">{modalError}</div>}
        <div className="field">
          <label htmlFor="m-name">Full name *</label>
          <input
            className="input"
            id="m-name"
            placeholder="Dr. Jane Smith"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
          />
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="m-specialty">Specialty</label>
            <select
              id="m-specialty"
              value={form.specialty_id}
              onChange={(e) => set('specialty_id', e.target.value)}
            >
              <option value="">Unassigned</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="m-room">Room</label>
            <input
              className="input"
              id="m-room"
              placeholder="A-101"
              value={form.room}
              onChange={(e) => set('room', e.target.value)}
            />
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="m-email">Email</label>
            <input
              className="input"
              type="email"
              id="m-email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="m-phone">Phone</label>
            <input
              className="input"
              id="m-phone"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="m-bio">Bio</label>
          <textarea
            id="m-bio"
            placeholder="Short professional bio"
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
          />
        </div>
        {editingId && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
              />{' '}
              Accepting appointments (active)
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
