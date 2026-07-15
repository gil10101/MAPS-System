import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Calendar, Home, LayoutGrid, LogOut, Search, Stethoscope, User as UserIcon,
  type LucideIcon,
} from 'lucide-react';
import { getUser, homeFor, initials, logout } from '../lib/api';

interface NavItem {
  to: string;
  end?: boolean;
  label: string;
  icon: LucideIcon;
}
interface NavGroup {
  section: string;
  links: NavItem[];
}

const PATIENT_NAV: NavGroup[] = [
  {
    section: 'Scheduling',
    links: [
      { to: '/app', end: true, label: 'Dashboard', icon: Home },
      { to: '/app/doctors', label: 'Find a Doctor', icon: Search },
      { to: '/app/appointments', label: 'My Appointments', icon: Calendar },
    ],
  },
  {
    section: 'Account',
    links: [{ to: '/app/profile', label: 'Profile', icon: UserIcon }],
  },
];

const ADMIN_NAV: NavGroup[] = [
  {
    section: 'Clinic',
    links: [
      { to: '/admin', end: true, label: 'Overview', icon: LayoutGrid },
      { to: '/admin/appointments', label: 'Appointments', icon: Calendar },
      { to: '/admin/doctors', label: 'Doctors', icon: Stethoscope },
    ],
  },
];

/** App shell: navy background, sidebar, floating white content panel. */
export default function Layout() {
  const user = getUser();

  useEffect(() => {
    document.body.classList.add('has-sidebar');
    return () => document.body.classList.remove('has-sidebar');
  }, []);

  if (!user) return null; // Protected handles the redirect.
  const groups = user.role === 'admin' ? ADMIN_NAV : PATIENT_NAV;

  return (
    <>
      <aside className="sidebar">
        <Link className="brand" to={homeFor(user)}>
          MAP<b>S</b>
        </Link>
        <nav className="side-nav">
          {groups.map((g) => (
            <div className="side-group" key={g.section}>
              <div className="side-section">{g.section}</div>
              {g.links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}
                >
                  <l.icon className="lucide" aria-hidden="true" />
                  <span className="label">{l.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <span className="avatar sm">{initials(user.full_name)}</span>
            <span className="side-user-meta">
              <span className="name">{user.full_name}</span>
              <span className="role">{user.role === 'admin' ? 'Administrator' : 'Patient'}</span>
            </span>
          </div>
          <button className="btn secondary sm block" onClick={logout}>
            <LogOut className="lucide in-btn" /> Log out
          </button>
        </div>
      </aside>
      <main className="page">
        <Outlet />
      </main>
    </>
  );
}
