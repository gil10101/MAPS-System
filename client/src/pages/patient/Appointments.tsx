import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Check, Plus } from 'lucide-react';
import {
  api, formatDate, formatTime, PATIENT_CANCEL_REASONS, type Appointment,
} from '../../lib/api';
import { Badge, ConfirmBadge, Empty, ReasonModal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

type Filter = 'all' | 'upcoming' | 'past';

export default function Appointments() {
  const toast = useToast();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ appointments: Appointment[] }>('/appointments')
      .then((d) => setAppointments(d.appointments))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  const visible = (appointments || []).filter((a) => {
    if (filter === 'upcoming') return a.status === 'booked';
    if (filter === 'past') return a.status !== 'booked';
    return true;
  });

  const awaiting = (appointments || []).filter(
    (a) => a.status === 'booked' && a.confirmation_status === 'unconfirmed'
  );

  async function confirmAttendance(a: Appointment) {
    try {
      await api(`/appointments/${a.id}/confirm`, { method: 'PATCH' });
      toast('Thanks — your appointment is confirmed.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function submitCancel(reason: string) {
    if (!cancelling) return;
    setBusy(true);
    try {
      await api(`/appointments/${cancelling.id}/cancel`, { method: 'PATCH', body: { reason } });
      toast('Appointment cancelled.', 'success');
      setCancelling(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container stack">
      <div className="row between">
        <div>
          <h1>My appointments</h1>
          <p className="muted" style={{ margin: 0 }}>
            Confirm, review, and cancel your bookings.
          </p>
        </div>
        <Link to="/app/doctors" className="btn">
          <Plus className="lucide in-btn" /> Book appointment
        </Link>
      </div>

      {/* The nudge a reminder text would send. Confirmation is the patient's to
          give, so it's surfaced here rather than on a staff screen. */}
      {awaiting.length > 0 && (
        <div className="alert info" style={{ marginBottom: 0 }}>
          <strong>
            {awaiting.length === 1
              ? 'One appointment needs confirming.'
              : `${awaiting.length} appointments need confirming.`}
          </strong>{' '}
          Letting the clinic know you're coming frees the slot for someone else if you're not.
        </div>
      )}

      <div className="card table-stack">
        <div className="row tight" style={{ marginBottom: 'var(--s4)' }}>
          {(['all', 'upcoming', 'past'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`btn sm ${filter === f ? '' : 'secondary'}`}
              onClick={() => setFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {error && <div className="alert error">{error}</div>}
        {!appointments && !error && <Spinner />}
        {appointments && visible.length === 0 && (
          <Empty icon={Calendar}>
            <p>Nothing here yet.</p>
            <Link to="/app/doctors" className="btn">
              Book an appointment
            </Link>
          </Empty>
        )}
        {visible.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Doctor</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const upcoming = a.status === 'booked';
                  const needsReply = upcoming && a.confirmation_status === 'unconfirmed';
                  return (
                    <tr key={a.id}>
                      <td data-label="Doctor">
                        <strong>{a.doctor_name}</strong>
                        <div className="muted small">{a.specialty_name || ''}</div>
                      </td>
                      <td data-label="Date" className="nowrap">{formatDate(a.appt_date)}</td>
                      <td data-label="Time" className="nowrap">{formatTime(a.appt_time)}</td>
                      <td data-label="Reason" className="muted">{a.reason || '—'}</td>
                      <td data-label="Status">
                        <div className="badge-stack">
                          <Badge status={a.status} />
                          <ConfirmBadge status={a.status} confirmation={a.confirmation_status} />
                          {a.cancel_reason && a.cancelled_by !== 'unknown' && (
                            <span className="muted small">{a.cancel_reason}</span>
                          )}
                        </div>
                      </td>
                      <td className="actions">
                        {upcoming ? (
                          <div className="action-group">
                            {needsReply && (
                              <button className="btn sm" onClick={() => confirmAttendance(a)}>
                                <Check className="lucide in-btn" /> I'll be there
                              </button>
                            )}
                            <button className="btn danger sm" onClick={() => setCancelling(a)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReasonModal
        open={!!cancelling}
        busy={busy}
        title="Cancel appointment"
        presets={PATIENT_CANCEL_REASONS}
        confirmLabel="Cancel appointment"
        intro={
          cancelling && (
            <p className="muted small">
              {cancelling.doctor_name} on {formatDate(cancelling.appt_date)} at{' '}
              {formatTime(cancelling.appt_time)}. This cannot be undone — you'll need to book a
              new time.
            </p>
          )
        }
        onCancel={() => setCancelling(null)}
        onConfirm={submitCancel}
      />
    </div>
  );
}
