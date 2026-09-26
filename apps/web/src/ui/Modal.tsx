import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 'drawer' slides in from the right, for details next to a list. */
  variant?: 'dialog' | 'drawer';
  size?: 'sm' | 'md' | 'lg';
  /** Keeps the dialog open on Escape / backdrop click (e.g. while saving). */
  busy?: boolean;
}

/**
 * Native <dialog>: the browser traps focus, handles Escape and restores focus on close.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  variant = 'dialog',
  size = 'md',
  busy = false,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={`modal modal-${variant} modal-${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onMouseDown={(e) => {
        // a press on the backdrop (the dialog element itself, outside its box)
        if (e.target === ref.current && !busy) onClose();
      }}
    >
      <div className="modal-box">
        <header className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Yopish"
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </dialog>
  );
}
