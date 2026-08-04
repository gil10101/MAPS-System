/**
 * Admin Overview — the clinic dashboard.
 *
 * The tiles answer "is the book healthy?"; one of them also answers "and what
 * do I have to do about it". Since a booking now arrives as a *request* that
 * staff approve (A1), the count of pending requests is not a statistic — it is
 * this admin's inbox, so the tile is a link into the appointment list already
 * filtered to that queue.
 *
 * The two charts are hand-drawn divs. A bar whose width is a percentage of a
 * maximum is something CSS does correctly at every viewport width on its own,
 * and two stacked bar lists do not earn a charting dependency.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, CalendarX, ClipboardCheck, Stethoscope, UserX, Users,
} from 'lucide-react';
import {
  adminPhysicianUtilization, adminSummary, adminVolumeBySpecialty,
  STAFF_STATUS_LABEL,
  type ApptStatus, type PhysicianUtilization, type SpecialtyVolume, type Summary,
} from '../../lib/api';
import {
  Alert, Card, EmptyState, PageHeader, Spinner, StatCard, Table, Td, Th,
} from '../../components/ui';

/** Lifecycle order, so the status chart reads left-to-right as time does. */
const STATUS_ORDER: ApptStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];

interface BarProps {
  label: string;
  value: number;
  max: number;
}

/**
 * One labelled bar. The fill width is the only inline style in the file: it is
 * a runtime ratio, which a utility class cannot express without generating a
 * class per percentage point. The bar itself is decorative — the figure it
 * encodes is already sitting next to it as text — so screen readers skip it.
 */
function Bar({ label, value, max }: BarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-600">{label}</span>
        <span className="text-sm font-bold tabular-nums text-slate-900">{value}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-accent-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Overview() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [physicians, setPhysicians] = useState<PhysicianUtilization[]>([]);
  const [volume, setVolume] = useState<SpecialtyVolume[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([adminSummary(), adminPhysicianUtilization(), adminVolumeBySpecialty()])
      .then(([s, u, v]) => {
        setSummary(s);
        setPhysicians(u.doctors);
        setVolume(v.specialties);
        setError('');
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  const counts = summary?.appointments;
  const statusBars = counts
    ? STATUS_ORDER.map((status) => ({ label: STAFF_STATUS_LABEL[status], value: counts[status] }))
    : [];
  const statusMax = Math.max(1, ...statusBars.map((b) => b.value));
  const volumeMax = Math.max(1, ...volume.map((v) => v.total_appointments));

  /** Tiles render a dash rather than a zero until the numbers actually land. */
  const dash = '—';

  return (
    <div>
      <PageHeader
        title="Clinic overview"
        subtitle="How the book is running, across every site, physician and patient."
      />

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total appointments"
          value={summary ? summary.appointments.total : dash}
          icon={Calendar}
        />
        {/* No-show rate before cancellation rate: a cancelled slot came back and
            could be resold, a missed one was simply burned. */}
        <StatCard
          label="No-show rate"
          value={summary ? `${summary.no_show_rate}%` : dash}
          icon={UserX}
          hint="Of appointments that came due"
        />
        <StatCard
          label="Cancellation rate"
          value={summary ? `${summary.cancellation_rate}%` : dash}
          icon={CalendarX}
        />
        <Link
          to="/admin/appointments?status=pending"
          className="block rounded-xl transition hover:ring-2 hover:ring-accent-600"
        >
          <StatCard
            label="Pending approval"
            value={summary ? summary.appointments.pending : dash}
            icon={ClipboardCheck}
            accent
            hint="Open the approval queue"
          />
        </Link>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Registered patients"
          value={summary ? summary.total_patients : dash}
          icon={Users}
        />
        <StatCard
          label="Active physicians"
          value={summary ? summary.active_doctors : dash}
          icon={Stethoscope}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Appointments by status">
          {!summary && !error && <Spinner />}
          {statusBars.map((b) => (
            <Bar key={b.label} label={b.label} value={b.value} max={statusMax} />
          ))}
        </Card>

        <Card title="Volume by specialty">
          {!summary && !error && <Spinner />}
          {summary && volume.length === 0 && (
            <p className="text-sm text-slate-500">No appointments have been booked yet.</p>
          )}
          {volume.map((v) => (
            <Bar
              key={v.specialty_name}
              label={v.specialty_name}
              value={v.total_appointments}
              max={volumeMax}
            />
          ))}
        </Card>
      </div>

      <Card title="Physician utilization">
        {!summary && !error && <Spinner />}
        {summary && physicians.length === 0 && (
          <EmptyState icon={Stethoscope} title="No active physicians">
            Add a physician under Setup to start taking bookings.
          </EmptyState>
        )}
        {physicians.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Physician</Th>
                <Th>Specialty</Th>
                <Th align="right">Total</Th>
                <Th align="right">Upcoming</Th>
                <Th align="right">Completed</Th>
                <Th align="right">Cancelled</Th>
                <Th align="right">Didn't attend</Th>
              </tr>
            </thead>
            <tbody>
              {physicians.map((p) => (
                <tr key={p.id}>
                  <Td className="font-semibold text-slate-900">{p.full_name}</Td>
                  <Td className="text-slate-500">{p.specialty_name || '—'}</Td>
                  <Td align="right" className="tabular-nums">{p.total_appointments}</Td>
                  <Td align="right" className="tabular-nums">{p.upcoming}</Td>
                  <Td align="right" className="tabular-nums">{p.completed}</Td>
                  <Td align="right" className="tabular-nums">{p.cancelled}</Td>
                  <Td align="right" className="tabular-nums">{p.no_show}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
