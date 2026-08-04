/**
 * The physician's day view — who is coming, where, and what still needs closing.
 *
 * One day at a time rather than a week grid: the question this page answers is
 * "what is in front of me now", and a day is the unit a clinic session is run
 * in. The date navigator is kept next to the heading so moving to tomorrow is
 * one tap and never a page change.
 *
 * A visit can only be completed out of `confirmed`. A `pending` row is a
 * request nobody has approved yet, so it gets a line of explanation instead of
 * an action the server would refuse — offering a button that always fails is
 * worse than offering none.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle, CalendarClock, ChevronLeft, ChevronRight, Clock,
} from 'lucide-react';
import {
  addDays, completeAppointment, formatDate, formatTime, listDoctorAppointments, todayStr,
  type Appointment,
} from '../../lib/api';
import {
  Alert, Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader,
  RescheduleBadge, Spinner, StatusBadge, Table, Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

export default function DoctorSchedule() {
  const toast = useToast();
  const [date, setDate] = useState(todayStr());
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');

  // The clinical note is required to complete, so this is a form rather than a
  // confirm dialog.
  const [completing, setCompleting] = useState<Appointment | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setAppointments(null);
    setError('');
    listDoctorAppointments({ date })
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
      await completeAppointment(completing.id, note.trim());
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
  const pendingCount = (appointments || []).filter((a) => a.status === 'pending').length;

  return (
    <>
      <PageHeader
        title={isToday ? "Today's schedule" : 'Schedule'}
        subtitle={`${formatDate(date)} — complete each visit with a note as you see the patient.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <IconButton
              icon={ChevronLeft}
              label="Previous day"
              size="sm"
              onClick={() => setDate(addDays(date, -1))}
            />
            <Input
              type="date"
              className="w-auto min-w-[9.5rem]"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              aria-label="Schedule date"
            />
            <IconButton
              icon={ChevronRight}
              label="Next day"
              size="sm"
              onClick={() => setDate(addDays(date, 1))}
            />
            {!isToday && (
              <Button size="sm" onClick={() => setDate(todayStr())}>
                Today
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <Alert tone="error" icon={AlertCircle} className="mb-4">
          {error}
        </Alert>
      )}

      {pendingCount > 0 && (
        <Alert tone="warning" icon={Clock} className="mb-4">
          {pendingCount === 1
            ? '1 booking on this day is still a request waiting on clinic staff to approve it.'
            : `${pendingCount} bookings on this day are still requests waiting on clinic staff to approve them.`}
        </Alert>
      )}

      <Card className="p-0 sm:p-0">
        {!appointments && !error && <Spinner label="Loading your day…" />}

        {appointments && appointments.length === 0 && (
          <EmptyState icon={CalendarClock} title="Nothing booked on this day">
            Use the date navigator above to look at another day.
          </EmptyState>
        )}

        {appointments && appointments.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Patient</Th>
                <Th>Reason</Th>
                <Th>Location</Th>
                <Th>Status</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap font-semibold">{formatTime(a.appt_time)}</Td>
                  <Td>
                    <Link
                      to={`/doctor/patients/${a.patient_id}`}
                      className="font-semibold text-accent-700 hover:underline"
                    >
                      {a.patient_name}
                    </Link>
                    <div className="text-xs text-slate-500">{a.patient_email}</div>
                  </Td>
                  <Td className="text-slate-600">{a.reason || '—'}</Td>
                  {/* A physician may hold clinic at more than one site in a
                      week, so the building is part of the row, not a setting. */}
                  <Td className="whitespace-nowrap text-slate-600">{a.location_name || '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={a.status} variant="staff" />
                      {a.reschedule_required && <RescheduleBadge />}
                    </div>
                  </Td>
                  <Td align="right">
                    {a.status === 'confirmed' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          setCompleting(a);
                          setNote('');
                        }}
                      >
                        Complete visit
                      </Button>
                    ) : a.status === 'pending' ? (
                      <span className="text-xs text-slate-500">Awaiting clinic approval</span>
                    ) : a.status === 'completed' && a.notes ? (
                      <span className="text-xs text-slate-500">Note on file</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!completing}
        title="Complete visit"
        onClose={() => setCompleting(null)}
        footer={
          <>
            <Button onClick={() => setCompleting(null)}>Go back</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!note.trim()}
              onClick={completeVisit}
            >
              Sign &amp; complete
            </Button>
          </>
        }
      >
        {completing && (
          <>
            <p className="mb-4 text-sm text-slate-600">
              {completing.patient_name} · {formatDate(completing.appt_date)} at{' '}
              {formatTime(completing.appt_time)}
              {completing.location_name ? ` · ${completing.location_name}` : ''}
              {completing.reason ? ` · ${completing.reason}` : ''}
            </p>
            <Field
              label="Visit note"
              htmlFor="visit-note"
              required
              hint="Kept in the chart for the care team. Patients do not see visit notes."
              className="mb-0"
            >
              <Textarea
                id="visit-note"
                rows={6}
                placeholder="Findings, assessment, plan, and any follow-up instructions."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
