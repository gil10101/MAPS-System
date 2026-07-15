/**
 * Small shared UI pieces: modal, status badge, spinner, empty state.
 */
import type { ReactNode } from 'react';
import { X, type LucideIcon } from 'lucide-react';
import type { ApptStatus } from '../lib/api';

export function Badge({ status }: { status: ApptStatus }) {
  return <span className={`badge ${status}`}>{status}</span>;
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
