import { useCallback, useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import {
  api, formatDate, formatTime,
  type Appointment, type ApptStatus, type Doctor,
} from '../../lib/api';
import { Badge, Empty, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function AdminAppointments() {
  const toast = useToast();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [status, setStatus] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState('');
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ doctors: Doctor[] }>('/admin/doctors')
      .then((d) => setDoctors(d.doctors))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
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
  }, [status, doctorId, date]);

  useEffect(() => {
    load();
  }, [load]);

  async function setApptStatus(id: number, newStatus: ApptStatus) {
    if (newStatus === 'cancelled' && !window.confirm('Cancel this appointment?')) return;
    try {
      await api(`/admin/appointments/${id}/status`, { method: 'PATCH', body: { status: newStatus } });
      toast(`Appointment marked ${newStatus}.`, 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="container stack">
      <div>
        <h1>Appointments</h1>
        <p className="muted" style={{ margin: 0 }}>
          Approve, complete, or cancel patient bookings.
        </p>
      </div>

      <div className="card">
        <div className="field-row" style={{ marginBottom: 0 }}>
          <div className="field" style={{ marginBottom: 8 }}>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 8 }}>
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
          <div className="field" style={{ marginBottom: 8 }}>
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

      <div className="card">
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
                    <td>
                      <strong>{a.patient_name}</strong>
                      <div className="muted small">{a.patient_email}</div>
                    </td>
                    <td>
                      {a.doctor_name}
                      <div className="muted small">{a.specialty_name || ''}</div>
                    </td>
                    <td>{formatDate(a.appt_date)}</td>
                    <td>{formatTime(a.appt_time)}</td>
                    <td className="muted">{a.reason || '—'}</td>
                    <td>
                      <Badge status={a.status} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {a.status === 'pending' && (
                          <button className="btn sm" onClick={() => setApptStatus(a.id, 'confirmed')}>
                            Confirm
                          </button>
                        )}
                        {(a.status === 'pending' || a.status === 'confirmed') && (
                          <>
                            <button
                              className="btn secondary sm"
                              onClick={() => setApptStatus(a.id, 'completed')}
                            >
                              Complete
                            </button>
                            <button
                              className="btn danger sm"
                              onClick={() => setApptStatus(a.id, 'cancelled')}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {(a.status === 'completed' || a.status === 'cancelled') && (
                          <span className="muted small">—</span>
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
    </div>
  );
}
