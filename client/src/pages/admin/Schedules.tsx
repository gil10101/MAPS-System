/**
 * Schedules & availability (A3) — where a physician's bookable time comes from.
 *
 * Two things decide whether a patient can be offered a slot, and they work in
 * opposite directions, so the page shows them side by side:
 *
 *   Weekly availability   the recurring pattern that GENERATES slots — a window
 *                         at one site, on one weekday, cut into slot_minutes.
 *   Availability blocks   a date range that REMOVES them, whatever the pattern
 *                         says: leave, a conference, a clinic closure.
 *
 * Blocking is the consequential half. It hides those days from patient search,
 * but it does not cancel what is already booked: the patient keeps their place
 * and is asked to move it. The server returns how many bookings that touched,
 * and this page puts that number on screen — an admin who blocks a fortnight
 * needs to know that eleven people are now waiting on a phone call.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, CalendarOff, CalendarRange, CheckCircle2, Clock, MapPin, Plus,
  Stethoscope, Trash2, type LucideIcon,
} from 'lucide-react';
import {
  WEEKDAYS, adminCreateBlock, adminCreateSchedule, adminDeleteBlock,
  adminDeleteSchedule, adminListBlocks, adminListDoctors, adminListLocations,
  adminScheduleImpact,
  adminListSchedules, formatDate, formatTime, todayStr,
  type Doctor, type Location, type Schedule, type ScheduleBlock, type Tone,
} from '../../lib/api';
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Input, Modal,
  PageHeader, Select, Spinner, Tabs, buttonClasses, cx,
} from '../../components/ui';
import MonthGrid, { startOfMonth } from '../../components/MonthGrid';
import PhysicianPicker from '../../components/PhysicianPicker';
import { useToast } from '../../components/Toast';

/** Slot lengths a practice actually books in. */
const SLOT_CHOICES = [10, 15, 20, 30, 45, 60];

/** Monday morning is the shape most windows take; the form starts there. */
const EMPTY_WINDOW = {
  location_id: '',
  weekday: '1',
  start_time: '09:00',
  end_time: '17:00',
  slot_minutes: '30',
};

const EMPTY_BLOCK = { start_date: '', end_date: '', reason: '' };

/** What the admin just did, kept on screen after the modal closes. */
interface BlockNotice {
  affected: number;
  start_date: string;
  end_date: string;
  doctor_id: string;
  doctor_name: string;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Where a block sits relative to today. DATE columns come back as plain
 * 'YYYY-MM-DD' strings, so comparing them as strings is comparing them as
 * dates — and it stays in the clinic's own timezone, which a Date round-trip
 * would not.
 */
function blockPhase(block: ScheduleBlock, today: string): { label: string; tone: Tone } {
  if (block.end_date < today) return { label: 'Ended', tone: 'slate' };
  if (block.start_date > today) return { label: 'Upcoming', tone: 'amber' };
  return { label: 'In effect', tone: 'red' };
}

/** 'HH:MM' -> minutes since midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * How many bookable slots one window yields.
 *
 * A trailing gap shorter than one slot is not a slot, which is the same rule
 * the server generates availability by — the figure on this page has to be the
 * one patients will actually see offered.
 */
function windowSlots(w: Schedule): number {
  const span = toMinutes(w.end_time) - toMinutes(w.start_time);
  const step = w.slot_minutes || 30;
  return Math.max(0, Math.floor(span / step));
}

type View = 'list' | 'calendar';

/** One swatch and its meaning, under the availability calendar. */
function LegendKey({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={cx('h-3 w-5 rounded', className)} aria-hidden="true" />
      {label}
    </span>
  );
}

/** A headline number with its label, for the picker's summary row. */
function SummaryPill({
  icon: Icon, label, value, tone = 'slate',
}: {
  icon: LucideIcon;
  label: string;
  value: number | null;
  tone?: 'slate' | 'amber';
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 rounded-lg px-3 py-1.5',
        tone === 'amber' ? 'bg-amber-50 text-amber-800' : 'bg-slate-50 text-slate-600'
      )}
    >
      <Icon className="h-4 w-4 flex-none opacity-70" aria-hidden="true" />
      <span className="text-sm font-bold tabular-nums text-slate-900">
        {value === null ? '…' : value}
      </span>
      <span className="text-xs">{label}</span>
    </span>
  );
}

