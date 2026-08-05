/**
 * Physician picker — a search box with live results, not a dropdown.
 *
 * A `<select>` is fine for the seven providers a demo practice has and useless
 * for the two hundred a real group practice has: every name is in the DOM, the
 * list cannot be filtered, and finding someone means scrolling a column of
 * identically-shaped strings. This filters as the reader types, with no Enter
 * to press and no round trip — the directory is already in memory, so matching
 * happens locally and the list narrows on each keystroke.
 *
 * An empty query lists everyone, so the control still answers "who is there?"
 * before it answers "where is this one person?".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Doctor } from '../lib/api';
import { Avatar, cx } from './ui';

/** Fold case and strip the honorific so "kim" matches "Dr. Sarah Kim". */
function haystack(d: Doctor): string {
  return [d.full_name, d.first_name, d.last_name, d.specialty_name, d.room]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Rank matches so the useful ones surface first: a surname that starts with the
 * query beats one that merely contains it, which beats a specialty match.
 * Without this, typing "kim" puts every Family Medicine physician above Dr. Kim.
 */
function score(d: Doctor, q: string): number {
  const last = (d.last_name || '').toLowerCase();
  const first = (d.first_name || '').toLowerCase();
  if (last.startsWith(q)) return 0;
  if (first.startsWith(q)) return 1;
  if (last.includes(q) || first.includes(q)) return 2;
  return 3;
}

export interface PhysicianPickerProps {
  doctors: Doctor[];
  /** Currently chosen physician id, as a string to match the caller's state. */
  value: string;
  onChange: (id: string) => void;
  /** Rendered when nothing is chosen yet. */
  placeholder?: string;
  id?: string;
  className?: string;
}

export default function PhysicianPicker({
  doctors, value, onChange, placeholder = 'Search physicians by name, specialty, or room…',
  id = 'physician-picker', className,
}: PhysicianPickerProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = doctors.find((d) => String(d.id) === value) ?? null;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    // No query is not an empty result: it is the whole directory.
    if (!q) return doctors;
    return doctors
      .filter((d) => haystack(d).includes(q))
      .sort((a, b) => score(a, q) - score(b, q) || a.last_name.localeCompare(b.last_name));
  }, [doctors, query]);

  // Keep the highlight inside the list as it narrows under the reader.
  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function choose(d: Doctor) {
    onChange(String(d.id));
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setCursor((c) => {
        const next = e.key === 'ArrowDown' ? c + 1 : c - 1;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' && open && results[cursor]) {
      e.preventDefault();
      choose(results[cursor]);
    }
  }

  return (
    <div ref={wrap} className={cx('relative', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          className="input pl-9 pr-9"
          placeholder={selected ? selected.full_name : placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
        )}
      </div>

      {open && (
        <div
          id={`${id}-list`}
          role="listbox"
          className="absolute z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200"
        >
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              No physician matches “{query.trim()}”.
            </p>
          ) : (
            results.map((d, i) => {
              const isSelected = String(d.id) === value;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(d)}
                  className={cx(
                    'flex w-full items-center gap-3 px-3 py-2 text-left',
                    i === cursor ? 'bg-accent-50' : 'hover:bg-slate-50'
                  )}
                >
                  <Avatar name={d.full_name} src={d.photo_url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {d.full_name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {d.specialty_name || 'No specialty'}
                      {d.room ? ` · Room ${d.room}` : ''}
                      {d.active === false ? ' · Not accepting bookings' : ''}
                    </span>
                  </span>
                  {isSelected && (
                    <Check className="h-4 w-4 flex-none text-accent-600" aria-hidden="true" />
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
