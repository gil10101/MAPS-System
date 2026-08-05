/**
 * My appointments.
 *
 * A booking has one lifecycle here — requested, confirmed, then kept or missed
 * — so the patient has exactly two levers on a live appointment: move it, or
 * drop it. Both are honest about what happens next, because neither is settled
 * until the clinic says so.
 *
 * The same bookings are offered two ways. The list answers "what have I got,
 * and what can I do about it"; the month grid answers "when am I free" — a
 * question a list of dates cannot be read for. They are views of one dataset,
 * not two features: the calendar colours a booking from the same STATUS_TONE
 * the list's badge uses, and a chip opens the same reschedule and cancel the
 * row offers. The choice lives in the query string so a refresh, a bookmark or
 * a shared link all land back on the view the patient was reading.
 *
 * Visit notes are not on this page. They are the physician's clinical record of
 * what happened, written for the practice, and the patient API no longer
 * returns them.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Info,
  List, MapPin, type LucideIcon,
} from 'lucide-react';
import {
  PATIENT_CANCEL_REASONS, PATIENT_STATUS_LABEL, STATUS_TONE, WEEKDAYS,
  cancelAppointment, dateToStr, formatDate, formatStamp, formatTime,
  getAvailability, isOpen, listMyAppointments, rescheduleAppointment, todayStr,
  type Appointment, type ApptStatus, type CancelledBy, type Slot, type Tone,
} from '../../lib/api';
import {
  Alert, Avatar, Button, Card, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, ReasonModal, RescheduleBadge, SlotButton, Spinner, StatusBadge,
  Table, Tabs, Td, Th, TruncatedText, buttonClasses, cx,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

type Filter = 'all' | 'upcoming' | 'pending' | 'past';

type View = 'list' | 'calendar';

const TAB_LABEL: Record<Filter, string> = {
  all: 'All',
  upcoming: 'Upcoming',
  pending: 'Pending',
  past: 'Past',
};

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'list', label: 'List', icon: List },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

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

/** Who ended it, said to the person it happened to rather than about them. */
const CANCELLED_BY_LABEL: Record<CancelledBy, string> = {
  patient: 'You cancelled this appointment',
  practice: 'The clinic cancelled this appointment',
  unknown: 'This appointment was cancelled',
};

// ===========================================================================
// Month calendar
// ===========================================================================

/**
 * Chip paint per tone, matching ui.tsx's badge tones pair for pair.
 *
 * Keyed on Tone and looked up through the exported STATUS_TONE rather than on
 * the status itself: a status recoloured for the badges is recoloured here in
 * the same edit, so the grid can never end up telling a different story from
 * the list it sits beside.
 */
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

/**
 * Monday-first column index. Sunday is 6, not −1: `getDay() - 1` is what
 * shifts an entire month a week sideways whenever the 1st falls on a Sunday.
 */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/**
 * The cells a month is drawn from — whole weeks, so the leading and trailing
 * days belong to the neighbouring months. Five rows for a short month, six for
 * a long one, computed rather than fixed at six so February does not hang an
 * empty week off the bottom.
 *
 * `new Date(y, m, 1 - lead + i)` is doing the work: a day-of-month of 0 or less
 * rolls back into the previous month, and one past the end rolls forward, which
 * is the whole of the arithmetic a calendar needs.
 */
function monthGrid(month: Date): Date[] {
  const year = month.getFullYear();
  const index = month.getMonth();
  const lead = mondayIndex(new Date(year, index, 1));
  const length = new Date(year, index + 1, 0).getDate();
  const cells = Math.ceil((lead + length) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => new Date(year, index, 1 - lead + i));
}

/** Bookings bucketed by day, each bucket in clock order. */
function groupByDate(list: Appointment[]): Map<string, Appointment[]> {
  const byDate = new Map<string, Appointment[]>();
  for (const a of list) {
    const key = a.appt_date.slice(0, 10);
    const day = byDate.get(key);
    if (day) day.push(a);
    else byDate.set(key, [a]);
  }
  for (const day of byDate.values()) {
    day.sort((x, y) => x.appt_time.localeCompare(y.appt_time));
  }
  return byDate;
}

