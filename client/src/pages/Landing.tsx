import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ban, BarChart3, Calendar, Search, Shield, Stethoscope } from 'lucide-react';
import { getToken, getUser, homeFor } from '../lib/api';

const FEATURES = [
  {
    icon: Search,
    title: 'Find the right doctor',
    text: 'Search by name or specialty and see real-time availability before you book.',
  },
  {
    icon: Calendar,
    title: 'Booked on the spot',
    text: 'Pick an open slot and it is yours immediately — no waiting on the clinic to approve it.',
  },
  {
    icon: Ban,
    title: 'No double-booking',
    text: 'Slots update instantly so two patients can never claim the same time with a physician.',
  },
  {
    icon: Stethoscope,
    title: 'Clinic administration',
    text: 'Staff manage physician schedules, record visit outcomes, and follow up on missed visits.',
  },
  {
    icon: BarChart3,
    title: 'Operational reports',
    text: 'Track appointment volume, physician utilization, no-show and cancellation rates.',
  },
  {
    icon: Shield,
    title: 'Secure accounts',
    text: 'Passwords are hashed and every action is scoped to your role.',
  },
];

export default function Landing() {
  const navigate = useNavigate();

  // Already logged in? Jump straight to the right home.
  useEffect(() => {
    const user = getUser();
    if (user && getToken()) navigate(homeFor(user), { replace: true });
  }, [navigate]);

  return (
    <>
      <header className="top-marketing">
        <div className="inner">
          <Link className="brand" to="/">
            MAP<b>S</b>
          </Link>
          <div className="nav-links">
            <Link to="/login">Log in</Link>
            <Link to="/register" className="btn sm">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="hero container">
          <h1>Book your care in minutes, not phone calls.</h1>
          <p className="lead">
            MAPS is a scheduling platform for outpatient clinics. Patients find the right doctor
            and book online; clinic staff manage schedules, track attendance, and report — all in
            one place.
          </p>
          <div className="cta">
            <Link to="/register" className="btn">
              Create a patient account
            </Link>
            <Link to="/login" className="btn secondary">
              Log in
            </Link>
          </div>
        </section>

        <section className="container" style={{ paddingBottom: 48 }}>
          <div className="grid cols-3">
            {FEATURES.map((f) => (
              <div className="card feature" key={f.title}>
                <f.icon className="lucide" />
                <h3>{f.title}</h3>
                <p className="muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="site">
        <div className="container">
          MAPS — Medical Appointment &amp; Patient Scheduling System · CIS 9590 Group Project
        </div>
      </footer>
    </>
  );
}
