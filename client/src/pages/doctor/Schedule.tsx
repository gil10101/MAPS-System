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
  addDays, completeAppointment, formatDate, formatTime, markAppointmentNoShow,
  listDoctorAppointments, NO_SHOW_REASONS, todayStr,
  type Appointment,
} from '../../lib/api';
import {
  Alert, Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader,
  ReasonModal, RescheduleBadge, RowMenu, MenuItem, Spinner, StatusBadge, Table,
  Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/**
 * Has this appointment's start time passed?
 *
 * A physician records what happened at a visit, so neither outcome is available
 * before the visit begins — there is nothing yet to report. The server enforces
 * this too; this is the same rule stated in the interface so the action can be
 * shown as not-yet-available rather than silently missing.
 *
 * Compared against the appointment's own date and time rather than the page's
 * selected date, because the schedule pages freely to any day.
 */
function hasStarted(a: Appointment): boolean {
  return new Date(`${a.appt_date}T${a.appt_time}`).getTime() <= Date.now();
}

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

  /** Non-attendance needs a reason, so it collects one the same way. */
  const [noShowTarget, setNoShowTarget] = useState<Appointment | null>(null);

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

  async function markNoShow(reason: string) {
    if (!noShowTarget) return;
    setBusy(true);
    try {
      await markAppointmentNoShow(noShowTarget.id, reason);
      toast(`${noShowTarget.patient_name} recorded as not attending.`, 'success');
      setNoShowTarget(null);
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
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={!hasStarted(a)}
                          title={
                            hasStarted(a)
                              ? undefined
                              : `Available from ${formatTime(a.appt_time)}`
                          }
                          onClick={() => {
                            setCompleting(a);
                            setNote('');
                          }}
                        >
                          Complete visit
                        </Button>
                        <RowMenu label={`Actions for ${a.patient_name}`}>
                          <MenuItem
                            disabled={!hasStarted(a)}
                            onClick={() => setNoShowTarget(a)}
                          >
                            Didn't attend
                          </MenuItem>
                        </RowMenu>
                      </div>
                    ) : a.status === 'pending' ? (
                      <span className="text-xs text-slate-500">Awaiting clinic approval</span>
                    ) : a.status === 'completed' && a.notes ? (
                      <span className="text-xs text-slate-500">Note on file</span>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                    {a.status === 'confirmed' && !hasStarted(a) && (
                      <div className="mt-1 text-xs text-slate-400">
                        Available from {formatTime(a.appt_time)}
                      </div>
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

      <ReasonModal
        open={!!noShowTarget}
        busy={busy}
        title="Record a missed appointment"
        presets={NO_SHOW_REASONS}
        confirmLabel="Record as missed"
        dismissLabel="Go back"
        onConfirm={markNoShow}
        onCancel={() => setNoShowTarget(null)}
        intro={
          noShowTarget
            ? `${noShowTarget.patient_name} did not attend their ${formatTime(
                noShowTarget.appt_time
              )} appointment. The slot stays consumed — a missed visit is not returned to the pool.`
            : undefined
        }
      />
    </>
  );
}
