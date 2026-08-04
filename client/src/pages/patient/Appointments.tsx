/**
 * My appointments.
 *
 * A booking has one lifecycle here — requested, confirmed, then kept or missed
 * — so the patient has exactly two levers on a live appointment: move it, or
 * drop it. Both are honest about what happens next, because neither is settled
 * until the clinic says so.
 *
 * Visit notes are not on this page. They are the physician's clinical record of
 * what happened, written for the practice, and the patient API no longer
 * returns them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CalendarPlus, Info, MapPin } from 'lucide-react';
import {
  PATIENT_CANCEL_REASONS, cancelAppointment, formatDate, formatTime,
  getAvailability, isOpen, listMyAppointments, rescheduleAppointment, todayStr,
  type Appointment, type Slot,
} from '../../lib/api';
import {
  Alert, Button, Card, EmptyState, Field, Input, Modal, PageHeader, ReasonModal,
  RescheduleBadge, SlotButton, Spinner, StatusBadge, Table, Tabs, Td, Th,
  buttonClasses,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

type Filter = 'all' | 'upcoming' | 'pending' | 'past';

const TAB_LABEL: Record<Filter, string> = {
  all: 'All',
  upcoming: 'Upcoming',
  pending: 'Pending',
  past: 'Past',
};

/** Live and still ahead of them. An open booking whose date has gone by is the
    practice's to close out, so it reads as past to the patient. */
function isUpcoming(a: Appointment, today: string): boolean {
  return isOpen(a.status) && a.appt_date >= today;
}

function matches(a: Appointment, filter: Filter, today: string): boolean {
  if (filter === 'upcoming') return isUpcoming(a, today);
  if (filter === 'pending') return a.status === 'pending';
  if (filter === 'past') return !isUpcoming(a, today);
  return true;
}

/** Slots for one day, split by site — see the same note in Doctors.tsx. */
function groupByLocation(slots: Slot[]): { id: number; name: string; times: Slot[] }[] {
  const groups: { id: number; name: string; times: Slot[] }[] = [];
  for (const s of slots) {
    const found = groups.find((g) => g.id === s.location_id);
    if (found) found.times.push(s);
    else groups.push({ id: s.location_id, name: s.location_name, times: [s] });
  }
  return groups;
}

