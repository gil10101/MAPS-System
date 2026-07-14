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

  // ---- Navbar -------------------------------------------------------------
  const PATIENT_LINKS = [
    { href: '/app/dashboard.html',    label: 'Dashboard', icon: '🏠' },
    { href: '/app/doctors.html',      label: 'Find a Doctor', icon: '🔍' },
    { href: '/app/appointments.html', label: 'My Appointments', icon: '📅' },
    { href: '/app/profile.html',      label: 'Profile', icon: '👤' },
  ];
  const ADMIN_LINKS = [
    { href: '/admin/dashboard.html',    label: 'Overview', icon: '📊' },
    { href: '/admin/appointments.html', label: 'Appointments', icon: '📅' },
    { href: '/admin/doctors.html',      label: 'Doctors', icon: '🩺' },
  ];

  function renderNav() {
    const host = document.getElementById('navbar');
    if (!host) return;
    const user = getUser();
    if (!user) return;
    const links = user.role === 'admin' ? ADMIN_LINKS : PATIENT_LINKS;
    const here = location.pathname;
    const home = homeFor(user);

    host.innerHTML = `
      <nav class="navbar">
        <div class="inner">
          <a class="brand" href="${home}">
            <span class="logo">M+</span> MAPS
          </a>
          <div class="nav-links">
            ${links
              .map(
                (l) =>
                  `<a href="${l.href}" class="${here === l.href ? 'active' : ''}">
                     <span aria-hidden="true">${l.icon}</span>
                     <span class="label">${l.label}</span>
                   </a>`
              )
              .join('')}
          </div>
          <div class="nav-user">
            <span class="who">${escapeHtml(user.full_name)}${
      user.role === 'admin' ? ' · Admin' : ''
    }</span>
            <button class="btn secondary sm" onclick="MAPS.logout()">Log out</button>
          </div>
        </div>
      </nav>`;
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

  return {
    api, setSession, getToken, getUser, clearSession, logout,
    requireAuth, homeFor, renderNav, toast,
    escapeHtml, statusBadge, formatDate, formatTime, initials, todayStr,
  };
})();
