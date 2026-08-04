/**
 * The physician's schedule — one day, one week, or one month.
 *
 * The day table is still the working surface: it is what a clinic session is
 * run from, and it carries the detail (reason, site, contact) a decision needs.
 * What a day cannot answer at all is "what does my week look like", so the same
 * appointments are also offered as a week and a month grid — chips dense enough
 * to read a shape from, with the full record one click away in a dialog.
 *
 * The chosen view lives in the query string. A physician working in the month
 * grid should not be dropped back into a single day by a refresh, and a week
 * worth talking about should be a link someone can be sent.
 *
 * The role matrix is enforced on the server; this page states the same rules so
 * that no refused action is ever offered. A physician may complete their own
 * confirmed visit, or record that it was missed, and only once its start time
 * has passed. Cancelling and rescheduling belong to the patient and to the
 * clinic, so neither appears here in any view. A `pending` row is a request
 * nobody has approved yet — an unapproved visit cannot have happened, so it
 * gets a line of explanation instead of an outcome button the server would
 * refuse.
 *
 * The grids are built here from date arithmetic and CSS grid. Seven columns of
 * chips do not earn a calendar library, which would arrive carrying its own
 * layout engine, theme and locale system to draw them.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, CalendarClock, ChevronLeft, ChevronRight, Clock,
} from 'lucide-react';
import {
  addDays, apptHasStarted, apptStart, completeAppointment, dateToStr, formatDate,
  formatDateShort, formatTime, listDoctorAppointments, markAppointmentNoShow,
  NO_SHOW_REASONS, STAFF_STATUS_LABEL, STATUS_TONE, todayStr,
  type Appointment, type Tone,
} from '../../lib/api';
import {
  Alert, Button, buttonClasses, Card, EmptyState, Field, IconButton, Input,
  MenuItem, Modal, PageHeader, ReasonModal, RescheduleBadge, RowMenu, Spinner,
  StatusBadge, Table, Td, Textarea, Th, TruncatedText, cx,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

type View = 'day' | 'week' | 'month';

/** Narrow to wide — the toggle reads the way a physician zooms out. */
const VIEWS: View[] = ['day', 'week', 'month'];

const VIEW_LABEL: Record<View, string> = { day: 'Day', week: 'Week', month: 'Month' };

/** The unit the date navigator moves in, named for the buttons and the copy. */
const UNIT: Record<View, string> = { day: 'day', week: 'week', month: 'month' };

/** How the pending-approval warning refers to the span it counted over. */
const SPAN_WORD: Record<View, string> = {
  day: 'on this day',
  week: 'in this week',
  month: 'in this month',
};

/**
 * Rows a month cell can hold before it starts stretching its whole week taller.
 * Three is what fits the cell height the grid is drawn at; see `visibleChips`
 * for why a busy day only shows two of them.
 */
const CELL_CAPACITY = 3;

/**
 * Chip colouring, derived from the same status→tone map the badges use rather
 * than picked per status here. Change what "cancelled" means once, and the
 * badge, the bar chart and these chips all follow.
 */
const CHIP_TONE: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  amber: 'bg-amber-50 text-amber-900 hover:bg-amber-100',
  red: 'bg-red-50 text-red-800 hover:bg-red-100',
  slate: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  blue: 'bg-accent-50 text-accent-700 hover:bg-accent-500/10',
};

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

/**
 * A 'YYYY-MM-DD' as a local Date, safe to read getDay()/getMonth() off.
 *
 * Built through `apptStart` at midday for the reason given there: parsing the
 * string whole gives UTC midnight, which is the previous evening for anyone
 * west of Greenwich — and a calendar that is a day out is not a calendar.
 */
function dayAt(dateStr: string): Date {
  return apptStart(dateStr, '12:00');
}

/**
 * The Monday of the week containing `dateStr`.
 *
 * getDay() counts from Sunday, so Sunday has to walk back six days rather than
 * none. Getting that wrong is the bug that puts a month beginning on a Sunday —
 * February 2026, say — into the Monday column and shifts the whole grid.
 */
function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -((dayAt(dateStr).getDay() + 6) % 7));
}

function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

