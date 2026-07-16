/**
 * Small shared UI pieces: modal, status badge, spinner, empty state, row menu.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BellRing, Check, MoreHorizontal, X, type LucideIcon } from 'lucide-react';
import {
  CONFIRMATION_LABEL, STATUS_LABEL,
  type ApptStatus, type ConfirmationStatus,
} from '../lib/api';

export function Badge({ status }: { status: ApptStatus }) {
  return <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

/**
 * The patient-confirmation axis, rendered beside the lifecycle Badge.
 * Only meaningful while an appointment is still upcoming — whether someone
 * answered a reminder for a visit that already happened is noise.
 */
export function ConfirmBadge({
  status, confirmation,
}: { status: ApptStatus; confirmation: ConfirmationStatus }) {
  if (status !== 'booked') return null;
  const yes = confirmation === 'confirmed';
  const Icon = yes ? Check : BellRing;
  return (
    <span
      className={`badge ${yes ? 'confirm-yes' : 'confirm-no'}`}
      title={CONFIRMATION_LABEL[confirmation]}
    >
      <Icon className="lucide" aria-hidden="true" />
      {yes ? 'Confirmed' : 'Awaiting reply'}
    </span>
  );
}

/**
 * Overflow menu for secondary row actions. Keeping only the one likely action
 * inline and hiding the rest behind this stops each row from turning into a
 * wall of competing buttons.
 */
export function RowMenu({ children, label = 'More actions' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

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

  return (
    <div className="row-menu" ref={wrap}>
      <button
        className="btn secondary sm icon-only"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="lucide" aria-hidden="true" />
      </button>
      {open && (
        <div className="row-menu-pop" role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick, children, danger,
}: { onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} role="menuitem" onClick={onClick}>
      {children}
    </button>
  );
}

export function Spinner() {
  return (
    <div className="loading-wrap">
      <span className="spinner" />
    </div>
  );
}

export function Empty({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon className="lucide lg" />
      <div>{children}</div>
    </div>
  );
}

interface ReasonModalProps {
  open: boolean;
  title: string;
  /** Rendered above the picker — say what is about to happen, and to whom. */
  intro?: ReactNode;
  presets: string[];
  confirmLabel: string;
  /** Dismiss-button text. "Keep appointment" fits a cancel flow but not a
      no-show recording, so callers can override. */
  dismissLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Reason capture for destructive transitions. Cancels and no-shows are what a
 * practice reports on, so the reason is required rather than optional — a bare
 * "are you sure?" throws away the only fact worth keeping. Presets cover the
 * common cases; free text handles the rest.
 */
export function ReasonModal({
  open, title, intro, presets, confirmLabel, dismissLabel = 'Keep appointment',
  busy, onCancel, onConfirm,
}: ReasonModalProps) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');

  useEffect(() => {
    if (open) { setChoice(''); setOther(''); }
  }, [open]);

  const reason = choice === '__other' ? other.trim() : choice;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn secondary" onClick={onCancel}>
            {dismissLabel}
          </button>
          <button className="btn danger" disabled={!reason || busy} onClick={() => onConfirm(reason)}>
            {busy ? 'Saving…' : confirmLabel}
          </button>
        </>
      }
    >
      {intro}
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="reason-select">Reason (required)</label>
        <select id="reason-select" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Select a reason…</option>
          {presets.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
          <option value="__other">Other…</option>
        </select>
        {choice === '__other' && (
          <textarea
            style={{ marginTop: 'var(--s2)' }}
            placeholder="Describe the reason"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, title, onClose, children, footer }: ModalProps) {
  return (
    <div
      className={`modal-backdrop${open ? ' open' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="close" onClick={onClose} aria-label="Close">
            <X className="lucide" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
