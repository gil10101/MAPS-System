import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  api, formatDate, formatTime, todayStr, type Appointment,
} from '../../lib/api';
import { Badge, ConfirmBadge, Empty, Modal, Spinner } from '../../components/ui';
import { useToast } from '../../components/Toast';

/** Shift 'YYYY-MM-DD' by n days (local time, DST-safe at noon). */
function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export default function DoctorSchedule() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');

  // Complete-visit modal: the clinical note is required, so this can't be a
  // bare confirm dialog.
  const [completing, setCompleting] = useState<Appointment | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setAppointments(null);
    api<{ appointments: Appointment[] }>(`/doctor/appointments?date=${date}`)
      .then((d) => setAppointments(d.appointments))
      .catch((err) => {
        setError((err as Error).message);
        setAppointments([]);
      });
  }, [date]);

  useEffect(load, [load]);

  async function completeVisit() {
    if (!completing || !note.trim()) return;
    setBusy(true);
    try {
      await api(`/doctor/appointments/${completing.id}/complete`, {
        method: 'PATCH',
        body: { note: note.trim() },
      });
      toast(`Visit with ${completing.patient_name} completed.`, 'success');
      setCompleting(null);
      setNote('');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const isToday = date === todayStr();

  return (
    <div className="container stack">
      <div className="row between">
        <div>
          <h1>{isToday ? "Today's schedule" : 'Schedule'}</h1>
          <p className="muted" style={{ margin: 0 }}>
            {formatDate(date)} — complete visits with a note as you see patients.
          </p>
        </div>
        <div className="row tight">
          <button className="btn secondary sm" onClick={() => setDate(shiftDate(date, -1))} aria-label="Previous day">
            <ChevronLeft className="lucide" />
          </button>
          {!isToday && (
            <button className="btn secondary sm" onClick={() => setDate(todayStr())}>
              Today
            </button>
          )}
          <input
            className="input"
            type="date"
            style={{ width: 'auto', minHeight: '2.25rem' }}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            aria-label="Schedule date"
          />
          <button className="btn secondary sm" onClick={() => setDate(shiftDate(date, 1))} aria-label="Next day">
            <ChevronRight className="lucide" />
          </button>
        </div>
      </div>

      <div className="card table-stack">
        {error && <div className="alert error">{error}</div>}
        {!appointments && !error && <Spinner />}
        {appointments && appointments.length === 0 && (
          <Empty icon={CalendarClock}>
            <p>No appointments on this day.</p>
          </Empty>
        )}
        {appointments && appointments.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Patient</th>
                  <th>Reason</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Time" className="nowrap">
                      <strong>{formatTime(a.appt_time)}</strong>
                    </td>
                    <td data-label="Patient">
                      <Link to={`/doctor/patients/${a.patient_id}`}>
                        <strong>{a.patient_name}</strong>
                      </Link>
                      <div className="muted small">{a.patient_email}</div>
                    </td>
                    <td data-label="Reason" className="muted">{a.reason || '—'}</td>
                    <td data-label="Status">
                      <div className="badge-stack">
                        <Badge status={a.status} />
                        <ConfirmBadge status={a.status} confirmation={a.confirmation_status} />
                      </div>
                    </td>
                    <td className="actions">
                      {a.status === 'booked' ? (
                        <button
                          className="btn sm"
                          onClick={() => {
                            setCompleting(a);
                            setNote('');
                          }}
                        >
                          Complete visit
                        </button>
                      ) : a.status === 'completed' && a.notes ? (
                        <span className="muted small">Note on file</span>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={!!completing}
        title="Complete visit"
        onClose={() => setCompleting(null)}
        footer={
          <>
            <button className="btn secondary" onClick={() => setCompleting(null)}>
              Go back
            </button>
            <button className="btn" disabled={!note.trim() || busy} onClick={completeVisit}>
              {busy ? 'Saving…' : 'Sign & complete'}
            </button>
          </>
        }
      >
        {completing && (
          <>
            <p className="muted small">
              {completing.patient_name} · {formatDate(completing.appt_date)} at{' '}
              {formatTime(completing.appt_time)}
              {completing.reason ? ` · ${completing.reason}` : ''}
            </p>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="visit-note">Visit note (required — visible to the patient)</label>
              <textarea
                id="visit-note"
                rows={6}
                placeholder="Findings, assessment, plan, and any follow-up instructions."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
