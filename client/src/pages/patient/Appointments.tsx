import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Plus } from 'lucide-react';
import { api, formatDate, formatTime, type Appointment } from '../../lib/api';
import { Badge, Empty, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

type Filter = 'all' | 'upcoming' | 'past';

export default function Appointments() {
  const toast = useToast();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ appointments: Appointment[] }>('/appointments')
      .then((d) => setAppointments(d.appointments))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  const visible = (appointments || []).filter((a) => {
    if (filter === 'upcoming') return a.status === 'pending' || a.status === 'confirmed';
    if (filter === 'past') return a.status === 'completed' || a.status === 'cancelled';
    return true;
  });

  async function cancelAppt(id: number) {
    if (!window.confirm('Cancel this appointment? This cannot be undone.')) return;
    try {
      await api(`/appointments/${id}/cancel`, { method: 'PATCH' });
      toast('Appointment cancelled.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="container stack">
      <div className="row between">
        <div>
          <h1>My appointments</h1>
          <p className="muted" style={{ margin: 0 }}>
            Review, track, and cancel your bookings.
          </p>
        </div>
        <Link to="/app/doctors" className="btn">
          <Plus className="lucide in-btn" /> Book appointment
        </Link>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 16 }}>
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const canCancel = a.status === 'pending' || a.status === 'confirmed';
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.doctor_name}</strong>
                        <div className="muted small">{a.specialty_name || ''}</div>
                      </td>
                      <td>{formatDate(a.appt_date)}</td>
                      <td>{formatTime(a.appt_time)}</td>
                      <td className="muted">{a.reason || '—'}</td>
                      <td>
                        <Badge status={a.status} />
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canCancel && (
                          <button className="btn danger sm" onClick={() => cancelAppt(a.id)}>
                            Cancel
                          </button>
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
    </div>
  );
}
