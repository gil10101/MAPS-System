import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import {
  api, formatTime, initials, todayStr,
  type Doctor, type Specialty,
} from '../../lib/api';
import { Empty, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function Doctors() {
  const navigate = useNavigate();
  const toast = useToast();

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [q, setQ] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState('');

  // Booking modal state
  const [selected, setSelected] = useState<Doctor | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slot, setSlot] = useState('');
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ specialties: Specialty[] }>('/doctors/specialties')
      .then((d) => setSpecialties(d.specialties))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (specialty) params.set('specialty', specialty);
    try {
      const d = await api<{ doctors: Doctor[] }>(`/doctors?${params.toString()}`);
      setDoctors(d.doctors);
      setError('');
    } catch (err) {
      setError((err as Error).message);
      setDoctors([]);
    }
  }, [q, specialty]);

  // Debounced search on q/specialty change.
  useEffect(() => {
    setDoctors(null);
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  function openBooking(doctor: Doctor) {
    setSelected(doctor);
    setDate('');
    setSlots(null);
    setSlot('');
    setReason('');
    setModalError('');
  }

  async function loadSlots(newDate: string) {
    setDate(newDate);
    setSlot('');
    setSlots(null);
    if (!newDate || !selected) return;
    try {
      const d = await api<{ slots: string[] }>(
        `/doctors/${selected.id}/availability?date=${newDate}`
      );
      setSlots(d.slots);
    } catch (err) {
      setModalError((err as Error).message);
      setSlots([]);
    }
  }

  async function confirmBooking() {
    if (!selected || !slot) return;
    setBusy(true);
    setModalError('');
    try {
      await api('/appointments', {
        method: 'POST',
        body: {
          doctor_id: selected.id,
          appt_date: date,
          appt_time: slot,
          reason: reason.trim() || null,
        },
      });
      setSelected(null);
      toast('Appointment booked! Awaiting clinic confirmation.', 'success');
      setTimeout(() => navigate('/app/appointments'), 600);
    } catch (err) {
      setModalError((err as Error).message);
      // The slot may have been taken — refresh availability.
      loadSlots(date);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <div>
        <h1>Find a doctor</h1>
        <p className="muted" style={{ margin: 0 }}>
          Search by name or specialty, then pick an open time.
        </p>
      </div>

      <div className="card">
        <div className="field-row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="q">Search by name</label>
            <input
              className="input"
              id="q"
              placeholder="e.g. Chen"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="specialty">Specialty</label>
            <select id="specialty" value={specialty} onChange={(e) => setSpecialty(e.target.value)}>
              <option value="">All specialties</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {!doctors && !error && <Spinner />}
      {doctors && doctors.length === 0 && !error && (
        <div className="card">
          <Empty icon={Search}>
            <p>No doctors match your search.</p>
          </Empty>
        </div>
      )}
      {doctors && doctors.length > 0 && (
        <div className="grid cols-2">
          {doctors.map((d) => (
            <div className="card doctor-card" key={d.id}>
              <div className="doctor-head">
                <div className="avatar">{initials(d.full_name)}</div>
                <div>
                  <strong>{d.full_name}</strong>
                  <div className="muted small">
                    {d.specialty_name || 'General'}
                    {d.room ? ` · Room ${d.room}` : ''}
                  </div>
                </div>
              </div>
              {d.bio && <div className="bio">{d.bio}</div>}
              <div>
                <button className="btn sm" onClick={() => openBooking(d)}>
                  Book appointment
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!selected}
        title="Book appointment"
        onClose={() => setSelected(null)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setSelected(null)}>
              Cancel
            </button>
            <button className="btn" id="m-confirm" disabled={!slot || busy} onClick={confirmBooking}>
              {busy ? 'Booking…' : 'Confirm booking'}
            </button>
          </>
        }
      >
        {selected && (
          <>
            {modalError && <div className="alert error">{modalError}</div>}
            <div className="row" style={{ gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div className="avatar">{initials(selected.full_name)}</div>
              <div>
                <strong>{selected.full_name}</strong>
                <div className="muted small">{selected.specialty_name || 'General'}</div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="m-date">Choose a date</label>
              <input
                className="input"
                type="date"
                id="m-date"
                min={todayStr()}
                value={date}
                onChange={(e) => loadSlots(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Available times</label>
              <div className="slots" id="m-slots">
                {!date && <span className="muted small">Pick a date to see open times.</span>}
                {date && slots === null && <span className="spinner" />}
                {date && slots && slots.length === 0 && (
                  <span className="muted small">
                    No open times on this date. Try another day (doctors work weekdays).
                  </span>
                )}
                {date &&
                  slots &&
                  slots.map((s) => (
                    <button
                      type="button"
                      key={s}
                      className={`slot${slot === s ? ' selected' : ''}`}
                      onClick={() => setSlot(s)}
                    >
                      {formatTime(s)}
                    </button>
                  ))}
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="m-reason">Reason for visit (optional)</label>
              <textarea
                id="m-reason"
                placeholder="Briefly describe your symptoms or reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
