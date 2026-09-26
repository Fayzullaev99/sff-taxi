import { CircleAlert, CircleCheck, Inbox, LoaderCircle, RotateCw } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import { errorText } from '../api/client';
import { Modal } from './Modal';

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <LoaderCircle
      size={size}
      className="spin"
      aria-label={label ?? 'Yuklanmoqda'}
      role={label ? 'img' : undefined}
    />
  );
}

export function Loading({ text = 'Yuklanmoqda…' }: { text?: string }) {
  return (
    <div className="state" role="status">
      <Spinner size={24} />
      <span>{text}</span>
    </div>
  );
}

export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="state empty">
      {icon ?? <Inbox size={32} aria-hidden />}
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <CircleAlert size={18} aria-hidden />
      <span>{errorText(error)}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRetry}>
          <RotateCw size={14} aria-hidden /> Qayta urinish
        </button>
      )}
    </div>
  );
}

// Toasts -------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

// Confirmations ------------------------------------------------------------------

export interface ConfirmOptions {
  title: string;
  text?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(() =>
  Promise.resolve(false),
);

/** `if (await confirm({ title: 'O‘chirilsinmi?', danger: true })) …` */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = nextId.current++;
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000);
  }, []);

  const [pending, setPending] = useState<
    (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  >(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );
  const answer = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
  };

  const value = useMemo(() => toast, [toast]);
  return (
    <ToastContext.Provider value={value}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <Modal
          open={pending !== null}
          onClose={() => answer(false)}
          title={pending?.title ?? ''}
          size="sm"
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => answer(false)}>
                Bekor qilish
              </button>
              <button
                type="button"
                className={`btn ${pending?.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => answer(true)}
                autoFocus
              >
                {pending?.confirm ?? 'Tasdiqlash'}
              </button>
            </>
          }
        >
          {pending?.text && <div className="confirm-text">{pending.text}</div>}
        </Modal>
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              {t.kind === 'ok' ? (
                <CircleCheck size={18} aria-hidden />
              ) : (
                <CircleAlert size={18} aria-hidden />
              )}
              {t.text}
            </div>
          ))}
        </div>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}