export default function AdminSchedules() {
  const toast = useToast();
  const today = todayStr();

  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  /** Which half of the page is showing: the rules, or what they produce. */
  const [view, setView] = useState<View>('list');
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [doctorId, setDoctorId] = useState('');
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [blocks, setBlocks] = useState<ScheduleBlock[] | null>(null);
  const [error, setError] = useState('');
  const [panelError, setPanelError] = useState('');
  const [notice, setNotice] = useState<BlockNotice | null>(null);

  // Add-window modal
  const [windowOpen, setWindowOpen] = useState(false);
  const [windowForm, setWindowForm] = useState(EMPTY_WINDOW);
  const [windowError, setWindowError] = useState('');
  const [windowBusy, setWindowBusy] = useState(false);
  /** The window awaiting a delete confirmation, and what it would disturb. */
  const [removeTarget, setRemoveTarget] = useState<Schedule | null>(null);
  const [removeImpact, setRemoveImpact] = useState<number | null>(null);

  // Add-block modal
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockForm, setBlockForm] = useState(EMPTY_BLOCK);
  const [blockError, setBlockError] = useState('');
  const [blockBusy, setBlockBusy] = useState(false);

  useEffect(() => {
    Promise.all([adminListDoctors(), adminListLocations()])
      .then(([d, l]) => {
        setDoctors(d.doctors);
        // Only open sites can take a clinic window — the server refuses the
        // rest, so they are never offered.
        setLocations(l.locations.filter((site) => site.active !== false));
        // The page does nothing until a physician is chosen, so the first in
        // the directory is chosen for you. The picker is the first control on
        // the page and switching is one click.
        setDoctorId((current) => current || (d.doctors[0] ? String(d.doctors[0].id) : ''));
        setError('');
      })
      .catch((err) => {
        setError((err as Error).message);
        setDoctors([]);
      });
  }, []);

  const load = useCallback(() => {
    if (!doctorId) {
      setSchedules(null);
      setBlocks(null);
      return;
    }
    setSchedules(null);
    setBlocks(null);
    setPanelError('');
    Promise.all([adminListSchedules(doctorId), adminListBlocks(doctorId)])
      .then(([s, b]) => {
        setSchedules(s.schedules);
        setBlocks(b.blocks);
      })
      .catch((err) => {
        setPanelError((err as Error).message);
        setSchedules([]);
        setBlocks([]);
      });
  }, [doctorId]);

  useEffect(load, [load]);

  const selected = doctors?.find((d) => String(d.id) === doctorId) ?? null;
  /** Bookable slots the published pattern yields in a full week. */
  const weeklySlots = schedules ? schedules.reduce((n, w) => n + windowSlots(w), 0) : null;
  const loadingPanels = !!doctorId && !schedules && !panelError;
  /** Windows already on the weekday being filled in — see the modal. */
  const sameWeekday = (schedules ?? []).filter(
    (s) => s.weekday === Number(windowForm.weekday)
  );

  function chooseDoctor(id: string) {
    setDoctorId(id);
    // The count belonged to the physician it was reported for.
    setNotice(null);
  }

  function openWindowModal() {
    setWindowForm({ ...EMPTY_WINDOW, location_id: locations[0] ? String(locations[0].id) : '' });
    setWindowError('');
    setWindowOpen(true);
  }

  function setWindow<K extends keyof typeof EMPTY_WINDOW>(key: K, value: string) {
    setWindowForm((f) => ({ ...f, [key]: value }));
  }

  async function saveWindow() {
    if (!doctorId) return;
    if (!windowForm.location_id) {
      setWindowError('Choose the site this clinic is held at.');
      return;
    }
    setWindowBusy(true);
    setWindowError('');
    try {
      await adminCreateSchedule(doctorId, {
        location_id: Number(windowForm.location_id),
        weekday: Number(windowForm.weekday),
        start_time: windowForm.start_time,
        end_time: windowForm.end_time,
        slot_minutes: Number(windowForm.slot_minutes),
      });
      setWindowOpen(false);
      toast('Clinic window added.', 'success');
      load();
    } catch (err) {
      // Overlaps come back as a 409 and are the common failure here: two
      // windows on one weekday would offer the same clock time twice, at two
      // different buildings if their sites differ.
      setWindowError((err as Error).message);
    } finally {
      setWindowBusy(false);
    }
  }

  /**
   * Ask the server what removing this window would disturb before offering to
   * remove it. Deleting a window does not delete the visits inside it, so
   * without this the administrator is told nothing about the appointments they
   * are about to leave without a clinic session.
   */
  async function askRemoveWindow(s: Schedule) {
    setRemoveTarget(s);
    setRemoveImpact(null);
    try {
      const { affected } = await adminScheduleImpact(s.id);
      setRemoveImpact(affected);
    } catch {
      // Impact is advisory. If it cannot be fetched the confirmation still
      // stands, it just cannot quote a number.
      setRemoveImpact(-1);
    }
  }

  async function confirmRemoveWindow() {
    if (!removeTarget) return;
    setWindowBusy(true);
    try {
      const { affected } = await adminDeleteSchedule(removeTarget.id);
      toast(
        affected > 0
          ? `Clinic window removed — ${affected} ${
              affected === 1 ? 'appointment needs' : 'appointments need'
            } rescheduling.`
          : 'Clinic window removed.',
        'success'
      );
      setRemoveTarget(null);
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setWindowBusy(false);
    }
  }

  function openBlockModal() {
    setBlockForm({ ...EMPTY_BLOCK, start_date: today, end_date: today });
    setBlockError('');
    setBlockOpen(true);
  }

  async function saveBlock() {
    if (!doctorId || !selected) return;
    if (!blockForm.start_date || !blockForm.end_date) {
      setBlockError('Both dates are required.');
      return;
    }
    if (blockForm.end_date < blockForm.start_date) {
      setBlockError('The end date must be on or after the start date.');
      return;
    }
    setBlockBusy(true);
    setBlockError('');
    try {
      const { affected } = await adminCreateBlock(doctorId, {
        start_date: blockForm.start_date,
        end_date: blockForm.end_date,
        reason: blockForm.reason.trim() || undefined,
      });
      setBlockOpen(false);
      setNotice({
        affected,
        start_date: blockForm.start_date,
        end_date: blockForm.end_date,
        doctor_id: doctorId,
        doctor_name: selected.full_name,
      });
      toast('Availability block added.', 'success');
      load();
    } catch (err) {
      setBlockError((err as Error).message);
    } finally {
      setBlockBusy(false);
    }
  }

  async function removeBlock(b: ScheduleBlock) {
    const ok = window.confirm(
      `Remove the block from ${formatDate(b.start_date)} to ${formatDate(b.end_date)}? ` +
        'Those days become bookable again, and appointments no longer covered by any block ' +
        'stop being flagged for rescheduling.'
    );
    if (!ok) return;
    try {
      await adminDeleteBlock(b.id);
      setNotice(null);
      toast('Availability block removed.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Schedules & availability"
        subtitle="Weekly windows create the slots patients can request. Blocks take days back out."
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {!doctors && !error && <Spinner label="Loading physicians…" />}

      {doctors && doctors.length === 0 && (
        <Card>
          <EmptyState
            icon={Stethoscope}
            title="No physicians yet"
            action={
              <Link to="/admin/doctors" className={buttonClasses('primary')}>
                Go to Physicians
              </Link>
            }
          >
            Add a provider before setting the times they hold clinic.
          </EmptyState>
        </Card>
      )}

      {doctors && doctors.length > 0 && (
        <>
          {/* The header answers two questions in order: which physician, and
              what shape is their week. The picker stays a fixed column on the
              left so it does not move as the summary beside it fills in. */}
          <Card className="mb-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr] lg:items-start">
              <Field label="Physician" htmlFor="s-doctor" className="mb-0">
                <PhysicianPicker
                  id="s-doctor"
                  doctors={doctors}
                  value={doctorId}
                  onChange={chooseDoctor}
                />
              </Field>

              {selected && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 lg:justify-end">
                  <Link
                    to={`/admin/physicians/${selected.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-lg px-1 py-1 hover:bg-slate-50"
                  >
                    <Avatar name={selected.full_name} src={selected.photo_url} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">
                        {selected.full_name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {selected.specialty_name || 'No specialty'}
                        {selected.room ? ` · Room ${selected.room}` : ''}
                      </span>
                    </span>
                  </Link>

                  {/* Counts as their own tiles rather than a run-on sentence:
                      these are the two numbers the page exists to change, and
                      an admin checks them before and after every edit. */}
                  <div className="flex flex-wrap items-center gap-2">
                    <SummaryPill
                      icon={CalendarRange}
                      label="Weekly windows"
                      value={schedules ? schedules.length : null}
                    />
                    <SummaryPill
                      icon={Clock}
                      label="Slots a week"
                      value={weeklySlots}
                    />
                    <SummaryPill
                      icon={CalendarOff}
                      label="Blocks"
                      value={blocks ? blocks.length : null}
                      tone={blocks && blocks.length > 0 ? 'amber' : 'slate'}
                    />
                  </div>

                  {selected.active === false && (
                    <Badge tone="slate">Not accepting bookings</Badge>
                  )}
                </div>
              )}
            </div>
          </Card>

          {panelError && (
            <Alert tone="error" className="mb-4">
              {panelError}
            </Alert>
          )}

          {/* The consequence of the last block, kept until the admin moves on. */}
          {notice && (
            <Alert
              tone={notice.affected > 0 ? 'warning' : 'success'}
              icon={notice.affected > 0 ? AlertTriangle : CheckCircle2}
              title={
                notice.affected > 0
                  ? `${plural(notice.affected, 'appointment')} flagged for rescheduling`
                  : 'No appointments were affected'
              }
              className="mb-4"
            >
              {notice.affected > 0 ? (
                <p>
                  Patients booked with {notice.doctor_name} between{' '}
                  {formatDate(notice.start_date)} and {formatDate(notice.end_date)} have been
                  notified and asked to move. They keep their place until they do —{' '}
                  <Link
                    to={`/admin/appointments?doctor_id=${notice.doctor_id}&from=${notice.start_date}&to=${notice.end_date}`}
                    className="font-semibold underline"
                  >
                    review those appointments
                  </Link>
                  .
                </p>
              ) : (
                <p>
                  Nothing was booked with {notice.doctor_name} between{' '}
                  {formatDate(notice.start_date)} and {formatDate(notice.end_date)}. Those days
                  are now hidden from patient search.
                </p>
              )}
            </Alert>
          )}

          {locations.length === 0 && (
            <Alert tone="info" icon={MapPin} className="mb-4">
              No open clinic sites yet. A window has to say which building it is held in —{' '}
              <Link to="/admin/locations" className="font-semibold underline">
                add a location
              </Link>{' '}
              first.
            </Alert>
          )}

          {/* The two panels state the rule; the calendar shows what the rule
              produces. An admin who has just blocked a fortnight wants to see
              the fortnight, not re-derive it from a weekday pattern. */}
          <div className="mb-4 flex items-center gap-2">
            <Tabs
              tabs={[
                { id: 'list', label: 'Windows & blocks' },
                { id: 'calendar', label: 'Calendar' },
              ]}
              active={view}
              onChange={(id) => setView(id as View)}
            />
          </div>

          {view === 'calendar' && (
            <MonthGrid
              className="mb-4"
              month={month}
              onMonthChange={setMonth}
              today={today}
              legend={
                <>
                  <LegendKey className="bg-accent-50 text-accent-700" label="Clinic hours" />
                  <LegendKey className="bg-red-50 text-red-700" label="Blocked — no slots offered" />
                  <span className="text-xs text-slate-500">
                    Each day shows the windows that apply to that weekday, and the slots they yield.
                  </span>
                </>
              }
              renderDay={(key, date, inMonth) => {
                const blocked = (blocks ?? []).find(
                  (b) => key >= b.start_date && key <= b.end_date
                );
                const windows = (schedules ?? []).filter((w) => w.weekday === date.getDay());
                if (blocked) {
                  return (
                    <span
                      title={blocked.reason || 'Blocked'}
                      className="block truncate rounded bg-red-50 px-1.5 py-1 text-[0.6875rem] font-semibold leading-tight text-red-700"
                    >
                      {blocked.reason || 'Blocked'}
                    </span>
                  );
                }
                if (windows.length === 0) {
                  return inMonth ? (
                    <span className="px-0.5 text-[0.6875rem] text-slate-400">No clinic</span>
                  ) : null;
                }
                return windows.map((w) => (
                  <span
                    key={w.id}
                    title={`${formatTime(w.start_time)}–${formatTime(w.end_time)} · ${
                      w.location_name
                    } · ${plural(windowSlots(w), 'slot')}`}
                    className="block truncate rounded bg-accent-50 px-1.5 py-1 text-[0.6875rem] font-semibold leading-tight text-accent-700"
                  >
                    {formatTime(w.start_time)} · {windowSlots(w)}
                  </span>
                ));
              }}
            />
          )}

          <div
            className={cx(
              'grid items-start gap-4 lg:grid-cols-2',
              view === 'calendar' && 'hidden'
            )}
          >
            <Card
              title="Weekly availability"
              actions={
                <Button
                  variant="primary"
                  size="sm"
                  icon={Plus}
                  disabled={locations.length === 0}
                  onClick={openWindowModal}
                >
                  Add window
                </Button>
              }
            >
              {loadingPanels && <Spinner label="Loading the week…" />}

              {schedules && schedules.length === 0 && (
                <EmptyState
                  icon={CalendarRange}
                  title="No clinic times yet"
                  action={
                    <Button
                      variant="primary"
                      icon={Plus}
                      disabled={locations.length === 0}
                      onClick={openWindowModal}
                    >
                      Add window
                    </Button>
                  }
                >
                  Until this physician has at least one window, patients are offered no times
                  with them.
                </EmptyState>
              )}

              {/* All seven days, not only the busy ones: which days are empty is
                  as much of the answer as which are not. */}
              {schedules &&
                schedules.length > 0 &&
                WEEKDAYS.map((label, weekday) => {
                  const windows = schedules.filter((s) => s.weekday === weekday);
                  return (
                    <div
                      key={label}
                      className="border-b border-slate-100 py-3 first:pt-0 last:border-b-0 last:pb-0"
                    >
                      <div className="mb-1 text-[0.7rem] font-bold uppercase tracking-wider text-slate-500">
                        {label}
                      </div>
                      {windows.length === 0 ? (
                        <p className="text-sm text-slate-400">No clinic</p>
                      ) : (
                        windows.map((w) => (
                          <div key={w.id} className="flex items-center gap-3 py-1">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-slate-900">
                                {formatTime(w.start_time)} – {formatTime(w.end_time)}
                              </p>
                              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                  {w.location_name || 'Unknown site'}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                                  {w.slot_minutes}-minute slots
                                </span>
                              </p>
                            </div>
                            <IconButton
                              icon={Trash2}
                              label={`Remove ${label} ${w.start_time} window`}
                              variant="danger"
                              size="sm"
                              onClick={() => askRemoveWindow(w)}
                            />
                          </div>
                        ))
                      )}
                    </div>
                  );
                })}
            </Card>

            <Card
              title="Availability blocks"
              actions={
                <Button variant="primary" size="sm" icon={Plus} onClick={openBlockModal}>
                  Add block
                </Button>
              }
            >
              {loadingPanels && <Spinner label="Loading blocks…" />}

              {blocks && blocks.length === 0 && (
                <EmptyState
                  icon={CalendarOff}
                  title="No time off booked"
                  action={
                    <Button variant="primary" icon={Plus} onClick={openBlockModal}>
                      Add block
                    </Button>
                  }
                >
                  Block a date range when this physician is away. Those days disappear from
                  patient search, and anything already booked inside them is flagged for
                  rescheduling.
                </EmptyState>
              )}

              {blocks?.map((b) => {
                const phase = blockPhase(b, today);
                return (
                  <div
                    key={b.id}
                    className="flex items-start gap-3 border-b border-slate-100 py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatDate(b.start_date)} – {formatDate(b.end_date)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {b.reason || 'No reason recorded'}
                      </p>
                    </div>
                    <Badge tone={phase.tone}>{phase.label}</Badge>
                    <IconButton
                      icon={Trash2}
                      label={`Remove the block starting ${formatDate(b.start_date)}`}
                      variant="danger"
                      size="sm"
                      onClick={() => removeBlock(b)}
                    />
                  </div>
                );
              })}
            </Card>
          </div>
        </>
      )}

      <Modal
        open={windowOpen}
        title={`Add a clinic window${selected ? ` for ${selected.full_name}` : ''}`}
        onClose={() => setWindowOpen(false)}
        footer={
          <>
            <Button onClick={() => setWindowOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={windowBusy} onClick={saveWindow}>
              Add window
            </Button>
          </>
        }
      >
        {windowError && (
          <Alert tone="error" icon={AlertTriangle} className="mb-4">
            {windowError}
          </Alert>
        )}

        <Field label="Location" htmlFor="w-location" required>
          <Select
            id="w-location"
            value={windowForm.location_id}
            onChange={(e) => setWindow('location_id', e.target.value)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {`${l.name} — ${l.city}`}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Day of the week"
          htmlFor="w-weekday"
          required
          hint={
            sameWeekday.length > 0
              ? `Already on this day: ${sameWeekday
                  .map((s) => `${formatTime(s.start_time)}–${formatTime(s.end_time)}`)
                  .join(', ')}. A new window cannot overlap them.`
              : 'This physician holds no clinic on this day yet.'
          }
        >
          <Select
            id="w-weekday"
            value={windowForm.weekday}
            onChange={(e) => setWindow('weekday', e.target.value)}
          >
            {WEEKDAYS.map((label, weekday) => (
              <option key={label} value={weekday}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor="w-start" required>
            <Input
              id="w-start"
              type="time"
              value={windowForm.start_time}
              onChange={(e) => setWindow('start_time', e.target.value)}
            />
          </Field>
          <Field label="Ends" htmlFor="w-end" required>
            <Input
              id="w-end"
              type="time"
              value={windowForm.end_time}
              onChange={(e) => setWindow('end_time', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Slot length"
          htmlFor="w-slot"
          required
          hint="How the window is cut up: a 9:00–17:00 window in 30-minute slots offers 16 times."
          className="mb-0"
        >
          <Select
            id="w-slot"
            value={windowForm.slot_minutes}
            onChange={(e) => setWindow('slot_minutes', e.target.value)}
          >
            {SLOT_CHOICES.map((m) => (
              <option key={m} value={m}>
                {`${m} minutes`}
              </option>
            ))}
          </Select>
        </Field>
      </Modal>

      <Modal
        open={blockOpen}
        title={`Block time off${selected ? ` for ${selected.full_name}` : ''}`}
        onClose={() => setBlockOpen(false)}
        footer={
          <>
            <Button onClick={() => setBlockOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={blockBusy} onClick={saveBlock}>
              Block these dates
            </Button>
          </>
        }
      >
        {blockError && (
          <Alert tone="error" className="mb-4">
            {blockError}
          </Alert>
        )}

        <p className="mb-4 text-sm text-slate-600">
          These dates stop being offered to patients. Appointments already booked inside the
          range are not cancelled — they are flagged for rescheduling and each patient is
          notified, and you will be told how many.
        </p>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="First day away" htmlFor="b-start" required>
            <Input
              id="b-start"
              type="date"
              value={blockForm.start_date}
              onChange={(e) => setBlockForm((f) => ({ ...f, start_date: e.target.value }))}
            />
          </Field>
          <Field label="Last day away" htmlFor="b-end" required>
            <Input
              id="b-end"
              type="date"
              min={blockForm.start_date || undefined}
              value={blockForm.end_date}
              onChange={(e) => setBlockForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </Field>
        </div>

        <Field
          label="Reason"
          htmlFor="b-reason"
          hint="Staff-facing. Patients are told to reschedule, not why."
          className="mb-0"
        >
          <Input
            id="b-reason"
            placeholder="Annual leave"
            value={blockForm.reason}
            onChange={(e) => setBlockForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </Field>
      </Modal>

      <Modal
        open={!!removeTarget}
        title="Remove clinic window"
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <Button onClick={() => setRemoveTarget(null)}>Keep window</Button>
            <Button
              variant="danger"
              loading={windowBusy}
              disabled={removeImpact === null}
              onClick={confirmRemoveWindow}
            >
              Remove window
            </Button>
          </>
        }
      >
        {removeTarget && (
          <>
            <p className="mb-3 text-sm text-slate-700">
              {WEEKDAYS[removeTarget.weekday]}{' '}
              {formatTime(removeTarget.start_time)}–{formatTime(removeTarget.end_time)} at{' '}
              {removeTarget.location_name || 'this site'} will stop generating slots.
            </p>

            {removeImpact === null && <Spinner label="Checking what this affects…" />}

            {removeImpact !== null && removeImpact > 0 && (
              <Alert tone="warning" icon={AlertTriangle}>
                {plural(removeImpact, 'upcoming appointment')} already booked inside this
                window {removeImpact === 1 ? 'is' : 'are'} kept, flagged as needing a new
                time, and {removeImpact === 1 ? 'that patient is' : 'those patients are'}{' '}
                notified. Nothing is deleted.
              </Alert>
            )}

            {removeImpact === 0 && (
              <Alert tone="success" icon={CheckCircle2}>
                No upcoming appointments sit inside this window, so nobody is affected.
              </Alert>
            )}

            {removeImpact === -1 && (
              <Alert tone="warning" icon={AlertTriangle}>
                Could not check what this affects. Any upcoming appointments inside the
                window will still be kept and flagged for rescheduling.
              </Alert>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
