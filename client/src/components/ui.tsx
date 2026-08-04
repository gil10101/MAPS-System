/**
 * MediSync UI primitives.
 *
 * Every page is assembled from these. They exist so that a button, a table or
 * a status badge looks and behaves the same in the patient portal, the
 * physician portal and the admin console — three surfaces built by different
 * hands that have to read as one product.
 *
 * Styling rule: the shared shape comes from a class in styles.css's components
 * layer, and per-instance overrides are plain utilities passed through
 * `className`. Utilities are emitted after components, so an override always
 * wins without `!important`.
 */
import {
  useEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type LabelHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TdHTMLAttributes,
  type TextareaHTMLAttributes, type ThHTMLAttributes,
} from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Loader2, MoreHorizontal, X, type LucideIcon,
} from 'lucide-react';
import {
  PATIENT_STATUS_LABEL, STAFF_STATUS_LABEL, STATUS_TONE, initials,
  type ApptStatus, type Tone,
} from '../lib/api';

/** Join class names, dropping the falsy ones a conditional leaves behind. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ===========================================================================
// Surfaces
// ===========================================================================

interface CardProps {
  /** A string renders as an h2; pass a node to build the heading yourself. */
  title?: ReactNode;
  /** Controls that belong to this card, right-aligned beside the title. */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Card({ title, actions, className, children }: CardProps) {
  return (
    <div className={cx('card', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {typeof title === 'string' ? (
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          ) : (
            title
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Renders a back link above the title — for detail pages like a chart. */
  back?: { to: string; label: string };
}

export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          to={back.to}
          className="mb-1 inline-flex min-h-tap items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1>{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ===========================================================================
// Buttons
// ===========================================================================

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

/**
 * The class string behind <Button>, exported so a react-router <Link> can be
 * painted as a button without being wrapped in one.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  block = false
): string {
  return cx(
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    variant === 'danger' && 'btn-danger',
    size === 'sm' && 'btn-sm',
    block && 'w-full'
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  icon?: LucideIcon;
  /** Shows a spinner and blocks re-submission while a request is in flight. */
  loading?: boolean;
}

export function Button({
  variant = 'secondary', size = 'md', block, icon: Icon, loading,
  className, children, disabled, type = 'button', ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(buttonClasses(variant, size, block), className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        Icon && <Icon className="h-4 w-4" aria-hidden="true" />
      )}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Required: an icon with no accessible name is an unlabelled control. */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function IconButton({
  icon: Icon, label, variant = 'secondary', size = 'md', className, type = 'button', ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        buttonClasses(variant, size),
        'px-0',
        size === 'sm' ? 'w-tap md:w-9' : 'w-tap',
        className
      )}
      {...rest}
    >
      <Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
    </button>
  );
}

// ===========================================================================
// Forms
// ===========================================================================

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cx('label', className)} {...rest}>
      {children}
    </label>
  );
}

interface FieldProps {
  label: string;
  /** Must match the control's id, or the label labels nothing. */
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={cx('mb-4', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx('input', className)} {...rest}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('input min-h-[5.5rem] resize-y py-3', className)} {...rest} />;
}

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

/** Label wraps the box so the text is part of the target, not just next to it. */
export function Checkbox({ label, hint, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3 py-2', className)}>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 flex-none rounded border-slate-300 text-accent-600 focus:ring-accent-600"
        {...rest}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Filter rows. auto-fit rather than a fixed column count: a page with three
 * filters and a page with five both reflow correctly without a bespoke grid.
 */
export function FilterBar({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx('grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11rem,1fr))]', className)}
    >
      {children}
    </div>
  );
}

// ===========================================================================
// Tables
// ===========================================================================

/**
 * Wraps the table in its own scroll container: a wide report may scroll
 * sideways, but it must never make the whole page scroll sideways.
 */
export function Table({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cx('table-base', className)}>{children}</table>
    </div>
  );
}

interface CellProps {
  align?: 'left' | 'center' | 'right';
}

