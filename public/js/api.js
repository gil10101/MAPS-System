/* ==========================================================================
   MAPS frontend shared library.
   Provides: token storage, an API fetch wrapper, auth guards, navbar
   rendering, toasts, and small formatting helpers. Loaded on every page.
   ========================================================================== */

const MAPS = (() => {
  const TOKEN_KEY = 'maps_token';
  const USER_KEY = 'maps_user';

  // ---- Auth storage -------------------------------------------------------
  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); }
    catch { return null; }
  }
  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  function logout() {
    clearSession();
    window.location.href = '/login.html';
  }

  // ---- API fetch wrapper --------------------------------------------------
  async function api(pathname, { method = 'GET', body, auth = true } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;

    const res = await fetch(`/api${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* no body */ }

    if (res.status === 401 && auth) {
      // Session expired/invalid — bounce to login.
      clearSession();
      if (!location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
      }
    }
    if (!res.ok) {
      const message = (data && data.error) || `Request failed (${res.status}).`;
      throw new Error(message);
    }
    return data;
  }

  // ---- Auth guards --------------------------------------------------------
  /** Redirect to login if not authenticated. Optionally enforce a role. */
  function requireAuth(role) {
    const user = getUser();
    if (!getToken() || !user) {
      window.location.href = '/login.html';
      return null;
    }
    if (role && user.role !== role) {
      // Send user to their correct home.
      window.location.href = user.role === 'admin' ? '/admin/dashboard.html' : '/app/dashboard.html';
      return null;
    }
    return user;
  }

  function homeFor(user) {
    return user && user.role === 'admin' ? '/admin/dashboard.html' : '/app/dashboard.html';
  }

  // ---- Icons (Lucide, inlined as SVG paths) -------------------------------
  // https://lucide.dev — ISC licensed. Rendered with currentColor stroke.
  const ICON_PATHS = {
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
    stethoscope: '<path d="M11 2v2"/><path d="M5 2v2"/><path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"/><path d="M8 15a6 6 0 0 0 12 0v-3"/><circle cx="20" cy="10" r="2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
    'bar-chart': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  };

  function icon(name, cls = '') {
    const path = ICON_PATHS[name] || '';
    return `<svg class="lucide ${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  /** Replace any element with a data-icon attribute with a leading Lucide icon. */
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.dataset.iconDone) return;
      el.dataset.iconDone = '1';
      const cls = el.classList.contains('btn') ? 'in-btn' : '';
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, cls));
    });
  }

  // ---- Sidebar navigation -------------------------------------------------
  // Grouped links, rendered as a left sidebar (see renderNav).
  const PATIENT_NAV = [
    {
      section: 'Scheduling',
      links: [
        { href: '/app/dashboard.html',    label: 'Dashboard', icon: 'home' },
        { href: '/app/doctors.html',      label: 'Find a Doctor', icon: 'search' },
        { href: '/app/appointments.html', label: 'My Appointments', icon: 'calendar' },
      ],
    },
    {
      section: 'Account',
      links: [{ href: '/app/profile.html', label: 'Profile', icon: 'user' }],
    },
  ];
  const ADMIN_NAV = [
    {
      section: 'Clinic',
      links: [
        { href: '/admin/dashboard.html',    label: 'Overview', icon: 'dashboard' },
        { href: '/admin/appointments.html', label: 'Appointments', icon: 'calendar' },
        { href: '/admin/doctors.html',      label: 'Doctors', icon: 'stethoscope' },
      ],
    },
  ];

  function renderNav() {
    const host = document.getElementById('navbar');
    if (!host) return;
    const user = getUser();
    if (!user) return;
    const groups = user.role === 'admin' ? ADMIN_NAV : PATIENT_NAV;
    const here = location.pathname;
    const home = homeFor(user);

    const groupsHtml = groups
      .map(
        (g) => `
          <div class="side-group">
            <div class="side-section">${g.section}</div>
            ${g.links
              .map(
                (l) => `
                  <a href="${l.href}" class="side-link ${here === l.href ? 'active' : ''}">
                    ${icon(l.icon)}
                    <span class="label">${l.label}</span>
                  </a>`
              )
              .join('')}
          </div>`
      )
      .join('');

    host.innerHTML = `
      <aside class="sidebar">
        <a class="brand" href="${home}">MAP<b>S</b></a>
        <nav class="side-nav">${groupsHtml}</nav>
        <div class="side-foot">
          <div class="side-user">
            <span class="avatar sm">${initials(user.full_name)}</span>
            <span class="side-user-meta">
              <span class="name">${escapeHtml(user.full_name)}</span>
              <span class="role">${user.role === 'admin' ? 'Administrator' : 'Patient'}</span>
            </span>
          </div>
          <button class="btn secondary sm block" onclick="MAPS.logout()">${icon('logout', 'in-btn')} Log out</button>
        </div>
      </aside>`;
    document.body.classList.add('has-sidebar');
  }

  // ---- Toast --------------------------------------------------------------
  function toast(message, type = '') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  // ---- Helpers ------------------------------------------------------------
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusBadge(status) {
    return `<span class="badge ${status}">${status}</span>`;
  }

  /** 'YYYY-MM-DD' -> 'Mon, Jul 20, 2026' */
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(`${dateStr}T12:00:00`);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  /** 'HH:MM' 24h -> '9:30 AM' */
  function formatTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hh = h % 12 || 12;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function initials(name) {
    return (name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  /** Today's date as 'YYYY-MM-DD' in local time. */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  }

  // Hydrate any static [data-icon] elements once the DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hydrateIcons());
  } else {
    hydrateIcons();
  }

  return {
    api, setSession, getToken, getUser, clearSession, logout,
    requireAuth, homeFor, renderNav, toast, icon, hydrateIcons,
    escapeHtml, statusBadge, formatDate, formatTime, initials, todayStr,
  };
})();
