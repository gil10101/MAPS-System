/**
 * One physician, seen from the clinic's side of the desk.
 *
 * Every admin screen that names a physician links here, because the question
 * they raise is the same one: is this provider's book healthy? So the page
 * answers it in one pass — how much of their capacity is used, what is coming,
 * and what has recently happened to their appointments.
 *
 * That is four screens' worth of material, so it is tabbed rather than stacked:
 * an admin who came to see next week's bookings should not have to scroll past
 * three sections answering somebody else's question. What stays put is the
 * header — who this is, and whether they are even taking bookings — because
 * that is the context every tab is read against.
 *
 * The selected tab lives in the query string. A tab here is a view of the page,
 * not a transient toggle: a refresh, a bookmark, or a link pasted to a
 * colleague should all land on what the reader was actually looking at.
 *
 * The page is deliberately read-only. Approving, cancelling and rescheduling
 * are governed by rules about who may do what and when, and those rules are
 * enforced on the appointments screen where the whole queue is in view — a
 * second set of buttons here would be a second place for them to drift out of
 * agreement with the server.
 *
 * It also stops at scheduling. There is no route into a patient's clinical
 * record from here, for the same need-to-know reason the administrator's menu
 * has no patient-records browser: an administrator runs the clinic's calendar,
 * and running a calendar does not require reading anybody's chart.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  Activity, CalendarCheck, CalendarClock, CalendarX, CheckCircle2, Clock, Users,
} from 'lucide-react';
import {
  addDays, adminDoctorDetail, adminListAppointments, formatDate, formatRelative,
  formatTime, isOpen, todayStr, STAFF_STATUS_LABEL, STATUS_TONE,
  type Appointment, type DoctorDetail,
} from '../../lib/api';
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, Spinner, StatCard, StatusBadge,
  StatusBarChart, Table, Tabs, Td, Th, TruncatedText, type TabItem,
} from '../../components/ui';

const BACK = { to: '/admin/doctors', label: 'All physicians' };

const TAB_IDS = ['overview', 'upcoming', 'recent', 'activity', 'details'] as const;

type Tab = (typeof TAB_IDS)[number];

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Overview',
  upcoming: 'Upcoming',
  recent: 'Recent',
  activity: 'Activity',
  details: 'Details',
};

/**
 * How far ahead the Upcoming tab looks.
 *
 * A month rather than "everything future": the question this tab answers is
 * whether the next stretch of clinic is full, and a booking someone made for
 * next March tells nobody anything about that. The figure is named in the
 * summary line so the count is never read as the whole book.
 */
const UPCOMING_DAYS = 30;

/**
 * Consecutive rows sharing a date, in the order they arrived.
 *
 * One pass rather than a sort: the server already returns appointments
 * soonest-first, so grouping in sequence preserves that order for free — and
 * re-sorting here would be a second opinion about ordering that could silently
 * disagree with the list every other admin screen shows.
 */
function groupByDate(rows: Appointment[]): { date: string; rows: Appointment[] }[] {
  const groups: { date: string; rows: Appointment[] }[] = [];
  for (const a of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === a.appt_date) last.rows.push(a);
    else groups.push({ date: a.appt_date, rows: [a] });
  }
  return groups;
}

