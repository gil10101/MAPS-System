/**
 * The MediSync app shell.
 *
 * Phones get a top bar plus a bottom tab bar; tablets and up get the navy
 * sidebar. Both navigations render from the same group definitions, so a route
 * can never exist in one and be missing from the other.
 *
 * The shell itself is the navy surface; page content floats on a white panel
 * inside it. On desktop that panel is the scroll container, which keeps the
 * sidebar and the notification tray fixed while a long report scrolls.
 *
 * Geometry, and why it is worth being exact about: the top bar is PHONE ONLY.
 * At desktop it must not render at all, because a header that occupies a strip
 * of height above the panel pushes the panel down and shortens it by the same
 * amount — the panel then neither starts level with the sidebar nor reaches
 * the bottom of the screen. So the panel is a full-height sibling of the
 * sidebar with one equal margin on all four sides, and the tray the top bar
 * used to carry moves into the sidebar header rather than being lost.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import {
  Bell, BarChart3, Calendar, CalendarClock, CalendarRange, Check, Home,
  LayoutGrid, LogOut, MapPin, MoreHorizontal, Pill, Search, Stethoscope,
  Tags, User as UserIcon, Users, X,
  type LucideIcon,
} from 'lucide-react';
import {
  formatRelative, getUser, homeFor, listNotifications, logout,
  markAllNotificationsRead, markNotificationRead, roleLabel,
  type Notification,
} from '../lib/api';
import { Avatar, IconButton, cx } from './ui';

interface NavItem {
  to: string;
  /** Exact-match the route: index routes would otherwise stay lit everywhere. */
  end?: boolean;
  label: string;
  /** Tab-bar caption, for labels too long for a 5-across bar. */
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
    section: 'My care',
    links: [
      { to: '/app/medications', label: 'Medications', short: 'Meds', icon: Pill },
    ],
  },
  {
    section: 'Account',
    links: [{ to: '/app/profile', label: 'Profile', icon: UserIcon }],
  },
];

