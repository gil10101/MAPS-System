import { useCallback, useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import {
  api, formatDate, formatTime,
  NO_SHOW_REASONS, PRACTICE_CANCEL_REASONS,
  type Appointment, type Doctor,
} from '../../lib/api';
import { Badge, ConfirmBadge, Empty, MenuItem, ReasonModal, RowMenu, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

/** Which destructive action the reason modal is currently collecting for. */
type Pending = { appt: Appointment; kind: 'cancelled' | 'no_show' } | null;

export default function AdminAppointments() {
  const toast = useToast();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [status, setStatus] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ doctors: Doctor[] }>('/admin/doctors')
      .then((d) => setDoctors(d.doctors))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (confirmation) params.set('confirmation', confirmation);
    if (doctorId) params.set('doctor_id', doctorId);
    if (date) params.set('date', date);
    setAppointments(null);
    try {
      const d = await api<{ appointments: Appointment[] }>(
        `/admin/appointments?${params.toString()}`
      );
      setAppointments(d.appointments);
      setError('');
    } catch (err) {
      setError((err as Error).message);
      setAppointments([]);
    }
  }, [status, confirmation, doctorId, date]);

  useEffect(() => {
    load();
  }, [load]);

  async function complete(a: Appointment) {
    try {
      await api(`/admin/appointments/${a.id}/status`, {
        method: 'PATCH',
        body: { status: 'completed' },
      });
      toast(`Visit with ${a.patient_name} marked complete.`, 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function submitReason(reason: string) {
    if (!pending) return;
    const { appt, kind } = pending;
    setBusy(true);
    try {
      await api(`/admin/appointments/${appt.id}/status`, {
        method: 'PATCH',
        body: { status: kind, reason },
      });
      toast(
        kind === 'cancelled'
          ? `Appointment for ${appt.patient_name} cancelled.`
          : `${appt.patient_name} recorded as not attending.`,
        'success'
      );
      setPending(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <div>
        <h1>Appointments</h1>
        <p className="muted" style={{ margin: 0 }}>
          Record how visits ended, and chase the patients who haven't replied to their reminder.
        </p>
      </div>

      <div className="card">
        <div className="filter-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="booked">Booked</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">Didn't attend</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-confirm">Patient reply</label>
            <select
              id="f-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            >
              <option value="">Any</option>
              <option value="unconfirmed">Awaiting reply</option>
              <option value="confirmed">Confirmed by patient</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-doctor">Physician</label>
            <select id="f-doctor" value={doctorId} onChange={(e) => setDoctorId(e.target.value)}>
              <option value="">All physicians</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="f-date">Date</label>
            <input
              className="input"
              type="date"
              id="f-date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card table-stack">
        {error && <div className="alert error">{error}</div>}
        {!appointments && !error && <Spinner />}
        {appointments && appointments.length === 0 && !error && (
          <Empty icon={Calendar}>
            <p>No appointments match these filters.</p>
          </Empty>
        )}
        {appointments && appointments.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Physician</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Patient">
                      <strong>{a.patient_name}</strong>
                      <div className="muted small">{a.patient_email}</div>
                    </td>
                    <td data-label="Physician">
                      {a.doctor_name}
                      <div className="muted small">{a.specialty_name || ''}</div>
                    </td>
                    <td data-label="Date" className="nowrap">{formatDate(a.appt_date)}</td>
                    <td data-label="Time" className="nowrap">{formatTime(a.appt_time)}</td>
                    <td data-label="Reason" className="muted">{a.reason || '—'}</td>
                    <td data-label="Status">
                      <div className="badge-stack">
                        <Badge status={a.status} />
                        <ConfirmBadge status={a.status} confirmation={a.confirmation_status} />
                        {a.cancel_reason && (
                          <span className="muted small">
                            {a.cancelled_by === 'patient'
                              ? 'By patient'
                              : a.cancelled_by === 'practice'
                                ? 'By clinic'
                                : null}
                            {a.cancelled_by && a.cancelled_by !== 'unknown' ? ' · ' : ''}
                            {a.cancel_reason}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="actions">
                      {a.status === 'booked' ? (
                        <div className="action-group">
                          {/* No "Confirm": nothing here needs clinic approval, and
                              only the patient can confirm attendance. What staff
                              record is the outcome. */}
                          <button className="btn secondary sm" onClick={() => complete(a)}>
                            Complete
                          </button>
                          <RowMenu label={`Actions for ${a.patient_name}`}>
                            <MenuItem onClick={() => setPending({ appt: a, kind: 'no_show' })}>
                              Mark as didn't attend
                            </MenuItem>
                            <MenuItem
                              danger
                              onClick={() => setPending({ appt: a, kind: 'cancelled' })}
                            >
                              Cancel appointment
                            </MenuItem>
                          </RowMenu>
                        </div>
                      ) : (
                        <span className="muted small" aria-label="No actions available">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReasonModal
        open={!!pending}
        busy={busy}
        title={pending?.kind === 'no_show' ? 'Record a missed appointment' : 'Cancel appointment'}
        presets={pending?.kind === 'no_show' ? NO_SHOW_REASONS : PRACTICE_CANCEL_REASONS}
        confirmLabel={pending?.kind === 'no_show' ? 'Record as missed' : 'Cancel appointment'}
        dismissLabel={pending?.kind === 'no_show' ? 'Go back' : 'Keep appointment'}
        intro={
          pending && (
            <p className="muted small">
              {pending.appt.patient_name} with {pending.appt.doctor_name} on{' '}
              {formatDate(pending.appt.appt_date)} at {formatTime(pending.appt.appt_time)}.
              {pending.kind === 'cancelled' && ' This cannot be undone.'}
            </p>
          )
        }
        onCancel={() => setPending(null)}
        onConfirm={submitReason}
      />
    </div>
  );
}
