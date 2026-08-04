/**
 * Admin Appointments — the approval queue and the clinic day book (A1, B12).
 *
 * A booking now arrives as a *request*, so the job this page exists for is
 * working the pending list. Approve is therefore the only primary-weight
 * button in the table, and it is the first thing on a pending row.
 *
 * Actions are drawn from the appointment's own status rather than offered
 * unconditionally: the server rejects an illegal transition, and a button that
 * exists only to produce a 409 is a button that teaches staff to distrust the
 * screen.
 *
 * Filters live in the query string rather than in component state. The
 * Overview dashboard links straight here with ?status=pending, and a scheduler
 * who has narrowed to one site and one week can bookmark or send that view.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Calendar, Check, FileText } from 'lucide-react';
import {
  adminListAppointments, adminListDoctors, adminListLocations,
  adminSaveAppointmentNote, adminSetAppointmentStatus,
  formatDate, formatTime, NO_SHOW_REASONS, PRACTICE_CANCEL_REASONS, STAFF_STATUS_LABEL,
  type Appointment, type ApptStatus, type Doctor, type Location,
} from '../../lib/api';
import {
  Alert, Button, Card, EmptyState, Field, FilterBar, Input, MenuItem, Modal,
  PageHeader, ReasonModal, RescheduleBadge, RowMenu, Select, Spinner,
  StatusBadge, Table, Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/** Lifecycle order — the filter reads the way an appointment travels. */
const STATUS_OPTIONS: ApptStatus[] = [
  'pending', 'confirmed', 'completed', 'cancelled', 'no_show',
];

/** Which reason-requiring transition the modal is currently collecting for. */
type ReasonTarget = { appt: Appointment; kind: 'cancelled' | 'no_show' } | null;

/** Who ended the appointment, in the words staff use for it. */
const CANCELLED_BY_LABEL: Record<string, string> = {
  patient: 'By patient',
  practice: 'By clinic',
  unknown: 'By unknown',
};