export default function PhysicianDetail() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<DoctorDetail | null>(null);
  const [upcoming, setUpcoming] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');
  const [upcomingError, setUpcomingError] = useState('');

  // Fixed at mount rather than recomputed each render: the window is a dep of
  // the fetch below, and a `todayStr()` evaluated inline would be a new string
  // every render and so a reload every render.
  const range = useMemo(() => {
    const from = todayStr();
    return { from, to: addDays(from, UPCOMING_DAYS - 1) };
  }, []);

  const load = useCallback(() => {
    if (!id) return;
    setData(null);
    setUpcoming(null);
    setError('');
    setUpcomingError('');

    adminDoctorDetail(id)
      .then(setData)
      .catch((err) => setError((err as Error).message));

    // A second request, because the profile endpoint looks backwards: its
    // `recent_appointments` is the last ten rows of the book, which answers
    // what happened rather than what is booked. Fired alongside the profile and
    // landing on its own, so a failure here costs the reader the Upcoming tab
    // and not the whole page.
    //
    // No `status` filter: the endpoint takes one status at a time and this tab
    // wants two, so the pair is named once — by `isOpen`, which is already this
    // app's word for "pending or confirmed" — instead of costing a round trip.
    adminListAppointments({ doctor_id: id, from: range.from, to: range.to })
      .then((d) => setUpcoming(d.appointments.filter((a) => isOpen(a.status))))
      .catch((err) => {
        setUpcomingError((err as Error).message);
        setUpcoming([]);
      });
  }, [id, range]);

  useEffect(load, [load]);

  // A hand-edited ?tab=foo should not blank the page out. Only a real tab id
  // survives; anything else reads as the default.
  const rawTab = params.get('tab') || '';
  const tab: Tab = (TAB_IDS as readonly string[]).includes(rawTab) ? (rawTab as Tab) : 'overview';

  function selectTab(next: string) {
    const search = new URLSearchParams(params);
    // Overview is the default, so it is spelled as the absence of the
    // parameter — a link shared from the landing tab carries no ?tab= at all.
    if (next === 'overview') search.delete('tab');
    else search.set('tab', next);
    // Replace rather than push: moving between tabs is reading one page, and
    // Back should return to the physician list rather than walk the tab strip.
    setParams(search, { replace: true });
  }

  if (error) {
    return (
      <>
        <PageHeader back={BACK} title="Physician" />
        <Alert tone="error">{error}</Alert>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <PageHeader back={BACK} title="Physician" />
        <Spinner label="Loading physician…" />
      </>
    );
  }

  const { doctor, stats, recent_appointments: recent, recent_activity: activity } = data;
  const sites = doctor.locations || [];
  const ahead = upcoming || [];
  const awaiting = ahead.filter((a) => a.status === 'pending').length;

  const chart = (['completed', 'confirmed', 'pending', 'cancelled', 'no_show'] as const).map(
    (s) => ({ label: STAFF_STATUS_LABEL[s], value: stats[s] ?? 0, tone: STATUS_TONE[s] })
  );

  const tabs: TabItem[] = TAB_IDS.map((t) => ({
    id: t,
    label: TAB_LABEL[t],
    // Counts are omitted until the number behind them is known — a tab reading
    // "Upcoming 0" while its list is still in flight is a wrong answer, not a
    // pending one.
    count:
      t === 'upcoming' ? upcoming?.length
      : t === 'recent' ? recent.length
      : t === 'activity' ? activity.length
      : undefined,
  }));

  return (
    <>
      <PageHeader
        back={BACK}
        title={
          <span className="flex items-center gap-4 sm:gap-5">
            <Avatar name={doctor.full_name} src={doctor.photo_url} size="xl" />
            {doctor.full_name}
          </span>
        }
        subtitle={[doctor.specialty_name || 'Unassigned', doctor.room && `Room ${doctor.room}`]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={doctor.active ? 'green' : 'slate'}>
              {doctor.active ? 'Accepting appointments' : 'Inactive'}
            </Badge>
            {doctor.login_email ? (
              <Badge tone="slate">Portal login: {doctor.login_email}</Badge>
            ) : (
              <Badge tone="amber">No portal login</Badge>
            )}
          </div>
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={selectTab} />

      {tab === 'overview' && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total appointments" value={stats.total} icon={Activity} />
            <StatCard label="Upcoming" value={stats.upcoming} icon={Clock} accent />
            <StatCard label="Completed" value={stats.completed} icon={CheckCircle2} />
            <StatCard label="Patients seen" value={stats.patients} icon={Users} />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Cancelled" value={stats.cancelled} icon={CalendarX} />
            <StatCard label="Didn't attend" value={stats.no_show} icon={CalendarX} />
            <StatCard label="Booked hours" value={stats.booked_hours} icon={CalendarCheck} />
            {/* The window is on the tile, not in a footnote: a bare percentage
                invites the reader to assume it covers all time, which it does
                not — every other figure on this tab is lifetime. */}
            <StatCard
              label="Utilization"
              value={`${stats.utilization_pct}%`}
              icon={Activity}
              hint={
                stats.window_from
                  ? `${formatDate(stats.window_from)} – ${formatDate(stats.window_to)}`
                  : 'Last 30 days'
              }
            />
          </div>

          <Card title="Appointments by status">
            <StatusBarChart data={chart} empty="This physician has no appointments yet." />
          </Card>
        </>
      )}

      {tab === 'upcoming' && (
        <Card title="Upcoming appointments">
          {upcomingError && (
            <Alert tone="error" className="mb-4">
              {upcomingError}
            </Alert>
          )}

          {!upcoming && !upcomingError && <Spinner label="Loading the next month…" />}

          {upcoming && ahead.length === 0 && !upcomingError && (
            <EmptyState icon={CalendarClock} title="Nothing booked ahead">
              This physician has no pending or confirmed appointments in the next{' '}
              {UPCOMING_DAYS} days.
            </EmptyState>
          )}

          {ahead.length > 0 && (
            <>
              <p className="mb-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{ahead.length}</span> upcoming over
                the next {UPCOMING_DAYS} days
                {awaiting > 0 && (
                  <>
                    , <span className="font-semibold text-amber-800">{awaiting}</span> awaiting
                    approval
                  </>
                )}
              </p>

              <Table>
                <thead>
                  <tr>
                    <Th>Time</Th>
                    <Th>Patient</Th>
                    <Th>Location</Th>
                    <Th>Reason</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                {/* One tbody with the dates interleaved as heading rows, rather
                    than a tbody per day: the shared table styling zeroes the
                    bottom border of a tbody's last row, so grouped bodies would
                    lose exactly the rule that separates the groups. */}
                <tbody>
                  {groupByDate(ahead).map((day) => (
                    // A heading row and its appointments are one list item, so
                    // the key belongs on the fragment holding both.
                    <Fragment key={day.date}>
                      <tr className="bg-slate-50">
                        <Td
                          colSpan={5}
                          className="text-xs font-bold uppercase tracking-wider text-slate-500"
                        >
                          {formatDate(day.date)}
                          {day.date === range.from && (
                            <span className="ml-2 font-bold normal-case tracking-normal text-accent-700">
                              Today
                            </span>
                          )}
                        </Td>
                      </tr>
                      {day.rows.map((a) => (
                        <tr key={a.id}>
                          <Td className="whitespace-nowrap font-medium text-slate-900">
                            {formatTime(a.appt_time)}
                          </Td>
                          <Td className="text-slate-900">{a.patient_name}</Td>
                          <Td className="text-slate-500">{a.location_name || '—'}</Td>
                          <Td className="text-slate-500">
                            <TruncatedText text={a.reason} limit={48} title="Reason for visit" />
                          </Td>
                          <Td>
                            <StatusBadge status={a.status} variant="staff" />
                          </Td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </Table>
            </>
          )}
        </Card>
      )}

      {tab === 'recent' && (
        <Card title="Recent appointments">
          {recent.length === 0 ? (
            <EmptyState icon={CalendarCheck} title="No appointments yet">
              Bookings with this physician will appear here.
            </EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Patient</Th>
                  <Th>Date &amp; time</Th>
                  <Th>Location</Th>
                  <Th>Reason</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((a) => (
                  <tr key={a.id}>
                    <Td className="font-medium text-slate-900">{a.patient_name}</Td>
                    <Td className="whitespace-nowrap">
                      <div className="text-slate-900">{formatDate(a.appt_date)}</div>
                      <div className="text-xs text-slate-500">{formatTime(a.appt_time)}</div>
                    </Td>
                    <Td className="text-slate-500">{a.location_name || '—'}</Td>
                    <Td className="text-slate-500">
                      <TruncatedText text={a.reason} limit={48} title="Reason for visit" />
                    </Td>
                    <Td>
                      <StatusBadge status={a.status} variant="staff" />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {tab === 'activity' && (
        <Card title="Recent activity">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing has happened to this physician's appointments yet.
            </p>
          ) : (
            <ol>
              {activity.map((a, i) => (
                <li key={`${a.at}-${i}`} className="flex gap-3 py-2">
                  <span
                    className="mt-1.5 h-2 w-2 flex-none rounded-full bg-slate-300"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="text-sm text-slate-800">{a.summary}</div>
                    <div className="text-xs text-slate-500">{formatRelative(a.at)}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      )}

      {tab === 'details' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Contact">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Detail label="Email" value={doctor.email} />
              <Detail label="Phone" value={doctor.phone} />
              <Detail label="Room" value={doctor.room} />
              <Detail label="Portal login" value={doctor.login_email} />
            </dl>
          </Card>

          <Card title="Clinic sites">
            {sites.length === 0 ? (
              // Sites are derived from the weekly schedule, so "none" is not a
              // missing field to fill in here — it is a physician with no
              // clinic windows, which is fixed under Schedules.
              <p className="text-sm text-slate-500">
                This physician holds no recurring clinic. Add a weekly window under Schedules and
                the site will appear here.
              </p>
            ) : (
              <ul className="text-sm">
                {sites.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2 last:border-b-0"
                  >
                    <span className="font-medium text-slate-900">{l.name}</span>
                    <span className="text-slate-500">{l.city}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Biography" className="lg:col-span-2">
            {doctor.bio ? (
              <p className="whitespace-pre-wrap text-sm text-slate-700">{doctor.bio}</p>
            ) : (
              <p className="text-sm text-slate-500">
                No biography has been written for this physician.
              </p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}
