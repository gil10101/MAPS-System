import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Plus } from 'lucide-react';
import { api, formatDate, formatTime, getUser, initials, type Appointment } from '../../lib/api';
import { ConfirmBadge, Empty, Spinner } from '../../components/ui';

export default function Dashboard() {
  const user = getUser();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ appointments: Appointment[] }>('/appointments')
      .then((d) => setAppointments(d.appointments))
      .catch((err) => setError((err as Error).message));
  }, []);

  const upcoming = (appointments || [])
    .filter((a) => a.status === 'booked')
    .sort((a, b) => (a.appt_date + a.appt_time).localeCompare(b.appt_date + b.appt_time));
  const completed = (appointments || []).filter((a) => a.status === 'completed');

  return (
    <div className="container stack">
      <div className="row between">
        <div>
          <h1 id="greeting">Welcome, {user?.full_name.split(' ')[0]}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Here's an overview of your care.
          </p>
        </div>
        <Link to="/app/doctors" className="btn">
          <Plus className="lucide in-btn" /> Book appointment
        </Link>
      </div>

      <div className="grid cols-3" id="stats">
        <div className="card stat">
          <div className="value teal" id="stat-total">{appointments ? upcoming.length : '–'}</div>
          <div className="label">Upcoming</div>
        </div>
        <div className="card stat">
          <div className="value">{appointments ? completed.length : '–'}</div>
          <div className="label">Completed visits</div>
        </div>
        <div className="card stat">
          <div className="value">{appointments ? appointments.length : '–'}</div>
          <div className="label">Total appointments</div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <h2>Upcoming appointments</h2>
          <Link to="/app/appointments" className="btn ghost sm">
            View all
          </Link>
        </div>
        {error && <div className="alert error">{error}</div>}
        {!appointments && !error && <Spinner />}
        {appointments && upcoming.length === 0 && (
          <Empty icon={Calendar}>
            <p>No upcoming appointments.</p>
            <Link to="/app/doctors" className="btn">
              Find a doctor
            </Link>
          </Empty>
        )}
        {upcoming.map((a) => (
          <div key={a.id} className="appt-row">
            <div className="who">
              <div className="avatar">{initials(a.doctor_name)}</div>
              <div style={{ minWidth: 0 }}>
                <strong>{a.doctor_name}</strong>
                <div className="muted small">
                  {a.specialty_name || ''}
                  {a.reason ? ` · ${a.reason}` : ''}
                </div>
              </div>
            </div>
            <div className="when">
              <div>{formatDate(a.appt_date)}</div>
              <div className="muted small">{formatTime(a.appt_time)}</div>
              <div className="badge-stack" style={{ marginTop: 'var(--s1)' }}>
                <ConfirmBadge status={a.status} confirmation={a.confirmation_status} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
