/**
 * MediSync marketing page — the only screen a visitor sees before signing in.
 *
 * The copy here is a promise the product has to keep. A booking is a *request*
 * that clinic staff approve, so nothing on this page may claim a slot is
 * confirmed the moment it is picked.
 */
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Ban, BarChart3, CalendarCheck, MapPin, Search, Shield, Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import { getToken, getUser, homeFor } from '../lib/api';
import { Card, buttonClasses, cx } from '../components/ui';

interface Feature {
  icon: LucideIcon;
  title: string;
  text: string;
}

const FEATURES: Feature[] = [
  {
    icon: Search,
    title: 'Find the right doctor',
    text: 'Search by name or specialty, narrow to the clinic you can actually travel to, and see the times each physician has open.',
  },
  {
    icon: CalendarCheck,
    title: 'Request a time, we confirm it',
    text: 'Pick an open slot and send it to the clinic as a request. Staff review it against the physician’s day and confirm, and you are told the moment it is approved.',
  },
  {
    icon: MapPin,
    title: 'Every clinic location',
    text: 'Our physicians hold clinic at several sites, so each slot names the building before you book it — never after you have arrived at the wrong one.',
  },
  {
    icon: Ban,
    title: 'No double-booking',
    text: 'A time stops being offered the moment someone asks for it, so two patients can never end up holding the same slot with the same physician.',
  },
  {
    icon: Stethoscope,
    title: 'Clinic administration',
    text: 'Staff approve requests, set physician hours and time off across every site, record visit outcomes, and follow up on missed appointments.',
  },
  {
    icon: BarChart3,
    title: 'Operational reports',
    text: 'Daily schedules, physician workload, cancellation and no-show reasons, and provider utilization measured against real bookable hours.',
  },
  {
    icon: Shield,
    title: 'Secure accounts',
    text: 'Passwords are hashed, sessions are signed, and every request is scoped to the role that made it.',
  },
];

/**
 * The marketing pages render outside the app shell, so the wordmark is declared
 * here rather than imported from Layout — Layout's copy belongs to the signed-in
 * navigation and should stay free to change with it.
 */
function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-white">
      Medi<span className="text-accent-500">Sync</span>
    </span>
  );
}

export default function Landing() {
  const navigate = useNavigate();

  // A signed-in visitor who follows an old bookmark to "/" wants their portal,
  // not the pitch.
  useEffect(() => {
    const user = getUser();
    if (user && getToken()) navigate(homeFor(user), { replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-dvh flex-col bg-navy-900">
      <header className="mx-auto flex w-full max-w-content items-center gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <Link to="/" aria-label="MediSync home">
          <Wordmark />
        </Link>
        <nav className="ml-auto flex items-center gap-2" aria-label="Account">
          <Link
            to="/login"
            className="inline-flex min-h-tap items-center rounded-lg px-3 text-sm font-semibold text-white/75 hover:text-white"
          >
            Log in
          </Link>
          <Link to="/register" className={buttonClasses('primary', 'sm')}>
            Get started
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto w-full max-w-content px-4 pb-12 pt-6 text-center sm:px-6 sm:pb-16 sm:pt-12 lg:px-8">
          <h1 className="text-balance text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            Your next appointment, without the phone call.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-base leading-relaxed text-white/70">
            MediSync is a scheduling platform for outpatient clinics. Patients find the right
            physician and request a time online; clinic staff confirm the booking, run schedules
            across every location, track attendance and report — all in one place.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className={buttonClasses('primary')}>
              Create a patient account
            </Link>
            <Link
              to="/login"
              className={cx(buttonClasses(), 'bg-white/10 text-white hover:bg-white/20')}
            >
              Log in
            </Link>
          </div>
        </section>

        {/* The white panel echoes the app shell: the same floating surface every
            signed-in page is built on, so the product does not change shape at
            the sign-in boundary. */}
        <section className="mx-3 rounded-xl bg-white px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
          <div className="mx-auto w-full max-w-content">
            <h2 className="text-center text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Everything a practice needs to run its schedule
            </h2>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <Card key={f.title}>
                  <f.icon className="h-6 w-6 text-accent-600" aria-hidden="true" />
                  <h3 className="mt-3">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{f.text}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="mx-auto w-full max-w-content px-4 py-8 text-center text-xs text-white/50 sm:px-6 lg:px-8">
        MediSync — Medical Appointment &amp; Patient Scheduling System · CIS 9590 Group Project
      </footer>
    </div>
  );
}