/** 'Dr. Sarah Kim' -> 'Kim'. A chip has room for one word, and the surname is
    the word that identifies the physician; the honorific identifies nobody. */
function surname(name: string): string {
  const words = (name || '')
    .split(/\s+/)
    .filter((w) => w && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w));
  return words.length ? words[words.length - 1] : name;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

interface MonthCalendarProps {
  appointments: Appointment[];
  /** A chip was clicked — open the full record. */
  onOpen: (a: Appointment) => void;
  /** "+n more" was clicked — open that day's whole list. */
  onOpenDay: (dateKey: string) => void;
}

function MonthCalendar({ appointments, onOpen, onOpenDay }: MonthCalendarProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  const byDate = useMemo(() => groupByDate(appointments), [appointments]);
  const cells = useMemo(() => monthGrid(month), [month]);

  const today = todayStr();
  const stamp = dateToStr(month).slice(0, 7);
  const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const onThisMonth = appointments.filter((a) => a.appt_date.slice(0, 7) === stamp).length;
  const isCurrentMonth = stamp === today.slice(0, 7);

  /** Month arithmetic overflows on purpose: month 12 is January of next year. */
  const shift = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  return (
    <Card
      title={label}
      actions={
        <div className="flex items-center gap-2">
          <IconButton
            icon={ChevronLeft}
            label="Previous month"
            size="sm"
            onClick={() => shift(-1)}
          />
          <IconButton
            icon={ChevronRight}
            label="Next month"
            size="sm"
            onClick={() => shift(1)}
          />
          {!isCurrentMonth && (
            <Button size="sm" onClick={() => setMonth(startOfMonth(new Date()))}>
              Today
            </Button>
          )}
        </div>
      }
    >
      {/* Seven columns cannot fit a phone at a legible chip size, so the grid
          keeps a floor width and scrolls inside this box. That box owns the
          sideways overflow because `html` is overflow-x: hidden — anything that
          escapes it is not scrolled to, it is silently sheared off.

          The floor is 7rem a column, matching the physician's own grids.
          Narrower and a chip cannot hold a time and a name at once, which is
          the whole of what a cell is read for.

          It is released at lg rather than sm: between md and lg the sidebar
          takes 15.5rem out of the viewport, so a tablet actually has *less*
          room for the grid than a large phone does. */}
      <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
        <div className="min-w-[49rem] lg:min-w-0">
          {/* gap-px here too, so the header tracks line up with the cell tracks
              rather than drifting a couple of pixels across the week. */}
          <div className="grid grid-cols-7 gap-px">
            {[1, 2, 3, 4, 5, 6, 0].map((i) => (
              <div
                key={i}
                className="pb-1.5 text-center text-[0.7rem] font-bold uppercase tracking-wider text-slate-500"
              >
                <abbr title={WEEKDAYS[i]} className="no-underline">
                  {WEEKDAYS[i].slice(0, 3)}
                </abbr>
              </div>
            ))}
          </div>

          {/* Hairlines are the gap showing the container's own colour, so no
              cell has to know whether it is on an edge. */}
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200">
            {cells.map((d) => {
              const key = dateToStr(d);
              const day = byDate.get(key) || [];
              // One over the cap is drawn in full: "+1 more" costs exactly the
              // line the chip it hides would have occupied, so collapsing a
              // single appointment buys nothing and hides something.
              const shown = day.length <= MAX_CHIPS + 1 ? day : day.slice(0, MAX_CHIPS);
              const hidden = day.length - shown.length;
              const inMonth = d.getMonth() === month.getMonth();
              const isToday = key === today;

              return (
                <div
                  key={key}
                  className={cx(
                    'flex min-h-[5.5rem] flex-col gap-1 p-1.5 sm:min-h-[6.5rem]',
                    inMonth ? 'bg-white' : 'bg-slate-50',
                    isToday && 'ring-1 ring-inset ring-accent-600'
                  )}
                >
                  <time
                    dateTime={key}
                    className={cx(
                      'grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold tabular-nums',
                      isToday
                        ? 'bg-accent-600 text-white'
                        : inMonth
                          ? 'text-slate-900'
                          : 'text-slate-400'
                    )}
                  >
                    {d.getDate()}
                  </time>

                  {shown.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpen(a)}
                      aria-label={`${formatTime(a.appt_time)} with ${a.doctor_name} on ${formatDate(
                        key
                      )} — ${PATIENT_STATUS_LABEL[a.status]}`}
                      title={`${formatTime(a.appt_time)} · ${a.doctor_name} · ${
                        PATIENT_STATUS_LABEL[a.status]
                      }`}
                      className={cx(
                        'block w-full truncate rounded px-1.5 py-1 text-left text-[0.6875rem] font-semibold leading-tight transition hover:ring-1 hover:ring-inset hover:ring-slate-400',
                        CHIP_TONE[STATUS_TONE[a.status]],
                        // Struck through, not recoloured: cancelled and missed
                        // share a tone, and only one of them was called off.
                        a.status === 'cancelled' && 'line-through'
                      )}
                    >
                      {/* A disrupted booking is still confirmed, so its chip is
                          still green — the flag has to ride along or the grid
                          would show a visit as fine that the list has flagged. */}
                      {a.reschedule_required && (
                        <AlertTriangle
                          className="mr-0.5 inline h-3 w-3 align-[-2px] text-amber-600"
                          aria-hidden="true"
                        />
                      )}
                      {formatTime(a.appt_time)} {surname(a.doctor_name)}
                    </button>
                  ))}

                  {hidden > 0 && (
                    <button
                      type="button"
                      onClick={() => onOpenDay(key)}
                      aria-label={`Show all ${day.length} appointments on ${formatDate(key)}`}
                      className="block w-full rounded px-1.5 py-0.5 text-left text-[0.6875rem] font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    >
                      +{hidden} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Colour is never the only carrier — each chip announces its status too —
          but the key saves the reader from having to open one to learn it. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {LEGEND.map((s) => (
          <span
            key={s}
            className={cx(
              'rounded px-1.5 py-0.5 text-[0.6875rem] font-semibold',
              CHIP_TONE[STATUS_TONE[s]]
            )}
          >
            {PATIENT_STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      {onThisMonth === 0 && (
        <p className="mt-3 text-sm text-slate-500">
          Nothing booked in {label} — use Previous and Next to look at another month.
        </p>
      )}
    </Card>
  );
}

/** The List / Calendar switch. Two buttons rather than a Tabs strip: this
    changes how the same appointments are drawn, not which ones are shown. */
function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="View">
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const on = id === view;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(id)}
            className={cx(
              'inline-flex min-h-tap items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors md:min-h-[2.25rem]',
              on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** One labelled line of the detail dialog's description list. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="font-semibold text-slate-500">{label}</dt>
      <dd className="mb-1 text-slate-900 sm:mb-0">{children}</dd>
    </>
  );
}

// ===========================================================================
// Page
// ===========================================================================

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

  /** Calendar dialogs: one appointment, or one day's worth of them. */
  const [detail, setDetail] = useState<Appointment | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  // Anything other than 'calendar' is the list, so a hand-edited ?view=grid
  // lands somewhere real instead of on a blank page.
  const view: View = params.get('view') === 'calendar' ? 'calendar' : 'list';

  function setView(next: View) {
    const search = new URLSearchParams(params);
    if (next === 'calendar') search.set('view', 'calendar');
    else search.delete('view');
    // Replace rather than push: switching how the page is drawn is not a
    // navigation, and Back should leave the page rather than undo a toggle.
    setParams(search, { replace: true });
  }

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
      // Only ever one dialog on screen: a picker stacked on top of the detail
      // it was launched from would leave Escape closing both at once.
      setDetail(null);
      setDayKey(null);
      setRescheduling(a);
      setModalError('');
      // Start on the day they already had, unless it has passed — the point of
      // a reschedule is usually "same week, different hour".
      const start = a.appt_date >= todayStr() ? a.appt_date : todayStr();
      loadSlots(a.doctor_id, start);
    },
    [loadSlots]
  );

  function openCancel(a: Appointment) {
    setDetail(null);
    setDayKey(null);
    setCancelling(a);
  }

  // The dashboard's "needs a new time" callout links straight in here with the
  // appointment id, so the patient lands on the picker rather than on a list
  // they have to search. The parameter is consumed on arrival, or a refresh
  // would re-open the dialog they just closed — but only that parameter, since
  // dropping the whole query string would also drop the chosen view.
  const requestedId = params.get('reschedule');
  useEffect(() => {
    if (!requestedId || !appointments) return;
    const target = appointments.find((a) => String(a.id) === requestedId && isOpen(a.status));
    const search = new URLSearchParams(params);
    search.delete('reschedule');
    setParams(search, { replace: true });
    if (target) openReschedule(target);
  }, [requestedId, appointments, params, setParams, openReschedule]);

  const all = appointments || [];
  const today = todayStr();
  const visible = all.filter((a) => matches(a, filter, today));
  const tabs = (Object.keys(TAB_LABEL) as Filter[]).map((f) => ({
    id: f,
    label: TAB_LABEL[f],
    count: appointments ? all.filter((a) => matches(a, f, today)).length : undefined,
  }));

  const dayList = dayKey
    ? all
        .filter((a) => a.appt_date.slice(0, 10) === dayKey)
        .sort((x, y) => x.appt_time.localeCompare(y.appt_time))
    : [];

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
          <>
            <ViewToggle view={view} onChange={setView} />
            <Link to="/app/doctors" className={buttonClasses('primary')}>
              <CalendarPlus className="h-4 w-4" aria-hidden="true" />
              Book appointment
            </Link>
          </>
        }
      />

      {/* Above the views rather than inside one of them: the request failed for
          the page, not for the way the page happens to be drawn. */}
      {error && (
        <Alert tone="error" icon={AlertTriangle} className="mb-4">
          {error}
        </Alert>
      )}

      {view === 'calendar' ? (
        !appointments && !error ? (
          <Card>
            <Spinner />
          </Card>
        ) : (
          // Every booking, not the filtered set: the month is the filter, and a
          // grid narrowed to "Past" as well would be empty for no stated reason.
          <MonthCalendar appointments={all} onOpen={setDetail} onOpenDay={setDayKey} />
        )
      ) : (
        <Card className="p-0 sm:p-0">
          <div className="px-4 pt-4 sm:px-6 sm:pt-6">
            <Tabs tabs={tabs} active={filter} onChange={(id) => setFilter(id as Filter)} />
          </div>

          {!appointments && !error && <Spinner />}
          {appointments && visible.length === 0 && (
            <EmptyState
              icon={CalendarPlus}
              title={
                filter === 'all'
                  ? 'Nothing booked yet'
                  : `No ${TAB_LABEL[filter].toLowerCase()} appointments`
              }
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
                        <MapPin
                          className="h-3.5 w-3.5 flex-none text-slate-400"
                          aria-hidden="true"
                        />
                        {a.location_name || '—'}
                      </span>
                    </Td>
                    {/* A patient's own words, with no length limit behind them:
                        one paragraph would otherwise set the height of the row
                        and squeeze every other column. */}
                    <Td className="text-slate-500">
                      <TruncatedText text={a.reason} limit={48} title="Appointment reason" />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={a.status} variant="patient" />
                        {a.reschedule_required && <RescheduleBadge />}
                      </div>
                      {a.cancel_reason && (
                        <div className="mt-1 text-xs text-slate-500">
                          <TruncatedText
                            text={a.cancel_reason}
                            limit={40}
                            title="Cancellation reason"
                          />
                        </div>
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
                          <Button size="sm" variant="danger" onClick={() => openCancel(a)}>
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
      )}

      {/* One day, in full — what "+n more" opens. Rows lead into the same
          detail dialog a chip does, so a busy day is not a dead end. */}
      <Modal
        open={!!dayKey}
        title={dayKey ? formatDate(dayKey) : ''}
        onClose={() => setDayKey(null)}
        footer={<Button onClick={() => setDayKey(null)}>Close</Button>}
      >
        <ul className="divide-y divide-slate-100">
          {dayList.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => {
                  setDayKey(null);
                  setDetail(a);
                }}
                className="flex w-full items-center gap-3 py-3 text-left hover:bg-slate-50"
              >
                <span className="w-20 flex-none text-sm font-semibold tabular-nums text-slate-900">
                  {formatTime(a.appt_time)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">
                    {a.doctor_name}
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {a.location_name || 'Site confirmed on approval'}
                  </span>
                </span>
                <span className="flex flex-none flex-wrap justify-end gap-1">
                  <StatusBadge status={a.status} variant="patient" />
                  {a.reschedule_required && <RescheduleBadge />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      {/* The calendar's row equivalent: everything the table column shows, and
          the same two levers, so a chip is not a read-only second-class view. */}
      <Modal
        open={!!detail}
        title="Appointment"
        onClose={() => setDetail(null)}
        footer={
          detail && isOpen(detail.status) ? (
            <>
              <Button onClick={() => setDetail(null)}>Close</Button>
              <Button variant="danger" onClick={() => openCancel(detail)}>
                Cancel appointment
              </Button>
              <Button
                variant={detail.reschedule_required ? 'primary' : 'secondary'}
                onClick={() => openReschedule(detail)}
              >
                Reschedule
              </Button>
            </>
          ) : (
            <Button onClick={() => setDetail(null)}>Close</Button>
          )
        }
      >
        {detail && (
          <>
            <div className="mb-4 flex items-center gap-3">
              <Avatar name={detail.doctor_name} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{detail.doctor_name}</p>
                <p className="truncate text-sm text-slate-500">
                  {detail.specialty_name || 'General practice'}
                </p>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-1">
              <StatusBadge status={detail.status} variant="patient" />
              {detail.reschedule_required && <RescheduleBadge />}
            </div>

            <dl className="grid gap-x-4 text-sm sm:grid-cols-[7rem_1fr] sm:gap-y-3">
              <DetailRow label="When">
                {formatDate(detail.appt_date)} at {formatTime(detail.appt_time)}
              </DetailRow>
              <DetailRow label="Location">
                <span className="flex items-start gap-1">
                  <MapPin
                    className="mt-0.5 h-3.5 w-3.5 flex-none text-slate-400"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    {detail.location_name || 'Site confirmed on approval'}
                    {detail.location_address && (
                      <span className="block text-xs text-slate-500">
                        {detail.location_address}
                      </span>
                    )}
                  </span>
                </span>
              </DetailRow>
              <DetailRow label="Reason">
                <TruncatedText text={detail.reason} limit={140} title="Appointment reason" />
              </DetailRow>
              <DetailRow label="Requested">{formatStamp(detail.created_at)}</DetailRow>
              {detail.status === 'cancelled' && (
                <DetailRow label="Cancelled">
                  <span className="block">
                    {CANCELLED_BY_LABEL[detail.cancelled_by || 'unknown']}
                  </span>
                  {detail.cancel_reason && (
                    <span className="block text-slate-600">
                      <TruncatedText
                        text={detail.cancel_reason}
                        limit={140}
                        title="Cancellation reason"
                      />
                    </span>
                  )}
                </DetailRow>
              )}
            </dl>

            {detail.reschedule_required && (
              <Alert tone="warning" icon={AlertTriangle} className="mt-4">
                Your clinic changed availability, so this visit can no longer go ahead as booked.
                Choose <strong>Reschedule</strong> and the clinic will confirm the new time.
              </Alert>
            )}
          </>
        )}
      </Modal>

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