export default function Appointments() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState('');

  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMyAppointments()
      .then((d) => {
        setAppointments(d.appointments);
        setError('');
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  const loadSlots = useCallback(async (doctorId: number, newDate: string) => {
    setDate(newDate);
    setSlot(null);
    setSlots(null);
    if (!newDate) return;
    try {
      const d = await getAvailability(doctorId, newDate);
      setSlots(d.slots);
    } catch (err) {
      setModalError((err as Error).message);
      setSlots([]);
    }
  }, []);

  const openReschedule = useCallback(
    (a: Appointment) => {
      setRescheduling(a);
      setModalError('');
      // Start on the day they already had, unless it has passed — the point of
      // a reschedule is usually "same week, different hour".
      const start = a.appt_date >= todayStr() ? a.appt_date : todayStr();
      loadSlots(a.doctor_id, start);
    },
    [loadSlots]
  );

  // The dashboard's "needs a new time" callout links straight in here with the
  // appointment id, so the patient lands on the picker rather than on a list
  // they have to search. The parameter is consumed on arrival, or a refresh
  // would re-open the dialog they just closed.
  const requestedId = params.get('reschedule');
  useEffect(() => {
    if (!requestedId || !appointments) return;
    const target = appointments.find((a) => String(a.id) === requestedId && isOpen(a.status));
    setParams({}, { replace: true });
    if (target) openReschedule(target);
  }, [requestedId, appointments, setParams, openReschedule]);

  const all = appointments || [];
  const today = todayStr();
  const visible = all.filter((a) => matches(a, filter, today));
  const tabs = (Object.keys(TAB_LABEL) as Filter[]).map((f) => ({
    id: f,
    label: TAB_LABEL[f],
    count: appointments ? all.filter((a) => matches(a, f, today)).length : undefined,
  }));

  async function submitReschedule() {
    if (!rescheduling || !slot) return;
    setBusy(true);
    setModalError('');
    try {
      await rescheduleAppointment(rescheduling.id, date, slot.time);
      setRescheduling(null);
      toast('New time requested — the clinic will confirm it.', 'success');
      load();
    } catch (err) {
      setModalError((err as Error).message);
      loadSlots(rescheduling.doctor_id, date);
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel(reason: string) {
    if (!cancelling) return;
    setBusy(true);
    try {
      await cancelAppointment(cancelling.id, reason);
      setCancelling(null);
      toast('Appointment cancelled.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const groups = slots ? groupByLocation(slots) : [];

  return (
    <>
      <PageHeader
        title="My appointments"
        subtitle="Move or cancel a booking, and see where each visit is being held."
        actions={
          <Link to="/app/doctors" className={buttonClasses('primary')}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Book appointment
          </Link>
        }
      />

      <Card className="p-0 sm:p-0">
        <div className="px-4 pt-4 sm:px-6 sm:pt-6">
          <Tabs tabs={tabs} active={filter} onChange={(id) => setFilter(id as Filter)} />
        </div>

        {error && (
          <Alert tone="error" icon={AlertTriangle} className="mx-4 mb-4 sm:mx-6">
            {error}
          </Alert>
        )}
        {!appointments && !error && <Spinner />}
        {appointments && visible.length === 0 && (
          <EmptyState
            icon={CalendarPlus}
            title={filter === 'all' ? 'Nothing booked yet' : `No ${TAB_LABEL[filter].toLowerCase()} appointments`}
            action={
              <Link to="/app/doctors" className={buttonClasses('primary')}>
                Find a doctor
              </Link>
            }
          >
            Choose a physician and a time, and the clinic will confirm it for you.
          </EmptyState>
        )}

        {visible.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Doctor</Th>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Location</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <div className="font-semibold text-slate-900">{a.doctor_name}</div>
                    <div className="text-xs text-slate-500">
                      {a.specialty_name || 'General practice'}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(a.appt_date)}</Td>
                  <Td className="whitespace-nowrap">{formatTime(a.appt_time)}</Td>
                  <Td>
                    <span className="flex items-center gap-1 text-slate-600">
                      <MapPin className="h-3.5 w-3.5 flex-none text-slate-400" aria-hidden="true" />
                      {a.location_name || '—'}
                    </span>
                  </Td>
                  <Td className="text-slate-500">{a.reason || '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={a.status} variant="patient" />
                      {a.reschedule_required && <RescheduleBadge />}
                    </div>
                    {a.cancel_reason && (
                      <div className="mt-1 text-xs text-slate-500">{a.cancel_reason}</div>
                    )}
                  </Td>
                  <Td align="right">
                    {isOpen(a.status) ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        {/* A flagged visit cannot go ahead as booked, so its
                            reschedule stops being an option and becomes the
                            action the row is asking for. */}
                        <Button
                          size="sm"
                          variant={a.reschedule_required ? 'primary' : 'secondary'}
                          onClick={() => openReschedule(a)}
                        >
                          Reschedule
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setCancelling(a)}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!rescheduling}
        title="Reschedule appointment"
        onClose={() => setRescheduling(null)}
        footer={
          <>
            <Button onClick={() => setRescheduling(null)}>Keep current time</Button>
            <Button variant="primary" disabled={!slot} loading={busy} onClick={submitReschedule}>
              {busy ? 'Requesting…' : 'Request new time'}
            </Button>
          </>
        }
      >
        {rescheduling && (
          <>
            {modalError && (
              <Alert tone="error" className="mb-4">
                {modalError}
              </Alert>
            )}

            <p className="mb-4 text-sm text-slate-600">
              Currently <strong>{rescheduling.doctor_name}</strong> on{' '}
              <strong>{formatDate(rescheduling.appt_date)}</strong> at{' '}
              <strong>{formatTime(rescheduling.appt_time)}</strong>
              {rescheduling.location_name ? `, ${rescheduling.location_name}` : ''}.
            </p>

            <Alert tone="info" icon={Info} className="mb-4">
              Confirming releases your current time so someone else can take it. The new time is a
              request — it stays <strong>Pending approval</strong> until the clinic confirms it.
            </Alert>

            <Field label="New date" htmlFor="r-date">
              <Input
                type="date"
                id="r-date"
                min={todayStr()}
                value={date}
                onChange={(e) => loadSlots(rescheduling.doctor_id, e.target.value)}
              />
            </Field>

            <Field label="Available times" className="mb-0">
              {!date && <p className="text-sm text-slate-500">Pick a date to see open times.</p>}
              {date && slots === null && <Spinner label="Checking availability…" />}
              {date && slots && slots.length === 0 && (
                <p className="text-sm text-slate-500">
                  No open times on this date — {rescheduling.doctor_name} may be away or fully
                  booked. Try another day.
                </p>
              )}
              {groups.map((g) => (
                <div key={g.id} className="mb-3 last:mb-0">
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {g.name}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {g.times.map((s) => (
                      <SlotButton
                        key={`${s.location_id}-${s.time}`}
                        selected={slot?.time === s.time && slot?.location_id === s.location_id}
                        onClick={() => setSlot(s)}
                      >
                        {formatTime(s.time)}
                      </SlotButton>
                    ))}
                  </div>
                </div>
              ))}

              {/* The site can change with the time: a doctor's Thursday clinic
                  may be in a different building from their Monday one. */}
              {slot && (
                <p className="mt-3 text-sm text-slate-600">
                  Moving to <strong>{formatTime(slot.time)}</strong> on{' '}
                  <strong>{formatDate(date)}</strong> at <strong>{slot.location_name}</strong>.
                </p>
              )}
            </Field>
          </>
        )}
      </Modal>

      <ReasonModal
        open={!!cancelling}
        busy={busy}
        title="Cancel appointment"
        presets={PATIENT_CANCEL_REASONS}
        confirmLabel="Cancel appointment"
        intro={
          cancelling && (
            <p>
              {cancelling.doctor_name} on {formatDate(cancelling.appt_date)} at{' '}
              {formatTime(cancelling.appt_time)}. This cannot be undone — you would need to request
              a new time. If you only want to move it, close this and choose{' '}
              <strong>Reschedule</strong> instead.
            </p>
          )
        }
        onCancel={() => setCancelling(null)}
        onConfirm={submitCancel}
      />
    </>
  );
}
