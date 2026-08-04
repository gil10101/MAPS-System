/**
 * Transient confirmations — "Appointment requested", "Refill approved".
 *
 * The provider owns the queue rather than each page owning a banner, so a
 * message raised in the same handler that navigates still survives to be read
 * on the page that follows.
 *
 * Shape and position come from the `.toast` / `#toast-host` component classes
 * in styles.css: the host is a fixed overlay whose geometry has to account for
 * the safe-area insets, which is a stylesheet concern rather than a per-render
 * one. Tone is the class the caller's type selects.
 */
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

type ToastType = '' | 'success' | 'error';
type ToastFn = (message: string, type?: ToastType) => void;

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

/** No-op default: calling useToast outside the provider must not throw during
    a render, it just means nothing is listening. */
const ToastContext = createContext<ToastFn>(() => {});

/** Module scope, not component state: ids have to stay unique across every
    provider re-render, and the value is never read during rendering. */
let nextId = 1;

const LIFETIME_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback<ToastFn>((message, type = '') => {
    const id = nextId++;
    setItems((s) => [...s, { id, message, type }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), LIFETIME_MS);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Polite rather than assertive: these confirm what the user just did,
          so they should wait their turn behind whatever is being read out. */}
      <div id="toast-host" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('toast', t.type)}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  return useContext(ToastContext);
}