function endOfMonth(dateStr: string): string {
  const d = dayAt(dateStr);
  // Day 0 of the next month is the last day of this one, leap years included.
  return dateToStr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * `n` months on, clamped to the length of the month it lands in.
 *
 * Date's own month arithmetic rolls over: one month after August 31 is
 * October 1, so a physician paging through the year would silently skip
 * September. Clamping to the 30th is what "next month" actually means.
 */
function addMonths(dateStr: string, n: number): string {
  const d = dayAt(dateStr);
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return dateToStr(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), lastDay)));
}

/** 'Mon' — taken from the date itself so the reader's locale decides. */
function weekdayShort(dateStr: string): string {
  return dayAt(dateStr).toLocaleDateString(undefined, { weekday: 'short' });
}

/**
 * Last word of the patient's name. A day column is too narrow for "Jonathan
 * Whitfield", and a physician recognises their own list by surname.
 */
function surname(name: string | undefined): string {
  const parts = (name || '').trim().split(/\s+/);
  return parts[parts.length - 1] || '—';
}

/**
 * What a month cell shows, and what it has to admit it is hiding.
 *
 * The "+N more" line costs a row of its own, so on an overflowing day it has to
 * come out of the budget — otherwise the cell grows past the height its week
 * was sized at and the whole row goes ragged. A day that fits is drawn whole;
 * one appointment beyond that and the last chip gives up its row to the count
 * of everything the cell is not showing.
 */
function visibleChips(items: Appointment[]): Appointment[] {
  return items.length > CELL_CAPACITY ? items.slice(0, CELL_CAPACITY - 1) : items;
}

// ---------------------------------------------------------------------------
// Grid pieces
// ---------------------------------------------------------------------------

/**
 * The frame both grids are drawn in: seven columns and the box that owns their
 * sideways overflow.
 *
 * The columns are wide enough to hold "9:30 AM · Whitfield" and no narrower.
 * `1fr` lets them share whatever room the panel has; the `minmax` floor is what
 * makes a phone scroll this box rather than shred every chip onto four lines.
 * That the scrolling happens *here* is load-bearing — `html` is overflow-x
 * hidden, so a grid that escapes this container is not scrolled to, it is
 * silently sheared off at the panel edge.
 *
 * Callers fill it in two passes, headers first and then cells, rather than as
 * seven self-contained columns: one grid is what keeps every header on the same
 * line and every cell in a row the same height, whatever they happen to hold.
 */
function CalendarGrid({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
      <div className="grid gap-px bg-slate-200 [grid-template-columns:repeat(7,minmax(7rem,1fr))]">
        {children}
      </div>
    </div>
  );
}

/**
 * One appointment inside a calendar cell.
 *
 * Deliberately below the 44px target the rest of the app holds to: a month of
 * tap-sized rows is not a month grid, it is a list. The compensation is that
 * every chip opens the same dialog the day table's own actions live in, and the
 * day view — reachable from any cell — is the full-size route to all of it.
 *
 * Status is carried by tone for the reader scanning the grid, and repeated as
 * words for the reader who is being read to.
 */
function ApptChip({
  appt, compact, onOpen,
}: { appt: Appointment; compact?: boolean; onOpen: (a: Appointment) => void }) {
  const label = `${formatTime(appt.appt_time)} · ${appt.patient_name} · ${
    STAFF_STATUS_LABEL[appt.status]
  }`;
  return (
    <button
      type="button"
      title={label}
      onClick={() => onOpen(appt)}
      className={cx(
        'mb-px block w-full truncate rounded px-1.5 text-left font-semibold last:mb-0',
        CHIP_TONE[STATUS_TONE[appt.status]],
        compact ? 'py-1 text-[0.7rem] leading-tight' : 'py-1.5 text-xs'
      )}
    >
      <span className="tabular-nums">{formatTime(appt.appt_time)}</span>{' '}
      <span className="font-bold">{surname(appt.patient_name)}</span>
      <span className="sr-only">
        {' '}
        — {formatDate(appt.appt_date)}, {STAFF_STATUS_LABEL[appt.status]}
      </span>
    </button>
  );
}

/** The date number in a cell corner. Today is the one that is never in doubt. */
function DayNumber({ dateStr, today, muted }: { dateStr: string; today: boolean; muted?: boolean }) {
  return (
    <span
      className={cx(
        'grid h-6 min-w-[1.5rem] flex-none place-items-center rounded-full px-1 text-sm font-bold',
        today
          ? 'bg-accent-600 text-white'
          : muted
            ? 'text-slate-400'
            : 'text-slate-900'
      )}
    >
      {Number(dateStr.slice(8, 10))}
      {today && <span className="sr-only"> (today)</span>}
    </span>
  );
}

