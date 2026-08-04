/**
 * Patient home.
 *
 * The order of this page is the design. A visit the clinic has disrupted is the
 * only thing here the patient *must* act on, so it sits above everything else.
 * Their scheduled appointments come next — that is what someone opens this app
 * to see, and it is where the page ends.
 *
 * There is deliberately no row of counts. A patient has five appointments, not
 * five hundred: "Upcoming 2" is a tile that restates the list directly beneath
 * it, and a metric nobody can act on is furniture in front of the thing they
 * came for. Volume is a clinic's problem, and the clinic has its own console.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarPlus, MapPin } from 'lucide-react';
import {
  formatDate, formatTime, getUser, isOpen, listMyAppointments, todayStr,
  type Appointment,
} from '../../lib/api';
import {
  Alert, Avatar, Card, EmptyState, PageHeader, RescheduleBadge, Spinner,
  StatusBadge, buttonClasses,
} from '../../components/ui';

/** Chronological, since both the panel and the callout read as an agenda. */
function byWhen(a: Appointment, b: Appointment): number {
  return (a.appt_date + a.appt_time).localeCompare(b.appt_date + b.appt_time);
}

/** One row of the agenda: who, when, and — because the practice has more than
    one building — where. */
function VisitRow({ appointment }: { appointment: Appointment }) {
  const a = appointment;
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-3 first:pt-0 last:border-b-0 last:pb-0">
      <Avatar name={a.doctor_name} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{a.doctor_name}</p>
        <p className="truncate text-sm text-slate-500">{a.specialty_name || 'General practice'}</p>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <span className="truncate">{a.location_name || 'Site confirmed on approval'}</span>
        </p>
      </div>
      <div className="ml-auto text-right">
        <p className="whitespace-nowrap text-sm font-semibold text-slate-900">
          {formatDate(a.appt_date)}
        </p>
        <p className="whitespace-nowrap text-sm text-slate-500">{formatTime(a.appt_time)}</p>
        <div className="mt-1.5 flex flex-wrap justify-end gap-1">
          <StatusBadge status={a.status} variant="patient" />
          {a.reschedule_required && <RescheduleBadge />}
        </div>
      </div>
    </li>
  );
}

export default function Dashboard() {
  const user = getUser();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listMyAppointments()
      .then((d) => setAppointments(d.appointments))
      .catch((err) => setError((err as Error).message));
  }, []);

  const all = appointments || [];
  const today = todayStr();

  // "Upcoming" is every live booking still ahead of the patient, approved or
  // not: a request the clinic has yet to accept is still a plan they have made.
  const upcoming = all.filter((a) => isOpen(a.status) && a.appt_date >= today).sort(byWhen);
  const disrupted = upcoming.filter((a) => a.reschedule_required);

  return (
    <>
      {/* Above the page title deliberately: this is the one thing that cannot
          wait for the patient to finish reading their agenda. */}
      {disrupted.length > 0 && (
        <Alert
          tone="warning"
          icon={AlertTriangle}
          title="Your clinic changed availability — this visit needs a new time"
          className="mb-6 ring-1 ring-amber-200"
        >
          <p className="mt-0.5">
            {disrupted.length === 1
              ? 'Your appointment below can no longer go ahead as booked. Pick a new time and the clinic will confirm it.'
              : `${disrupted.length} of your appointments can no longer go ahead as booked. Pick new times and the clinic will confirm them.`}
          </p>
          <ul className="mt-3 space-y-2">
            {disrupted.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/60 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{a.doctor_name}</span>
                  <span className="block text-xs">
                    {formatDate(a.appt_date)} at {formatTime(a.appt_time)}
                    {a.location_name ? ` · ${a.location_name}` : ''}
                  </span>
                </span>
                {/* Deep-links straight into the reschedule flow on My
                    Appointments, so the callout is one click from being done. */}
                <Link
                  to={`/app/appointments?reschedule=${a.id}`}
                  className={buttonClasses('primary', 'sm')}
                >
                  Reschedule
                </Link>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <PageHeader
        title={`Welcome, ${user?.first_name || 'there'}`}
        subtitle="Here's what's coming up in your care."
        actions={
          <Link to="/app/doctors" className={buttonClasses('primary')}>
            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
            Book appointment
          </Link>
        }
      />

      {error && (
        <Alert tone="error" icon={AlertTriangle} className="mb-6">
          {error}
        </Alert>
      )}

      <Card
        title="Upcoming appointments"
        actions={
          <Link to="/app/appointments" className={buttonClasses('ghost', 'sm')}>
            View all
          </Link>
        }
      >
        {!appointments && !error && <Spinner />}
        {appointments && upcoming.length === 0 && (
          <EmptyState
            icon={CalendarClock}
            title="No upcoming appointments"
            action={
              <Link to="/app/doctors" className={buttonClasses('primary')}>
                Find a doctor
              </Link>
            }
          >
            Browse the physician directory and request a time that works for you.
          </EmptyState>
        )}
        {upcoming.length > 0 && (
          <>
            <ul>
              {upcoming.map((a) => (
                <VisitRow key={a.id} appointment={a} />
              ))}
            </ul>
            {/* The list is now the last thing on the page, so it has to say
                where it stops: everything above is what is still ahead, and a
                patient looking for a visit they have already had should be told
                which page holds it rather than left wondering if it is gone. */}
            <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
              That's everything ahead of you. Past and cancelled visits are on{' '}
              <Link
                to="/app/appointments"
                className="font-semibold text-accent-700 hover:underline"
              >
                My appointments
              </Link>
              .
            </p>
          </>
        )}
      </Card>
    </>
  );
}
