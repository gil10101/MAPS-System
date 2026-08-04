/**
 * MediSync design tokens.
 *
 * ESM syntax because client/package.json sets "type": "module" — a
 * `module.exports` here would throw at config load.
 *
 * The palette is deliberately tiny: a navy app shell, one blue accent, and
 * Tailwind's stock slate/emerald/amber/red for neutrals and status. Anything a
 * page needs beyond this should be built from utilities, not a new token.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The shell. 900 is the page background, 800/700 are raised surfaces
        // inside it (active nav item, hover states).
        navy: { 900: '#0F172A', 800: '#1E293B', 700: '#334155' },
        // One accent, used for primary actions and the "you are here" state.
        // 700 exists only so 600 has a hover step; 50 is the tint behind
        // selected slots, unread notifications and info badges.
        accent: { 700: '#1D4ED8', 600: '#2563EB', 500: '#3B82F6', 50: '#EFF6FF' },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto',
          'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      spacing: {
        // WCAG 2.5.5 minimum comfortable touch target. Named so buttons and
        // menu items can all say `min-h-tap` instead of repeating 2.75rem.
        tap: '2.75rem',
        // Shell geometry, shared by the sidebar and the bottom tab bar: the
        // page has to reserve exactly as much room as the bar occupies.
        sidebar: '15.5rem',
        tabbar: '3.5rem',
      },
      minHeight: {
        tap: '2.75rem',
      },
      maxWidth: {
        // Measure of the white content panel. Wider than this and table rows
        // become hard to track across — but the operational tables carry seven
        // columns and an action, so the gutter is kept tight to give them room.
        content: '75.625rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(-.25rem)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'fade-in': 'fade-in .12s ease-out',
      },
    },
  },
  plugins: [],
};