export function Th({
  align = 'left', className, children, ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <th
      scope="col"
      className={cx(align === 'right' && 'text-right', align === 'center' && 'text-center', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  align = 'left', className, children, ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & CellProps) {
  return (
    <td
      className={cx(align === 'right' && 'text-right', align === 'center' && 'text-center', className)}
      {...rest}
    >
      {children}
    </td>
  );
}

// ===========================================================================
// Badges
// ===========================================================================

const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-accent-50 text-accent-700',
};

interface BadgeProps {
  tone?: Tone;
  icon?: LucideIcon;
  className?: string;
  title?: string;
  children: ReactNode;
}

export function Badge({ tone = 'slate', icon: Icon, className, title, children }: BadgeProps) {
  return (
    <span className={cx('badge', TONE_CLASS[tone], className)} title={title}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

/**
 * Appointment status, worded for its audience: a patient waiting on the clinic
 * reads "Pending approval"; the staff member who has to act on it reads
 * "Pending". Same row in the database, two different sentences.
 */
export function StatusBadge({
  status, variant, className,
}: { status: ApptStatus; variant: 'patient' | 'staff'; className?: string }) {
  const label =
    variant === 'patient' ? PATIENT_STATUS_LABEL[status] : STAFF_STATUS_LABEL[status];
  return (
    <Badge tone={STATUS_TONE[status]} className={className}>
      {label ?? status}
    </Badge>
  );
}

/**
 * Shown alongside the status badge, never instead of it: an appointment caught
 * by a schedule block is still confirmed — it just cannot go ahead as booked.
 */
export function RescheduleBadge({ className }: { className?: string }) {
  return (
    <Badge tone="amber" icon={AlertTriangle} className={className}>
      Needs rescheduling
    </Badge>
  );
}

// ===========================================================================
// Feedback
// ===========================================================================

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="px-4 py-12 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const ALERT_CLASS = {
  info: 'bg-accent-50 text-accent-700',
  success: 'bg-emerald-50 text-emerald-800',
  warning: 'bg-amber-50 text-amber-900',
  error: 'bg-red-50 text-red-800',
};

interface AlertProps {
  tone?: keyof typeof ALERT_CLASS;
  icon?: LucideIcon;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Alert({ tone = 'info', icon: Icon, title, className, children }: AlertProps) {
  return (
    <div
      className={cx('flex gap-3 rounded-lg px-4 py-3 text-sm', ALERT_CLASS[tone], className)}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {Icon && <Icon className="mt-0.5 h-[1.125rem] w-[1.125rem] flex-none" aria-hidden="true" />}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

// ===========================================================================
// Navigation & display
// ===========================================================================

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs, active, onChange, className,
}: { tabs: TabItem[]; active: string; onChange: (id: string) => void; className?: string }) {
  return (
    <div className={cx('mb-4 flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px min-h-tap whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors',
              on
                ? 'border-accent-600 text-accent-700'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 text-xs font-bold text-slate-400">{t.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Accent the number when the tile is the one the page is really about. */
  accent?: boolean;
  hint?: ReactNode;
}

export function StatCard({ label, value, icon: Icon, accent, hint }: StatCardProps) {
  return (
    <div className="card flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div
          className={cx(
            'text-3xl font-extrabold leading-none tracking-tight',
            accent ? 'text-accent-600' : 'text-slate-900'
          )}
        >
          {value}
        </div>
        <div className="mt-2 text-sm text-slate-500">{label}</div>
        {hint && <div className="mt-1 text-xs text-slate-400">{hint}</div>}
      </div>
      {Icon && <Icon className="h-5 w-5 flex-none text-slate-300" aria-hidden="true" />}
    </div>
  );
}

export function Avatar({
  name, size = 'md', className,
}: { name: string | null | undefined; size?: 'sm' | 'md'; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid flex-none place-items-center rounded-full bg-navy-900 font-bold text-white',
        size === 'sm' ? 'h-8 w-8 text-xs' : 'h-11 w-11 text-sm',
        className
      )}
    >
      {initials(name)}
    </span>
  );
}

/** A bookable time in the slot picker. Pill, not a button, so a full day of
    availability reads as a grid of choices rather than a wall of actions. */
export function SlotButton({
  selected, disabled, onClick, children,
}: { selected?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        'min-h-tap min-w-[4.5rem] rounded-lg px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'bg-accent-600 text-white'
          : 'bg-slate-100 text-slate-900 hover:bg-accent-50 hover:text-accent-700'
      )}
    >
      {children}
    </button>
  );
}

// ===========================================================================
// Overflow menu
// ===========================================================================

/**
 * Secondary row actions. Keeping one likely action inline and the rest behind
 * this stops every table row from becoming a row of competing buttons.
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
    <div className="relative inline-flex" ref={wrap}>
      <IconButton
        icon={MoreHorizontal}
        label={label}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 top-[calc(100%+0.25rem)] z-40 min-w-[12rem] animate-fade-in rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick, children, danger, icon: Icon,
}: { onClick: () => void; children: ReactNode; danger?: boolean; icon?: LucideIcon }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cx(
        'flex min-h-tap w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium',
        danger ? 'text-red-700 hover:bg-red-50' : 'text-slate-900 hover:bg-slate-100'
      )}
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

// ===========================================================================
// Modals
// ===========================================================================

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function Modal({ open, title, onClose, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Stop the page behind the dialog scrolling under the user's fingers.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-navy-900/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'max-h-[90dvh] w-full overflow-y-auto rounded-xl bg-white shadow-xl',
          size === 'sm' && 'max-w-md',
          size === 'md' && 'max-w-lg',
          size === 'lg' && 'max-w-2xl'
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h3>{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
            {footer}
          </div>
        )}
      </div>
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
  /** "Keep appointment" fits a cancel flow but not a no-show, so it's tunable. */
  dismissLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Reason capture for destructive transitions. Cancellations and no-shows are
 * exactly what a practice reports on, so the reason is required rather than
 * optional — a bare "are you sure?" throws away the only fact worth keeping.
 * Presets cover the common cases; "Other…" handles the rest.
 */
export function ReasonModal({
  open, title, intro, presets, confirmLabel, dismissLabel = 'Keep appointment',
  busy, onCancel, onConfirm,
}: ReasonModalProps) {
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');

  useEffect(() => {
    if (open) {
      setChoice('');
      setOther('');
    }
  }, [open]);

  const reason = choice === '__other' ? other.trim() : choice;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel}>{dismissLabel}</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={!reason}
            onClick={() => onConfirm(reason)}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {intro && <div className="mb-4 text-sm text-slate-600">{intro}</div>}
      <Field label="Reason" htmlFor="reason-select" required className="mb-0">
        <Select
          id="reason-select"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Select a reason…</option>
          {presets.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          <option value="__other">Other…</option>
        </Select>
        {choice === '__other' && (
          <Textarea
            className="mt-2"
            placeholder="Describe the reason"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}
