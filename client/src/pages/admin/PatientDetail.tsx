/**
 * Patient profile, as an administrator sees it.
 *
 * The scheduling half of a person and none of the clinical half. Demographics
 * and insurance are here because they are what a booking and a bill need;
 * every visit is here because the pattern across them is the reason to open the
 * page at all. Visit notes and prescriptions are not — the server does not send
 * them to this route, which is the same need-to-know rule that keeps a records
 * browser out of the administrator's menu.
 *
 * Reached from the approval queue and the appointments table, so the answer to
 * "who is this and what else have they booked?" is one click from the row that
 * raised the question rather than a search in another screen.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, Mail, Phone, ShieldCheck, User } from 'lucide-react';
import {
  adminPatientDetail, formatDate, formatTime, todayStr,
  GENDER_OPTIONS, STAFF_STATUS_LABEL,
  type AdminPatientDetail as Detail,
} from '../../lib/api';
import {
  Alert, Avatar, Badge, Card, EmptyState, PageHeader, RescheduleBadge, Spinner,
  StatCard, StatusBadge, Table, Td, Th, TruncatedText,
} from '../../components/ui';

const BACK = { to: '/admin/appointments', label: 'Appointments' };

/** Years between a date of birth and today, or null when none is on file. */
function ageFrom(dob: string | null): number | null {
  if (!dob) return null;
  const born = new Date(`${dob.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age;
}

function genderLabel(value: string | null): string {
  return GENDER_OPTIONS.find((g) => g.value === value)?.label || 'Not recorded';
}

/** One labelled fact in the profile card. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export default function AdminPatientDetail() {
  const { id } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setData(null);
    setError('');
    adminPatientDetail(id)
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, [id]);

  if (error) {
    return (
      <>
        <PageHeader back={BACK} title="Patient" />
        <Alert tone="error">{error}</Alert>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader back={BACK} title="Patient" />
        <Spinner label="Loading patient…" />
      </>
    );
  }

  const { patient, appointments, counts } = data;
  const today = todayStr();
  const age = ageFrom(patient.date_of_birth);
  const upcoming = appointments.filter(
    (a) => a.appt_date >= today && (a.status === 'pending' || a.status === 'confirmed')
  ).length;

  return (
    <>
      <PageHeader
        back={BACK}
        title={
          <span className="flex items-center gap-4">
            <Avatar name={patient.full_name} size="lg" />
            {patient.full_name}
          </span>
        }
        subtitle={[
          age === null ? null : `${age} years old`,
          genderLabel(patient.gender),
          `Registered ${formatDate(patient.created_at.slice(0, 10))}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          patient.insurance_provider ? (
            <Badge tone="green" icon={ShieldCheck}>
              {patient.insurance_provider}
            </Badge>
          ) : (
            <Badge tone="amber">No insurance on file</Badge>
          )
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Appointments" value={counts.total} icon={Calendar} />
        <StatCard label="Upcoming" value={upcoming} icon={Calendar} />
        <StatCard label="Completed" value={counts.completed} icon={Calendar} />
        <StatCard label="Didn't attend" value={counts.no_show} icon={Calendar} />
      </div>

      <Card title="Profile" className="mb-4">
        <dl className="grid gap-4 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label="Email" value={patient.email} />
          <Fact label="Phone" value={patient.phone || 'Not recorded'} />
          <Fact label="Date of birth" value={
            patient.date_of_birth ? formatDate(patient.date_of_birth.slice(0, 10)) : 'Not recorded'
          } />
          <Fact label="Gender" value={genderLabel(patient.gender)} />
          <Fact label="Address" value={patient.address || 'Not recorded'} />
          <Fact label="Insurance" value={patient.insurance_provider || 'Not recorded'} />
          <Fact
            label="Reminders"
            value={
              [patient.notify_email && 'Email', patient.notify_sms && 'Text message']
                .filter(Boolean)
                .join(' and ') || 'In-app only'
            }
          />
        </dl>

        {/* The clinical half is absent by design, and saying so is better than
            leaving an administrator wondering whether the page failed to load
            a section that was never coming. */}
        <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Visit notes and prescriptions are not shown here. Clinical records belong to the
          treating physician's portal.
        </p>
      </Card>

      <Card title={`Appointments (${counts.total})`}>
        {appointments.length === 0 ? (
          <EmptyState icon={Calendar} title="No appointments yet">
            This patient has not booked a visit.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date &amp; time</Th>
                <Th>Physician</Th>
                <Th>Location</Th>
                <Th>Reason</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <div className="font-semibold text-slate-900">{formatDate(a.appt_date)}</div>
                    <div className="text-xs text-slate-500">{formatTime(a.appt_time)}</div>
                  </Td>
                  <Td>
                    <Link
                      to={`/admin/physicians/${a.doctor_id}`}
                      className="font-semibold text-accent-600 underline-offset-2 hover:underline"
                    >
                      {a.doctor_name}
                    </Link>
                    <div className="text-xs text-slate-500">{a.specialty_name || '—'}</div>
                  </Td>
                  <Td className="text-slate-600">{a.location_name || '—'}</Td>
                  <Td className="text-slate-600">
                    <TruncatedText text={a.reason} limit={40} title="Appointment reason" />
                    {a.cancel_reason && (
                      <div className="mt-0.5 text-xs text-slate-500">
                        <TruncatedText
                          text={a.cancel_reason}
                          limit={40}
                          title="Cancellation reason"
                        />
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={a.status} variant="staff" />
                      {a.reschedule_required && <RescheduleBadge />}
                    </div>
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