export default function AdminAppointments() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget>(null);
  const [noteTarget, setNoteTarget] = useState<Appointment | null>(null);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState(false);
  /** Which row has a request in flight, so only its button shows a spinner. */
  const [busyId, setBusyId] = useState<number | null>(null);

  // A hand-edited ?status=foo would come back from the server as a 400. Only a
  // real status survives; anything else reads as "no status filter".
  const rawStatus = params.get('status') || '';
  const status = (STATUS_OPTIONS as string[]).includes(rawStatus)
    ? (rawStatus as ApptStatus)
    : '';
  const doctorId = params.get('doctor_id') || '';
  const locationId = params.get('location_id') || '';
  const from = params.get('from') || '';
  const to = params.get('to') || '';

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Replace rather than push: a filter change is a refinement of the same
    // view, and Back should leave the page, not walk every dropdown twiddle.
    setParams(next, { replace: true });
  }

  useEffect(() => {
    Promise.all([adminListDoctors(), adminListLocations()])
      .then(([d, l]) => {
        setDoctors(d.doctors);
        setLocations(l.locations);
      })
      .catch(() => {
        // The filter dropdowns degrade to "all" if this fails; the table below
        // is the page and it loads on its own.
      });
  }, []);

  const load = useCallback(async () => {
    setAppointments(null);
    try {
      const data = await adminListAppointments({
        status,
        doctor_id: doctorId,
        location_id: locationId,
        from,
        to,
      });
      setAppointments(data.appointments);
      setError('');
    } catch (err) {
      setError((err as Error).message);
      setAppointments([]);
    }
  }, [status, doctorId, locationId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  /** Every lifecycle move goes through here so one place owns the reload. */
  async function move(appt: Appointment, next: ApptStatus, reason?: string) {
    setBusyId(appt.id);
    try {
      await adminSetAppointmentStatus(appt.id, next, reason);
      return true;
    } catch (err) {
      toast((err as Error).message, 'error');
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function approve(appt: Appointment) {
    if (await move(appt, 'confirmed')) {
      toast(`Approved — ${appt.patient_name} is confirmed with ${appt.doctor_name}.`, 'success');
      load();
    }
  }

  async function complete(appt: Appointment) {
    if (await move(appt, 'completed')) {
      toast(`Visit with ${appt.patient_name} recorded as completed.`, 'success');
      load();
    }
  }

  async function submitReason(reason: string) {
    if (!reasonTarget) return;
    const { appt, kind } = reasonTarget;
    setBusy(true);
    const ok = await move(appt, kind, reason);
    setBusy(false);
    if (!ok) return;
    toast(
      kind === 'cancelled'
        ? `Appointment for ${appt.patient_name} cancelled.`
        : `${appt.patient_name} recorded as not attending.`,
      'success'
    );
    setReasonTarget(null);
    load();
  }

  function openNote(appt: Appointment) {
    setNoteTarget(appt);
    setNoteText(appt.notes || '');
  }

  async function saveNote() {
    if (!noteTarget) return;
    setBusy(true);
    try {
      await adminSaveAppointmentNote(noteTarget.id, noteText.trim());
      toast(`Note saved for ${noteTarget.patient_name}.`, 'success');
      setNoteTarget(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const emptyTitle =
    status === 'pending'
      ? 'Nothing is waiting for approval'
      : 'No appointments match these filters';

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Approve incoming requests, then record how each visit ended."
      />

      <Card className="mb-4">
        <FilterBar>
          <Field label="Status" htmlFor="f-status" className="mb-0">
            <Select
              id="f-status"
              value={status}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STAFF_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Physician" htmlFor="f-doctor" className="mb-0">
            <Select
              id="f-doctor"
              value={doctorId}
              onChange={(e) => setFilter('doctor_id', e.target.value)}
            >
              <option value="">All physicians</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Location" htmlFor="f-location" className="mb-0">
            <Select
              id="f-location"
              value={locationId}
              onChange={(e) => setFilter('location_id', e.target.value)}
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="From" htmlFor="f-from" className="mb-0">
            <Input
              id="f-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFilter('from', e.target.value)}
            />
          </Field>

          <Field label="To" htmlFor="f-to" className="mb-0">
            <Input
              id="f-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setFilter('to', e.target.value)}
            />
          </Field>
        </FilterBar>
      </Card>

      <Card>
        {error && <Alert tone="error">{error}</Alert>}
        {!appointments && !error && <Spinner />}
        {appointments && appointments.length === 0 && !error && (
          <EmptyState icon={Calendar} title={emptyTitle}>
            {status === 'pending'
              ? 'Every request has been dealt with. New bookings will land here.'
              : 'Try widening the date range or clearing a filter.'}
          </EmptyState>
        )}
        {appointments && appointments.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Physician</Th>
                <Th>Location</Th>
                <Th>Date &amp; time</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <div className="font-semibold text-slate-900">{a.patient_name}</div>
                    <div className="text-xs text-slate-500">{a.patient_email}</div>
                  </Td>
                  <Td>
                    <div className="text-slate-900">{a.doctor_name}</div>
                    <div className="text-xs text-slate-500">{a.specialty_name || ''}</div>
                  </Td>
                  <Td className="text-slate-500">{a.location_name || '—'}</Td>
                  <Td className="whitespace-nowrap">
                    <div className="text-slate-900">{formatDate(a.appt_date)}</div>
                    <div className="text-xs text-slate-500">{formatTime(a.appt_time)}</div>
                  </Td>
                  <Td className="text-slate-500">{a.reason || '—'}</Td>
                  <Td>
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={a.status} variant="staff" />
                      {a.reschedule_required && <RescheduleBadge />}
                      {a.cancel_reason && (
                        <span className="text-xs text-slate-500">
                          {a.cancelled_by && CANCELLED_BY_LABEL[a.cancelled_by]
                            ? `${CANCELLED_BY_LABEL[a.cancelled_by]} · `
                            : ''}
                          {a.cancel_reason}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      {a.status === 'pending' && (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={Check}
                          loading={busyId === a.id}
                          onClick={() => approve(a)}
                        >
                          Approve
                        </Button>
                      )}
                      {a.status === 'confirmed' && (
                        <Button
                          size="sm"
                          loading={busyId === a.id}
                          onClick={() => complete(a)}
                        >
                          Complete
                        </Button>
                      )}
                      <RowMenu label={`Actions for ${a.patient_name}`}>
                        <MenuItem icon={FileText} onClick={() => openNote(a)}>
                          {a.notes ? 'Edit note' : 'Record note'}
                        </MenuItem>
                        {a.status === 'confirmed' && (
                          <MenuItem
                            onClick={() => setReasonTarget({ appt: a, kind: 'no_show' })}
                          >
                            Mark as didn't attend
                          </MenuItem>
                        )}
                        {(a.status === 'pending' || a.status === 'confirmed') && (
                          <MenuItem
                            danger
                            onClick={() => setReasonTarget({ appt: a, kind: 'cancelled' })}
                          >
                            Cancel appointment
                          </MenuItem>
                        )}
                      </RowMenu>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ReasonModal
        open={!!reasonTarget}
        busy={busy}
        title={
          reasonTarget?.kind === 'no_show' ? 'Record a missed appointment' : 'Cancel appointment'
        }
        presets={reasonTarget?.kind === 'no_show' ? NO_SHOW_REASONS : PRACTICE_CANCEL_REASONS}
        confirmLabel={
          reasonTarget?.kind === 'no_show' ? 'Record as missed' : 'Cancel appointment'
        }
        dismissLabel={reasonTarget?.kind === 'no_show' ? 'Go back' : 'Keep appointment'}
        intro={
          reasonTarget && (
            <p>
              {reasonTarget.appt.patient_name} with {reasonTarget.appt.doctor_name} on{' '}
              {formatDate(reasonTarget.appt.appt_date)} at{' '}
              {formatTime(reasonTarget.appt.appt_time)}.
              {reasonTarget.kind === 'cancelled' && ' This cannot be undone.'}
            </p>
          )
        }
        onCancel={() => setReasonTarget(null)}
        onConfirm={submitReason}
      />

      <Modal
        open={!!noteTarget}
        title={noteTarget?.notes ? 'Edit visit note' : 'Record visit note'}
        onClose={() => setNoteTarget(null)}
        footer={
          <>
            <Button onClick={() => setNoteTarget(null)}>Discard</Button>
            <Button variant="primary" loading={busy} onClick={saveNote}>
              Save note
            </Button>
          </>
        }
      >
        {noteTarget && (
          <p className="mb-4 text-sm text-slate-600">
            {noteTarget.patient_name} with {noteTarget.doctor_name} on{' '}
            {formatDate(noteTarget.appt_date)} at {formatTime(noteTarget.appt_time)}.
          </p>
        )}
        <Field
          label="Visit note"
          htmlFor="visit-note"
          className="mb-0"
          hint="Staff-only. Patients never see visit notes."
        >
          <Textarea
            id="visit-note"
            value={noteText}
            placeholder="What was dealt with, and anything the next visit needs to know."
            onChange={(e) => setNoteText(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
