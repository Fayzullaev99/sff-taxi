import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useState,
} from 'react';
import { Phone } from 'lucide-react';
import { parseSom, type Tone } from '../lib/format';
import { formatPhone, normalizePhone } from '../lib/phone';
import { Spinner } from './feedback';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'outline',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant}${size !== 'md' ? ` btn-${size}` : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children}
    </button>
  );
}

/** Label + control + hint/error, wired up for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: (props: {
    id: string;
    'aria-invalid'?: boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${error ? ' has-error' : ''}${className ? ` ${className}` : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({
        id,
        ...(error ? { 'aria-invalid': true } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      })}
      {error ? (
        <div className="field-error" id={`${id}-error`}>
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint" id={`${id}-hint`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

type InputBase = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>;

function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Whole so‘m with space-grouped digits; `value` null while empty or invalid. */
export function MoneyInput({
  value,
  onChange,
  ...rest
}: InputBase & { value: number | null; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : groupDigits(value));
  useEffect(() => {
    // follow outside changes without fighting the user's typing
    if (parseSom(text) !== value) setText(value === null ? '' : groupDigits(value));
  }, [value]);
  return (
    <div className="input-affix">
      <input
        {...rest}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          const parsed = parseSom(raw);
          setText(parsed === null ? raw : groupDigits(parsed));
          onChange(parsed);
        }}
      />
      <span className="affix">so‘m</span>
    </div>
  );
}

/** Whole number input that keeps what was typed; `value` null while empty or invalid. */
export function NumberInput({
  value,
  onChange,
  suffix,
  decimals = false,
  ...rest
}: InputBase & {
  value: number | null;
  onChange: (value: number | null) => void;
  suffix?: string;
  decimals?: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => {
    const parsed = text.trim() === '' ? null : Number(text.replace(',', '.'));
    if (parsed !== value) setText(value === null ? '' : String(value));
  }, [value]);
  const input = (
    <input
      {...rest}
      inputMode={decimals ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const normalized = raw.trim().replace(',', '.');
        const ok = decimals ? /^-?\d+(\.\d+)?$/.test(normalized) : /^\d+$/.test(normalized);
        onChange(ok ? Number(normalized) : null);
      }}
    />
  );
  return suffix ? (
    <div className="input-affix">
      {input}
      <span className="affix">{suffix}</span>
    </div>
  ) : (
    input
  );
}

/** Phone typed any common way; reports the normalised +998… value. */
export function PhoneInput({
  value,
  onChange,
  ...rest
}: InputBase & {
  value: string;
  onChange: (value: string) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      {...rest}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      placeholder="+998 90 123 45 67"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        const normalized = normalizePhone(value);
        if (/^\+998\d{9}$/.test(normalized)) onChange(formatPhone(normalized));
      }}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden />
      <span>{label}</span>
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Tab-like single choice, e.g. status filters. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'is-active' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** A phone number that dials on click (softphones and mobile). */
export function PhoneLink({ phone }: { phone: string | null | undefined }) {
  if (!phone) return null;
  return (
    <a href={`tel:${phone}`} className="phone-link">
      <Phone size={13} aria-hidden /> {formatPhone(phone)}
    </a>
  );
}