export default function DoctorSchedule() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
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

  /** The chip a physician clicked in the week or month grid. */
  const [detail, setDetail] = useState<Appointment | null>(null);

  // A hand-edited ?view=fortnight is not a view. Anything unrecognised reads as
  // the day view rather than rendering a page with no grid on it.
  const rawView = params.get('view') || '';
  const view: View = (VIEWS as string[]).includes(rawView) ? (rawView as View) : 'day';

  function setView(next: View) {
    const p = new URLSearchParams(params);
    // The default view leaves no trace in the URL; only a deliberate week or
    // month is worth spelling out in a link.
    if (next === 'day') p.delete('view');
    else p.set('view', next);
    // Replace rather than push: changing the lens is a refinement of the same
    // view, and Back should leave the schedule, not walk every toggle.
    setParams(p, { replace: true });
  }

  /** The span on screen: one day, Monday-to-Sunday, or the whole month grid. */
  const range = useMemo(() => {
    if (view === 'day') return { from: date, to: date };
    if (view === 'week') {
      const from = startOfWeek(date);
      return { from, to: addDays(from, 6) };
    }
    // The month grid shows the tail of the previous month and the head of the
    // next, and those days hold real appointments — so the range is the grid's,
    // not the month's.
    return {
      from: startOfWeek(startOfMonth(date)),
      to: addDays(startOfWeek(endOfMonth(date)), 6),
    };
  }, [view, date]);

  const load = useCallback(() => {
    setAppointments(null);
    setError('');
    // One request for the whole visible span. A month grid is up to 42 days,
    // and 42 requests would be 42 chances to paint a half-drawn calendar — the
    // endpoint takes from/to precisely so it can be asked once. `date` wins
    // over from/to server-side, so the day view sends that and nothing else.
    listDoctorAppointments(view === 'day' ? { date } : { from: range.from, to: range.to })
      .then((d) => setAppointments(d.appointments))
      .catch((err) => {
        setError((err as Error).message);
        setAppointments([]);
      });
  }, [view, date, range]);

  useEffect(load, [load]);

  /**
   * Appointments bucketed by their own date. Insertion order is preserved, and
   * the endpoint answers ordered by date then time, so each bucket is already
   * in time order — re-sorting here would only be a second opinion about it.
   */
  const byDate = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments || []) {
      const key = a.appt_date.slice(0, 10);
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [appointments]);

  const weekDays = useMemo(() => {
    const monday = startOfWeek(date);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [date]);

  /** Every cell of the month grid, leading and trailing days included. */
  const monthDays = useMemo(() => {
    const first = startOfWeek(startOfMonth(date));
    const last = addDays(startOfWeek(endOfMonth(date)), 6);
    const cells: string[] = [];
    // 'YYYY-MM-DD' compares lexicographically the same way it compares
    // chronologically, so the loop needs no Date objects to know when to stop.
    for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
    return cells;
  }, [date]);

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

  /**
   * Hand an appointment from the detail dialog to the dialog that acts on it.
   * The detail closes first: two stacked modals would trap the reader behind
   * the wrong one to dismiss.
   */
  function startComplete(a: Appointment) {
    setDetail(null);
    setNote('');
    setCompleting(a);
  }

  function startNoShow(a: Appointment) {
    setDetail(null);
    setNoShowTarget(a);
  }

  /** Drill from a grid cell into the day it belongs to. */
  function openDay(dateStr: string) {
    setDate(dateStr);
    setView('day');
  }

  /** Previous/Next move by whatever unit is on screen. */
  function step(delta: number) {
    if (view === 'month') setDate(addMonths(date, delta));
    else setDate(addDays(date, view === 'week' ? delta * 7 : delta));
  }

  const today = todayStr();
  const spanHasToday = range.from <= today && today <= range.to;
  const pendingCount = (appointments || []).filter((a) => a.status === 'pending').length;

  const spanLabel =
    view === 'day'
      ? formatDate(date)
      : view === 'week'
        ? `${formatDateShort(range.from)} – ${formatDateShort(range.to)}, ${dayAt(
            range.to
          ).getFullYear()}`
        : dayAt(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  const title =
    view === 'day'
      ? date === today
        ? "Today's schedule"
        : 'Schedule'
      : view === 'week'
        ? 'Your week'
        : 'Your month';

  return (
    <>
      <PageHeader
        title={title}
        subtitle={
          view === 'day'
            ? `${spanLabel} — complete each visit with a note as you see the patient.`
            : `${spanLabel} — open an appointment to record how the visit went.`
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* aria-pressed rather than tabs: these three do not reveal three
                panels, they re-draw the one below at a different zoom. */}
            <div role="group" aria-label="Calendar view" className="flex items-center gap-1">
              {VIEWS.map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant={v === view ? 'primary' : 'secondary'}
                  aria-pressed={v === view}
                  onClick={() => setView(v)}
                >
                  {VIEW_LABEL[v]}
                </Button>
              ))}
            </div>
            <IconButton
              icon={ChevronLeft}
              label={`Previous ${UNIT[view]}`}
              size="sm"
              onClick={() => step(-1)}
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
              label={`Next ${UNIT[view]}`}
              size="sm"
              onClick={() => step(1)}
            />
            {!spanHasToday && (
              <Button size="sm" onClick={() => setDate(today)}>
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
            ? `1 booking ${SPAN_WORD[view]} is still a request waiting on clinic staff to approve it.`
            : `${pendingCount} bookings ${SPAN_WORD[view]} are still requests waiting on clinic staff to approve them.`}
        </Alert>
      )}

      {view === 'day' && (
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
                            disabled={!apptHasStarted(a)}
                            title={
                              apptHasStarted(a)
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
                              disabled={!apptHasStarted(a)}
                              title={
                                apptHasStarted(a)
                                  ? undefined
                                  : `Available from ${formatTime(a.appt_time)}`
                              }
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
                      {a.status === 'confirmed' && !apptHasStarted(a) && (
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
      )}

      {view === 'week' && (
        <Card className="overflow-hidden p-0 sm:p-0">
          {!appointments && !error ? (
            <Spinner label="Loading your week…" />
          ) : (
            <CalendarGrid>
              {weekDays.map((d) => {
                const count = byDate.get(d)?.length ?? 0;
                return (
                  <div
                    key={`head-${d}`}
                    // Ternary rather than a trailing override: two background
                    // utilities on one element are settled by their order in
                    // the stylesheet, not by the order they are written in.
                    className={cx('px-2 py-2 text-center', d === today ? 'bg-accent-50' : 'bg-white')}
                  >
                    <div className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-500">
                      {weekdayShort(d)}
                    </div>
                    <div className="mt-0.5 flex items-center justify-center gap-1.5">
                      <DayNumber dateStr={d} today={d === today} />
                      {/* The count is what the week view is for: it says which
                          day is the heavy one without anything being read. */}
                      <span
                        title={`${count} appointment${count === 1 ? '' : 's'}`}
                        className={cx(
                          'rounded-full px-1.5 text-[0.7rem] font-bold',
                          count ? 'bg-slate-100 text-slate-600' : 'text-slate-300'
                        )}
                      >
                        {count}
                        <span className="sr-only"> appointments</span>
                      </span>
                    </div>
                  </div>
                );
              })}

              {weekDays.map((d) => (
                <div
                  key={`col-${d}`}
                  className={cx('min-h-[9rem] p-1.5', d === today ? 'bg-accent-50' : 'bg-white')}
                >
                  {/* A week column lists its whole day: the page can grow
                      downwards, so nothing here has to be hidden behind a
                      "+N more" the way a fixed-height month cell does. */}
                  {(byDate.get(d) ?? []).map((a) => (
                    <ApptChip key={a.id} appt={a} onOpen={setDetail} />
                  ))}
                </div>
              ))}
            </CalendarGrid>
          )}
        </Card>
      )}

      {view === 'month' && (
        <Card className="overflow-hidden p-0 sm:p-0">
          {!appointments && !error ? (
            <Spinner label="Loading your month…" />
          ) : (
            <CalendarGrid>
              {/* Weekday names are taken off the first row of real dates, so
                  the labels can never drift out of step with the columns. */}
              {monthDays.slice(0, 7).map((d) => (
                <div
                  key={`name-${d}`}
                  className="bg-white px-2 py-2 text-center text-[0.7rem] font-bold uppercase tracking-wider text-slate-500"
                >
                  {weekdayShort(d)}
                </div>
              ))}

              {monthDays.map((d) => {
                const items = byDate.get(d) ?? [];
                const shown = visibleChips(items);
                const hidden = items.length - shown.length;
                const isToday = d === today;
                // Leading and trailing days are dimmed but never blanked: a
                // clinic on the 1st is on the 1st whichever grid it lands in.
                const outside = d.slice(0, 7) !== date.slice(0, 7);

                return (
                  <div
                    key={d}
                    className={cx(
                      'min-h-[7rem] p-1.5',
                      isToday ? 'bg-accent-50' : outside ? 'bg-slate-50' : 'bg-white'
                    )}
                  >
                    {/* The flex row is not decoration: `grid` makes DayNumber
                        block-level, and on its own it would stretch the pill
                        across the whole cell. */}
                    <div className="mb-1 flex items-center">
                      <DayNumber dateStr={d} today={isToday} muted={outside} />
                    </div>
                    {shown.map((a) => (
                      <ApptChip key={a.id} appt={a} compact onOpen={setDetail} />
                    ))}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={() => openDay(d)}
                        className="mt-px block w-full truncate rounded px-1.5 py-1 text-left text-[0.7rem] font-bold leading-tight text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                      >
                        +{hidden} more
                        <span className="sr-only"> on {formatDate(d)} — open the day view</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </CalendarGrid>
          )}
        </Card>
      )}

      {/* One appointment, opened from a chip. It carries exactly the actions
          the role matrix leaves a physician: complete, or record a miss. There
          is no cancel and no reschedule here because there is none for them
          anywhere — those belong to the patient and to the clinic. */}
      <Modal
        open={!!detail}
        title={detail ? detail.patient_name || 'Appointment' : 'Appointment'}
        onClose={() => setDetail(null)}
        footer={
          <>
            <Button onClick={() => setDetail(null)}>Close</Button>
            {detail?.status === 'confirmed' && (
              <>
                <Button
                  variant="danger"
                  disabled={!apptHasStarted(detail)}
                  title={
                    apptHasStarted(detail)
                      ? undefined
                      : `Available from ${formatTime(detail.appt_time)}`
                  }
                  onClick={() => startNoShow(detail)}
                >
                  Didn't attend
                </Button>
                <Button
                  variant="primary"
                  disabled={!apptHasStarted(detail)}
                  title={
                    apptHasStarted(detail)
                      ? undefined
                      : `Available from ${formatTime(detail.appt_time)}`
                  }
                  onClick={() => startComplete(detail)}
                >
                  Complete visit
                </Button>
              </>
            )}
          </>
        }
      >
        {detail && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={detail.status} variant="staff" />
              {detail.reschedule_required && <RescheduleBadge />}
            </div>

            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold text-slate-500">When</dt>
                <dd className="mt-0.5 font-semibold">
                  {formatDate(detail.appt_date)} at {formatTime(detail.appt_time)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold text-slate-500">Location</dt>
                <dd className="mt-0.5">{detail.location_name || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold text-slate-500">Reason</dt>
                {/* Patient-written and unbounded, so it is truncated with the
                    whole of it a click away rather than left to push the
                    dialog's own actions off the bottom of the screen. */}
                <dd className="mt-0.5">
                  <TruncatedText text={detail.reason} limit={120} title="Reason for visit" />
                </dd>
              </div>
              {detail.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-semibold text-slate-500">Visit note</dt>
                  <dd className="mt-0.5">
                    <TruncatedText text={detail.notes} limit={160} title="Visit note" />
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-4">
              <Link
                to={`/doctor/patients/${detail.patient_id}`}
                className={buttonClasses('ghost', 'sm')}
              >
                Open patient chart
              </Link>
            </div>

            {detail.status === 'pending' && (
              <Alert tone="warning" icon={Clock} className="mt-4">
                Awaiting clinic approval. There is nothing to record yet — a visit nobody has
                approved cannot have gone ahead.
              </Alert>
            )}

            {detail.status === 'confirmed' && !apptHasStarted(detail) && (
              <p className="mt-4 text-xs text-slate-500">
                Both outcomes open at {formatTime(detail.appt_time)}: a visit cannot be reported
                on before it has begun.
              </p>
            )}
          </>
        )}
      </Modal>

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
