/**
 * Admin Appointments — the approval queue and the clinic day book (A1, B12).
 *
 * A booking now arrives as a *request*, so the job this page exists for is
 * working the pending list. Approve is therefore the only primary-weight
 * button in the table, and it is the first thing on a pending row. Approving is
 * not the only thing an administrator may do with a request, though, so every
 * pending row carries the two other outcomes — move it, or turn it down —
 * behind the row menu rather than leaving staff to cancel-and-rebook by hand.
 *
 * Actions are drawn from the appointment's own status rather than offered
 * unconditionally: the server rejects an illegal transition, and a button that
 * exists only to produce a 409 is a button that teaches staff to distrust the
 * screen. Non-attendance is additionally gated on the clock, because the server
 * refuses it before the slot has started — it is shown disabled with the time
 * it becomes available rather than hidden, so nobody hunts for a missing item.
 *
 * Filters live in the query string rather than in component state. The
 * Overview dashboard links straight here with ?status=pending, and a scheduler
 * who has narrowed to one site and one week can bookmark or send that view.
 *
 * The table is paged in the browser over rows it already holds. The server
 * hands back the whole filtered range in one response and `useSort` orders it,
 * so paging here costs nothing and a page change is instant; asking the server
 * to re-slice data the browser is already holding would only add a wait.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Ban, Calendar, CalendarClock, Check, FileText, Info, MapPin, UserX,
} from 'lucide-react';
import {
  adminListAppointments, adminListDoctors, adminListLocations,
  adminRescheduleAppointment, adminSaveAppointmentNote, adminSetAppointmentStatus,
  apptHasStarted, formatDate, formatTime, getAvailability, todayStr,
  NO_SHOW_REASONS, PRACTICE_CANCEL_REASONS, STAFF_STATUS_LABEL, STATUS_TONE,
  type Appointment, type ApptStatus, type Doctor, type Location, type Slot,
  type Tone,
} from '../../lib/api';
import {
  Alert, Button, Card, EmptyState, Field, FilterBar, Input, MenuItem, Modal,
  PageHeader, ReasonModal, RescheduleBadge, RowMenu, Select, SlotButton,
  SortableTh, Spinner, StatusBadge, Table, Tabs, Td, Textarea, Th, TruncatedText, cx,
  useSort,
} from '../../components/ui';
import MonthGrid, { startOfMonth } from '../../components/MonthGrid';
import { useToast } from '../../components/Toast';

/** Lifecycle order — the filter reads the way an appointment travels. */
const STATUS_OPTIONS: ApptStatus[] = [
  'pending', 'confirmed', 'completed', 'cancelled', 'no_show',
];

/**
 * Rows per page. A clinic month is hundreds of appointments and the browser
 * holds all of them; this is about what a reader can take in at once, not about
 * what the machine can render.
 */
const PAGE_SIZE = 25;

/**
 * How many requests the approval card shows before handing off to the table.
 *
 * A screenful. The card exists to say "this needs you now"; past that it stops
 * being a prompt and becomes a second, worse copy of the table below it.
 */
const QUEUE_PREVIEW = 6;

/**
 * How much free text a cell shows before it becomes a link to the whole thing.
 * Short enough that every row is one line tall whatever the patient wrote —
 * a paragraph in one cell is what drags the whole row six lines deep and pushes
 * the columns either side of it out of shape.
 */
const REASON_LIMIT = 40;

/**
 * Which reason-requiring transition the modal is currently collecting for.
 *
 * `declined` and `cancelled` are the same server transition and differ only in
 * what the administrator is doing: turning down a request that was never
 * accepted is not the same act as calling off a confirmed visit, and the dialog
 * should not pretend otherwise.
 */
type ReasonKind = 'cancelled' | 'no_show' | 'declined';

type ReasonTarget = { appt: Appointment; kind: ReasonKind } | null;

/** Who ended the appointment, in the words staff use for it. */
const CANCELLED_BY_LABEL: Record<string, string> = {
  patient: 'By patient',
  practice: 'By clinic',
  unknown: 'By unknown',
};

/**
 * Slots for one day, split by site — the same grouping the patient's own
 * reschedule picker uses, and for the same reason: a physician's Monday clinic
 * and their Thursday clinic can be in different buildings, so a bare list of
 * times would have staff booking someone into the wrong building.
 */
