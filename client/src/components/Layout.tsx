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
  /** Tab-bar caption. Falls back to `label` when it already fits. */
  short?: string;
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
      { to: '/app/doctors', label: 'Find a Doctor', short: 'Doctors', icon: Search },
      { to: '/app/appointments', label: 'My Appointments', short: 'Appts', icon: Calendar },
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
      { to: '/admin/appointments', label: 'Appointments', short: 'Appts', icon: Calendar },
      { to: '/admin/doctors', label: 'Doctors', icon: Stethoscope },
    ],
  },
];

/**
 * App shell. Phones get a top bar plus a bottom tab bar; tablets and up get the
 * navy sidebar. Both navigations render from the same groups — CSS decides
 * which is visible, so there is one source of truth for the routes.
 */
export default function Layout() {
  const user = getUser();

  useEffect(() => {
    document.body.classList.add('has-sidebar');
    return () => document.body.classList.remove('has-sidebar');
  }, []);

  if (!user) return null; // Protected handles the redirect.
  const groups = user.role === 'admin' ? ADMIN_NAV : PATIENT_NAV;
  const tabs = groups.flatMap((g) => g.links);

  return (
    <>
      <header className="topbar">
        <Link className="brand" to={homeFor(user)}>
          MAP<b>S</b>
        </Link>
        <div className="topbar-right">
          <span className="avatar sm" title={user.full_name}>
            {initials(user.full_name)}
          </span>
          <button className="icon-btn" onClick={logout} aria-label="Log out">
            <LogOut className="lucide" aria-hidden="true" />
          </button>
        </div>
      </header>

      <aside className="sidebar">
        <Link className="brand" to={homeFor(user)}>
          MAP<b>S</b>
        </Link>
        <nav className="side-nav" aria-label="Main">
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

      <nav className="tabbar" aria-label="Main">
        {tabs.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `tab-link${isActive ? ' active' : ''}`}
          >
            <l.icon className="lucide" aria-hidden="true" />
            <span className="label">{l.short || l.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