const DOCTOR_NAV: NavGroup[] = [
  {
    section: 'Practice',
    links: [
      { to: '/doctor', end: true, label: 'Schedule', icon: CalendarClock },
      { to: '/doctor/patients', label: 'My Patients', short: 'Patients', icon: Users },
      { to: '/doctor/refills', label: 'Refill Requests', short: 'Refills', icon: Pill },
      { to: '/doctor/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
];

const ADMIN_NAV: NavGroup[] = [
  {
    section: 'Clinic',
    links: [
      { to: '/admin', end: true, label: 'Overview', icon: LayoutGrid },
      { to: '/admin/appointments', label: 'Appointments', short: 'Appts', icon: Calendar },
      { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    section: 'Setup',
    links: [
      { to: '/admin/doctors', label: 'Physicians', icon: Stethoscope },
      { to: '/admin/schedules', label: 'Schedules', icon: CalendarRange },
      { to: '/admin/locations', label: 'Locations', icon: MapPin },
      { to: '/admin/specialties', label: 'Specialties', icon: Tags },
    ],
  },
];

/** How many links fit across a phone before the captions start truncating. */
const MAX_TABS = 5;

/** Tailwind's `md`, in the one place the shell needs to know it in JS. */
const DESKTOP_QUERY = '(min-width: 768px)';

/**
 * The tray lives in the phone top bar and in the desktop sidebar — two
 * different places in the tree, not one element that moves. Rendering both and
 * hiding one with `md:hidden` would mount the component twice and poll the
 * server twice for a tray only one of which is ever on screen, so the shell
 * asks which breakpoint it is at and mounts exactly one.
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia(DESKTOP_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(query.matches);
    // Re-read on mount as well as on change: the window can be resized between
    // the initial render and this listener being attached.
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return isDesktop;
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx('text-lg font-bold tracking-tight text-white', className)}>
      Medi<span className="text-accent-500">Sync</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Notification tray (A7)
// ---------------------------------------------------------------------------

/**
 * Polls every 60s rather than opening a socket: the events here (a booking
 * approved, a refill decided) are minutes-scale, and a prototype that survives
 * a dropped connection by simply asking again is worth more than push.
 *
 * `align` is which edge the panel hangs from. In the phone top bar the bell is
 * at the right of the screen so the panel opens leftwards; in the sidebar it
 * would open off the left of the viewport, so there it opens rightwards over
 * the content panel instead.
 */
function NotificationTray({
  align = 'right', size = 'md',
}: { align?: 'left' | 'right'; size?: 'sm' | 'md' }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await listNotifications();
      setItems(data.notifications);
      setUnread(data.unread_count);
    } catch {
      // A failed poll is not worth interrupting the page for; the next one in
      // 60 seconds will pick the tray back up.
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Optimistic: the tray reflects the click immediately, the server catches up. */
  async function readOne(n: Notification) {
    if (n.read_at) return;
    setItems((list) =>
      list.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i))
    );
    setUnread((c) => Math.max(0, c - 1));
    try {
      await markNotificationRead(n.id);
    } catch {
      load();
    }
  }

  async function readAll() {
    const stamp = new Date().toISOString();
    setItems((list) => list.map((i) => (i.read_at ? i : { ...i, read_at: stamp })));
    setUnread(0);
    try {
      await markAllNotificationsRead();
    } catch {
      load();
    }
  }

  return (
    <div className="relative" ref={wrap}>
      <IconButton
        icon={Bell}
        size={size}
        label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="bg-white/10 text-white hover:bg-white/20"
      />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent-500 px-1 text-[0.625rem] font-bold text-white ring-2 ring-navy-900"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      )}

      {open && (
        <div
          className={cx(
            'absolute top-[calc(100%+0.5rem)] z-50 w-[22rem] max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-slate-200',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
            <h3>Notifications</h3>
            <button
              type="button"
              onClick={readAll}
              disabled={unread === 0}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent-600 hover:bg-accent-50 disabled:pointer-events-none disabled:text-slate-300"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </button>
          </div>

          <div className="max-h-[24rem] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                Nothing here yet. Updates about your appointments will show up in this tray.
              </p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => readOne(n)}
                  className={cx(
                    'flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50',
                    !n.read_at && 'bg-accent-50 hover:bg-accent-50/70'
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      'mt-1.5 h-2 w-2 flex-none rounded-full',
                      n.read_at ? 'bg-transparent' : 'bg-accent-600'
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cx(
                          'truncate text-sm',
                          n.read_at ? 'font-medium text-slate-700' : 'font-bold text-slate-900'
                        )}
                      >
                        {n.title}
                      </span>
                      <span className="flex-none text-xs text-slate-400">
                        {formatRelative(n.created_at)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
                      {n.body}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function Layout() {
  const user = getUser();
  const [moreOpen, setMoreOpen] = useState(false);
  const isDesktop = useIsDesktop();

  // Protected handles the redirect; rendering nothing avoids a flash of chrome
  // belonging to a user who is not signed in.
  if (!user) return null;

  const groups =
    user.role === 'admin' ? ADMIN_NAV : user.role === 'doctor' ? DOCTOR_NAV : PATIENT_NAV;
  const allLinks = groups.flatMap((g) => g.links);
  // Admin has more destinations than a phone bar can hold. Show the first four
  // and put the rest behind "More" — every route stays reachable on mobile.
  const overflow = allLinks.length > MAX_TABS;
  const tabs = overflow ? allLinks.slice(0, MAX_TABS - 1) : allLinks;

  return (
    <div className="flex min-h-dvh flex-col bg-navy-900 md:h-dvh md:flex-row md:overflow-hidden">
      {/* Sidebar — tablet and up. Its padding matches the panel's margin so the
          wordmark and the panel's top edge start on the same line. */}
      <aside className="hidden w-sidebar flex-none flex-col p-3 md:flex">
        <div className="mb-6 flex items-center justify-between gap-2 pl-2">
          <Link to={homeFor(user)}>
            <Wordmark />
          </Link>
          {/* Compact here on purpose: a full 44px bell makes this row taller
              than the wordmark and drops it below the panel's top edge. */}
          {isDesktop && <NotificationTray align="left" size="sm" />}
        </div>

        <nav className="flex-1 overflow-y-auto" aria-label="Main">
          {groups.map((g) => (
            <div className="mb-6" key={g.section}>
              <div className="px-3 pb-2 text-[0.68rem] font-bold uppercase tracking-widest text-white/50">
                {g.section}
              </div>
              {g.links.map((l) => (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  className={({ isActive }) =>
                    cx(
                      'mb-0.5 flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                      isActive
                        ? 'bg-white/15 font-semibold text-white'
                        : 'font-medium text-white/70 hover:bg-white/10 hover:text-white'
                    )
                  }
                >
                  <l.icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                  {l.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 pt-4">
          <div className="mb-3 flex items-center gap-3 px-1">
            <Avatar name={user.full_name} size="sm" className="bg-white/10" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-white">{user.full_name}</span>
              <span className="text-xs text-white/50">{roleLabel(user.role)}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex min-h-tap w-full items-center justify-center gap-2 rounded-lg bg-white/10 text-sm font-semibold text-white hover:bg-white/20"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Log out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — phones only. `md:hidden` is load-bearing: at desktop this
            row would otherwise still take height above the panel, which is
            what shortened the panel and knocked it out of line. */}
        <header className="flex items-center gap-2 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top,0px))] md:hidden">
          <Link to={homeFor(user)}>
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {!isDesktop && <NotificationTray />}
            <Avatar name={user.full_name} size="sm" className="bg-white/10" />
            <IconButton
              icon={LogOut}
              label="Log out"
              onClick={logout}
              className="bg-white/10 text-white hover:bg-white/20"
            />
          </div>
        </header>

        {/* The white panel. Equal margin on all four sides, full height of the
            shell, and its own scrollbar so the sidebar stays put. */}
        <main className="flex-1 bg-white md:m-3 md:min-h-0 md:overflow-y-auto md:rounded-xl">
          <div className="mx-auto w-full max-w-content px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Bottom tab bar — phones only */}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-white/10 bg-navy-900 pb-[env(safe-area-inset-bottom,0px)] md:hidden"
        aria-label="Main"
      >
        {tabs.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              cx(
                'flex h-tabbar min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold',
                isActive ? 'text-white' : 'text-white/50'
              )
            }
          >
            {({ isActive }) => (
              <>
                <l.icon
                  className={cx('h-[1.125rem] w-[1.125rem]', isActive && 'text-accent-500')}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate px-0.5">{l.short || l.label}</span>
              </>
            )}
          </NavLink>
        ))}
        {overflow && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="flex h-tabbar min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[0.68rem] font-semibold text-white/50"
          >
            <MoreHorizontal className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
            <span>More</span>
          </button>
        )}
      </nav>

      {/* Overflow sheet for the links the tab bar could not fit */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-navy-900/60 md:hidden"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMoreOpen(false);
          }}
        >
          <div className="max-h-[80dvh] w-full overflow-y-auto rounded-t-xl bg-white px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3>Menu</h3>
              <IconButton
                icon={X}
                label="Close menu"
                variant="ghost"
                onClick={() => setMoreOpen(false)}
              />
            </div>
            {groups.map((g) => (
              <div key={g.section} className="mb-3">
                <div className="px-1 pb-1 text-[0.68rem] font-bold uppercase tracking-widest text-slate-400">
                  {g.section}
                </div>
                {g.links.map((l) => (
                  <NavLink
                    key={l.to}
                    to={l.to}
                    end={l.end}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'flex min-h-tap items-center gap-3 rounded-lg px-3 text-sm',
                        isActive
                          ? 'bg-accent-50 font-semibold text-accent-700'
                          : 'font-medium text-slate-700 hover:bg-slate-100'
                      )
                    }
                  >
                    <l.icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                    {l.label}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