function groupByLocation(slots: Slot[]): { id: number; name: string; times: Slot[] }[] {
  const groups: { id: number; name: string; times: Slot[] }[] = [];
  for (const s of slots) {
    const found = groups.find((g) => g.id === s.location_id);
    if (found) found.times.push(s);
    else groups.push({ id: s.location_id, name: s.location_name, times: [s] });
  }
  return groups;
}

/** Chip paint per tone, matching ui.tsx's badge tones pair for pair. */
const CHIP_TONE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-accent-50 text-accent-700',
};

/** Lifecycle order, so the key reads the way an appointment travels. */
const LEGEND: ApptStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

/** How many chips a cell shows before the rest collapse into "+n more". */
const MAX_CHIPS = 3;

/** 'Dr. Sarah Kim' -> 'Kim'. A chip has room for one word. */
function surname(name: string): string {
  const words = (name || '')
    .split(/\s+/)
    .filter((w) => w && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w));
  return words.length ? words[words.length - 1] : name;
}

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
  const [page, setPage] = useState(1);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  /** The day whose full list is open from the calendar. */
  const [dayKey, setDayKey] = useState<string | null>(null);

  // Reschedule dialog. `slots === null` is "still asking", not "none open" —
  // the two say very different things to whoever is on the phone.
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);
  const [newDate, setNewDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [modalError, setModalError] = useState('');

  // A hand-edited ?status=foo would come back from the server as a 400. Only a
  // real status survives; anything else reads as "no status filter".
  const rawStatus = params.get('status') || '';
  const status = (STATUS_OPTIONS as string[]).includes(rawStatus)
    ? (rawStatus as ApptStatus)
    : '';
  // Anything other than 'calendar' is the list, so a hand-edited ?view=grid
  // lands somewhere sensible rather than on a blank page.
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
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

  async function submitReason(reason: string) {
    if (!reasonTarget) return;
    const { appt, kind } = reasonTarget;
    setBusy(true);
    // Declining a request and cancelling a visit are one transition to the
    // server; only the wording around it differs.
    const ok = await move(appt, kind === 'no_show' ? 'no_show' : 'cancelled', reason);
    setBusy(false);
    if (!ok) return;
    toast(
      kind === 'no_show'
        ? `${appt.patient_name} recorded as not attending.`
        : kind === 'declined'
          ? `Request from ${appt.patient_name} declined — they have been told why.`
          : `Appointment for ${appt.patient_name} cancelled.`,
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

  // ---------------------------------------------------------------------
  // Reschedule
  // ---------------------------------------------------------------------

  const loadSlots = useCallback(async (forDoctor: number, date: string) => {
    setNewDate(date);
    setSlot(null);
    setSlots(null);
    if (!date) return;
    try {
      const data = await getAvailability(forDoctor, date);
      setSlots(data.slots);
    } catch (err) {
      setModalError((err as Error).message);
      setSlots([]);
    }
  }, []);

  const openReschedule = useCallback(
    (appt: Appointment) => {
      setRescheduling(appt);
      setModalError('');
      // Start on the day they already have, unless it has gone by: most moves
      // are "same week, different hour", not "some time next month".
      loadSlots(appt.doctor_id, appt.appt_date >= todayStr() ? appt.appt_date : todayStr());
    },
    [loadSlots]
  );

  async function submitReschedule() {
    if (!rescheduling || !slot) return;
    setBusy(true);
    setModalError('');
    try {
      await adminRescheduleAppointment(rescheduling.id, newDate, slot.time);
      toast(
        `${rescheduling.patient_name} moved to ${formatDate(newDate)} at ${formatTime(slot.time)} — awaiting approval.`,
        'success'
      );
      setRescheduling(null);
      load();
    } catch (err) {
      // The case worth designing for is the 409: somebody took that slot
      // between the availability call and this one. `api()` surfaces the
      // server's sentence but not its status, so every failure is handled the
      // way a 409 has to be — say what happened, re-read the day, and leave the
      // dialog open on the slot list rather than throwing the work away.
      setModalError((err as Error).message);
      loadSlots(rescheduling.doctor_id, newDate);
    } finally {
      setBusy(false);
    }
  }

  const slotGroups = useMemo(() => groupByLocation(slots || []), [slots]);

  // ---------------------------------------------------------------------
  // Derived rows
  // ---------------------------------------------------------------------

  const emptyTitle =
    status === 'pending'
      ? 'Nothing is waiting for approval'
      : 'No appointments match these filters';

  // The queue is drawn from the rows already on screen, so it always agrees
  // with the table beneath it. Sorted soonest-first: the request that needs a
  // decision most urgently is the one whose date arrives first.
  const awaiting = useMemo(
    () =>
      (appointments || [])
        .filter((a) => a.status === 'pending')
        .sort((x, y) =>
          x.appt_date === y.appt_date
            ? x.appt_time.localeCompare(y.appt_time)
            : x.appt_date.localeCompare(y.appt_date)
        ),
    [appointments]
  );

  const { rows: sorted, sort } = useSort<Appointment>(
    appointments || [],
    'appt_date',
    'asc'
  );

  // Narrowing or reordering the list invalidates where the reader was standing
  // in it: page 9 of a two-page result is a blank table with no way back.
  useEffect(() => {
    setPage(1);
  }, [status, doctorId, locationId, from, to, sort.key, sort.dir]);

  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Clamped on read as well as reset on change: approving the last request on
  // the last page shortens the list under a reader who is standing on it, and
  // that shortening happens on a reload rather than on a filter change.
  const current = Math.min(page, pageCount);
  const firstRow = total === 0 ? 0 : (current - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(current * PAGE_SIZE, total);
  const visible = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const today = todayStr();

  /**
   * The filtered set bucketed by day, each bucket in clock order.
   *
   * Built from `appointments` rather than the paged `visible` slice: a calendar
   * showing only page one of a month would be a lie about how full the practice
   * is, which is the single question the view exists to answer.
   */
  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments || []) {
      const key = a.appt_date.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    for (const bucket of map.values()) {
      bucket.sort((x, y) => x.appt_time.localeCompare(y.appt_time));
    }
    return map;
  }, [appointments]);

  const dayList = dayKey ? byDate.get(dayKey) || [] : [];

  /**
   * The actions one row offers, from its status and the clock.
   *
   * Shared by the queue and the table so the two can never drift into offering
   * an administrator different powers over the same appointment.
   */
  function rowActions(a: Appointment) {
    const started = apptHasStarted(a);
    const notYet = `Available from ${formatTime(a.appt_time)} on ${formatDate(a.appt_date)}.`;
    return (
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
        <RowMenu label={`Actions for ${a.patient_name}`}>
          {(a.status === 'pending' || a.status === 'confirmed') && (
            <MenuItem icon={CalendarClock} onClick={() => openReschedule(a)}>
              Reschedule
            </MenuItem>
          )}
          {a.status === 'confirmed' && (
            <MenuItem
              icon={UserX}
              disabled={!started}
              title={started ? undefined : notYet}
              onClick={() => setReasonTarget({ appt: a, kind: 'no_show' })}
            >
              Mark as didn't attend
            </MenuItem>
          )}
          {a.status !== 'pending' && (
            <MenuItem icon={FileText} onClick={() => openNote(a)}>
              {a.notes ? 'Edit note' : 'Record note'}
            </MenuItem>
          )}
          {a.status === 'pending' && (
            <MenuItem
              danger
              icon={Ban}
              onClick={() => setReasonTarget({ appt: a, kind: 'declined' })}
            >
              Decline request
            </MenuItem>
          )}
          {a.status === 'confirmed' && (
            <MenuItem
              danger
              icon={Ban}
              onClick={() => setReasonTarget({ appt: a, kind: 'cancelled' })}
            >
              Cancel appointment
            </MenuItem>
          )}
        </RowMenu>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Approve incoming requests, then record how each visit ended."
      />

      {/*
        An appointment only leaves `pending` when an administrator approves it,
        so this queue is the job this screen exists for. It sits above the
        filters because burying it behind one would mean the clinic's only
        blocking task is the thing staff have to go looking for.

        Deliberately not paged, unlike the table below: this is a work list, and
        a work list that hides its tail is a work list that reads as finished.
      */}
      {appointments && (
        <Card
          className={cx(
            'mb-4',
            awaiting.length > 0 && 'border-amber-300 bg-amber-50/60'
          )}
          title={
            awaiting.length > 0
              ? `${awaiting.length} ${awaiting.length === 1 ? 'request needs' : 'requests need'} approval`
              : 'Nothing is waiting for approval'
          }
        >
          {awaiting.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-slate-600">
              Every request in this view has been dealt with. New bookings arrive here.
            </p>
          ) : (
            <ul className="divide-y divide-amber-200/70">
              {awaiting.slice(0, QUEUE_PREVIEW).map((a) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/admin/patients/${a.patient_id}`}
                      className="font-semibold text-slate-900 underline-offset-2 hover:text-accent-700 hover:underline"
                    >
                      {a.patient_name}
                    </Link>
                    <div className="text-xs text-slate-600">
                      {formatDate(a.appt_date)} at {formatTime(a.appt_time)} ·{' '}
                      <Link
                        to={`/admin/physicians/${a.doctor_id}`}
                        className="font-medium text-accent-600 hover:underline"
                      >
                        {a.doctor_name}
                      </Link>
                      {a.location_name ? ` · ${a.location_name}` : ''}
                    </div>
                    {a.reason && (
                      <div className="truncate text-xs text-slate-500">{a.reason}</div>
                    )}
                  </div>
                  {rowActions(a)}
                </li>
              ))}
              {/* The queue is a work list, not the whole book. Past a screenful
                  it stops being scannable, so the rest are handed to the table
                  below — which filters, sorts and pages — rather than turned
                  into an endless card. */}
              {awaiting.length > QUEUE_PREVIEW && (
                <li className="px-4 py-3 text-sm text-slate-600">
                  {awaiting.length - QUEUE_PREVIEW} more{' '}
                  {awaiting.length - QUEUE_PREVIEW === 1 ? 'request is' : 'requests are'} waiting.{' '}
                  <button
                    type="button"
                    onClick={() => setFilter('status', 'pending')}
                    className="font-semibold text-accent-600 underline-offset-2 hover:underline"
                  >
                    Show them all below
                  </button>
                </li>
              )}
            </ul>
          )}
        </Card>
      )}

      {/* The table answers "what needs doing"; the calendar answers "how full
          is the practice". Both read the same filtered set, so switching view
          never changes which appointments are in scope. */}
      <div className="mb-4 flex items-center gap-2">
        <Tabs
          tabs={[
            { id: 'list', label: 'List' },
            { id: 'calendar', label: 'Calendar' },
          ]}
          active={view}
          onChange={(id: string) => setFilter('view', id === 'calendar' ? 'calendar' : '')}
        />
      </div>

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

      {view === 'calendar' && appointments && appointments.length > 0 && (
        <MonthGrid
          month={month}
          onMonthChange={setMonth}
          today={today}
          legend={LEGEND.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <span
                className={cx('h-3 w-5 rounded', CHIP_TONE[STATUS_TONE[s]])}
                aria-hidden="true"
              />
              {STAFF_STATUS_LABEL[s]}
            </span>
          ))}
          renderDay={(key: string) => {
            const day = byDate.get(key) || [];
            // One over the cap is drawn in full: "+1 more" costs exactly the
            // line the chip it hides would have occupied.
            const shown = day.length <= MAX_CHIPS + 1 ? day : day.slice(0, MAX_CHIPS);
            const hidden = day.length - shown.length;
            return (
              <>
                {shown.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setDayKey(key)}
                    title={`${formatTime(a.appt_time)} · ${a.patient_name} · ${a.doctor_name} · ${
                      STAFF_STATUS_LABEL[a.status]
                    }`}
                    className={cx(
                      'block w-full truncate rounded px-1.5 py-1 text-left text-[0.6875rem] font-semibold leading-tight hover:ring-1 hover:ring-inset hover:ring-slate-400',
                      CHIP_TONE[STATUS_TONE[a.status]],
                      a.status === 'cancelled' && 'line-through'
                    )}
                  >
                    {formatTime(a.appt_time)} {surname(a.doctor_name)}
                  </button>
                ))}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setDayKey(key)}
                    className="px-1.5 text-left text-[0.6875rem] font-semibold text-slate-500 hover:text-slate-900"
                  >
                    +{hidden} more
                  </button>
                )}
              </>
            );
          }}
        />
      )}

      <Card className={cx(view === 'calendar' && 'hidden')}>
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
          <>
            <Table>
              <thead>
                <tr>
                  <SortableTh sortKey="patient_name" sort={sort}>Patient</SortableTh>
                  <SortableTh sortKey="doctor_name" sort={sort}>Physician</SortableTh>
                  <SortableTh sortKey="location_name" sort={sort}>Location</SortableTh>
                  <SortableTh sortKey="appt_date" sort={sort}>Date &amp; time</SortableTh>
                  <Th>Reason</Th>
                  <SortableTh sortKey="status" sort={sort}>Status</SortableTh>
                  {/* `fit` is the whole point of this column: it sizes to its
                      buttons and never wraps, so the table can never balance
                      itself by taking width off the one cell a row is actually
                      used through. Anything the table still needs beyond the
                      panel is scrolled for inside <Table>'s own container. */}
                  <Th align="right" fit>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      {/* The name is the way through to the person: who else
                          they have seen, and what else is on their book. */}
                      <Link
                        to={`/admin/patients/${a.patient_id}`}
                        className="font-semibold text-slate-900 underline-offset-2 hover:text-accent-700 hover:underline"
                      >
                        {a.patient_name}
                      </Link>
                      {/* Capped and ellipsised rather than shown in full: an
                          address is here to tell two same-named patients apart,
                          and at full width it was the widest thing in the table
                          — enough on its own to push the action column off the
                          panel. The full value is in the title. */}
                      <div
                        className="max-w-[11rem] truncate text-xs text-slate-500"
                        title={a.patient_email}
                      >
                        {a.patient_email}
                      </div>
                    </Td>
                    <Td>
                      <Link
                        to={`/admin/physicians/${a.doctor_id}`}
                        className="font-medium text-accent-600 hover:underline"
                      >
                        {a.doctor_name}
                      </Link>
                      <div className="text-xs text-slate-500">{a.specialty_name || ''}</div>
                    </Td>
                    <Td className="text-slate-500">{a.location_name || '—'}</Td>
                    <Td className="whitespace-nowrap">
                      <div className="text-slate-900">{formatDate(a.appt_date)}</div>
                      <div className="text-xs text-slate-500">{formatTime(a.appt_time)}</div>
                    </Td>
                    <Td className="text-slate-500">
                      <TruncatedText
                        text={a.reason}
                        limit={REASON_LIMIT}
                        title="Reason for visit"
                      />
                    </Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={a.status} variant="staff" />
                        {a.reschedule_required && <RescheduleBadge />}
                        {a.cancel_reason && (
                          <div className="text-xs text-slate-500">
                            {a.cancelled_by && CANCELLED_BY_LABEL[a.cancelled_by]
                              ? `${CANCELLED_BY_LABEL[a.cancelled_by]} · `
                              : ''}
                            <TruncatedText
                              text={a.cancel_reason}
                              limit={REASON_LIMIT}
                              title="Cancellation reason"
                            />
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td align="right" fit>{rowActions(a)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>

            {/* Say what is not on screen. A silently truncated table reads as
                "that is all of them", which is how a scheduler concludes a
                booking was never made. */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>
                Showing {firstRow}–{lastRow} of {total}{' '}
                {total === 1 ? 'appointment' : 'appointments'}
              </span>
              <span className="flex gap-2">
                <Button size="sm" disabled={current <= 1} onClick={() => setPage(current - 1)}>
                  Previous
                </Button>
                <Button
                  size="sm"
                  disabled={current >= pageCount}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </Button>
              </span>
            </div>
          </>
        )}
      </Card>

      {/* One day's book, opened from a calendar cell. Read-only on purpose:
          the actions live on the table row, and duplicating them here would
          mean two places to keep the transition rules honest. */}
      <Modal
        open={dayKey !== null}
        title={dayKey ? formatDate(dayKey) : 'Day'}
        onClose={() => setDayKey(null)}
        size="sm"
        footer={<Button onClick={() => setDayKey(null)}>Close</Button>}
      >
        {dayList.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing booked on this day.</p>
        ) : (
          <ul className="-my-1 divide-y divide-slate-100">
            {dayList.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="w-20 flex-none text-sm font-semibold tabular-nums text-slate-900">
                  {formatTime(a.appt_time)}
                </span>
                <span className="min-w-0 flex-1">
                  <Link
                    to={`/admin/patients/${a.patient_id}`}
                    onClick={() => setDayKey(null)}
                    className="block truncate text-sm font-semibold text-slate-900 underline-offset-2 hover:text-accent-700 hover:underline"
                  >
                    {a.patient_name}
                  </Link>
                  <span className="block truncate text-xs text-slate-500">
                    {a.doctor_name}
                    {a.location_name ? ` · ${a.location_name}` : ''}
                  </span>
                </span>
                <StatusBadge status={a.status} variant="staff" />
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <ReasonModal
        open={!!reasonTarget}
        busy={busy}
        title={
          reasonTarget?.kind === 'no_show'
            ? 'Record a missed appointment'
            : reasonTarget?.kind === 'declined'
              ? 'Decline request'
              : 'Cancel appointment'
        }
        presets={reasonTarget?.kind === 'no_show' ? NO_SHOW_REASONS : PRACTICE_CANCEL_REASONS}
        confirmLabel={
          reasonTarget?.kind === 'no_show'
            ? 'Record as missed'
            : reasonTarget?.kind === 'declined'
              ? 'Decline request'
              : 'Cancel appointment'
        }
        dismissLabel={
          reasonTarget?.kind === 'no_show'
            ? 'Go back'
            : reasonTarget?.kind === 'declined'
              ? 'Keep request'
              : 'Keep appointment'
        }
        intro={
          reasonTarget && (
            <p>
              {reasonTarget.appt.patient_name} with {reasonTarget.appt.doctor_name} on{' '}
              {formatDate(reasonTarget.appt.appt_date)} at{' '}
              {formatTime(reasonTarget.appt.appt_time)}.
              {reasonTarget.kind === 'declined' &&
                ' The patient is told the request was turned down, and why.'}
              {reasonTarget.kind === 'cancelled' && ' This cannot be undone.'}
            </p>
          )
        }
        onCancel={() => setReasonTarget(null)}
        onConfirm={submitReason}
      />

      <Modal
        open={!!rescheduling}
        title="Reschedule appointment"
        onClose={() => setRescheduling(null)}
        footer={
          <>
            <Button onClick={() => setRescheduling(null)}>Keep current time</Button>
            <Button variant="primary" disabled={!slot} loading={busy} onClick={submitReschedule}>
              Move appointment
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
              Moving <strong>{rescheduling.patient_name}</strong> with{' '}
              <strong>{rescheduling.doctor_name}</strong>, currently{' '}
              <strong>{formatDate(rescheduling.appt_date)}</strong> at{' '}
              <strong>{formatTime(rescheduling.appt_time)}</strong>
              {rescheduling.location_name ? `, ${rescheduling.location_name}` : ''}.
            </p>

            <Alert tone="info" icon={Info} className="mb-4">
              The moved booking re-enters the approval queue as a new request, and the patient is
              notified of the change.
            </Alert>

            <Field label="New date" htmlFor="r-date">
              <Input
                type="date"
                id="r-date"
                min={todayStr()}
                value={newDate}
                onChange={(e) => loadSlots(rescheduling.doctor_id, e.target.value)}
              />
            </Field>

            <Field label="Open times" className="mb-0">
              {!newDate && <p className="text-sm text-slate-500">Pick a date to see open times.</p>}
              {newDate && slots === null && <Spinner label="Checking availability…" />}
              {newDate && slots && slots.length === 0 && (
                <p className="text-sm text-slate-500">
                  No open times on this date — {rescheduling.doctor_name} may be away or fully
                  booked. Try another day.
                </p>
              )}
              {slotGroups.map((g) => (
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
                  <strong>{formatDate(newDate)}</strong> at <strong>{slot.location_name}</strong>.
                </p>
              )}
            </Field>
          </>
        )}
      </Modal>

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
