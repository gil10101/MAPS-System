/**
 * One physician, seen from the clinic's side of the desk.
 *
 * Every admin screen that names a physician links here, because the question
 * they raise is the same one: is this provider's book healthy? So the page
 * answers it in one pass — how much of their capacity is used, what is coming,
 * and what has recently happened to their appointments.
 *
 * It deliberately stops at scheduling. There is no route into a patient's
 * clinical record from here, for the same need-to-know reason the
 * administrator's menu has no patient-records browser: an administrator runs
 * the clinic's calendar, and running a calendar does not require reading
 * anybody's chart.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Activity, ArrowLeft, CalendarCheck, CalendarX, CheckCircle2, Clock, Users,
} from 'lucide-react';
import {
  adminDoctorDetail, formatDate, formatRelative, formatTime,
  STAFF_STATUS_LABEL, STATUS_TONE,
  type DoctorDetail,
} from '../../lib/api';
import {
  Alert, Badge, Card, EmptyState, PageHeader, Spinner, StatCard, StatusBadge,
  StatusBarChart, Table, Td, Th,
} from '../../components/ui';

export default function PhysicianDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DoctorDetail | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!id) return;
    setData(null);
    setError('');
    adminDoctorDetail(id)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    return (
      <>
        <BackLink />
        <Alert tone="error">{error}</Alert>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <BackLink />
        <Spinner label="Loading physician…" />
      </>
    );
  }

  const { doctor, stats, recent_appointments: recent, recent_activity: activity } = data;

  const chart = (['completed', 'confirmed', 'pending', 'cancelled', 'no_show'] as const).map(
    (s) => ({ label: STAFF_STATUS_LABEL[s], value: stats[s] ?? 0, tone: STATUS_TONE[s] })
  );

  return (
    <>
      <BackLink />

      <PageHeader
        title={doctor.full_name}
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

      <Card className="mb-4" title="Contact and sites">
        <dl className="grid gap-x-6 gap-y-3 p-4 pt-0 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Email" value={doctor.email} />
          <Detail label="Phone" value={doctor.phone} />
          <Detail
            label="Clinic sites"
            value={
              doctor.locations && doctor.locations.length > 0
                ? doctor.locations.map((l) => l.name).join(', ')
                : null
            }
          />
          {doctor.bio && (
            <div className="sm:col-span-2 lg:col-span-3">
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Biography
              </dt>
              <dd className="mt-1 text-sm text-slate-700">{doctor.bio}</dd>
            </div>
          )}
        </dl>
      </Card>

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

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Appointments by status">
          <div className="p-4 pt-0">
            <StatusBarChart
              data={chart}
              empty="This physician has no appointments yet."
            />
          </div>
        </Card>

        <Card title="Recent activity">
          {activity.length === 0 ? (
            <p className="p-4 pt-0 text-sm text-slate-500">
              Nothing has happened to this physician's appointments yet.
            </p>
          ) : (
            <ol className="max-h-80 overflow-y-auto p-4 pt-0">
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
      </div>

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
                  <Td className="text-slate-500">{a.reason || '—'}</Td>
                  <Td>
                    <StatusBadge status={a.status} variant="staff" />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function BackLink() {
  return (
    <Link
      to="/admin/doctors"
      className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      All physicians
    </Link>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value || '—'}</dd>
    </div>
  );
}
