import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api, errorText, retryAfter, sessionStore } from '../api/client';
import type { CodeSent, VerifyResult } from '../api/types';
import { formatPhone, isUzPhone, normalizePhone } from '../lib/phone';
import { Button, Field, PhoneInput } from '../ui/controls';

/** Seconds left, ticking down once a second. */
function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

/** Operators sign in with an SMS code; the API refuses phones that are not operators. */
export function SignIn() {
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sentTo) codeRef.current?.focus();
  }, [sentTo]);

  const requestCode = async (target: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<CodeSent>('/v1/auth/code', {
        method: 'POST',
        auth: false,
        body: { phone: target },
      });
      setSentTo(target);
      setCode('');
      setResendIn(res.resendAfterSeconds);
    } catch (e) {
      setError(errorText(e));
      const wait = retryAfter(e);
      if (wait) {
        setResendIn(wait);
        // a code sent a moment ago is still valid: let them type it
        if (sentTo === null && wait <= 60) setSentTo(target);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    if (!isUzPhone(phone)) {
      setError('O‘zbekiston raqamini kiriting, masalan +998 90 123 45 67');
      return;
    }
    void requestCode(normalizePhone(phone));
  };

  const verify = async (value: string) => {
    if (!sentTo || !/^\d{6}$/.test(value)) {
      setError('SMS orqali kelgan 6 xonali kodni kiriting');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const tokens = await api<VerifyResult>('/v1/auth/verify', {
        method: 'POST',
        auth: false,
        body: { phone: sentTo, code: value, client: 'admin' },
      });
      sessionStore.set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    } catch (e) {
      setError(errorText(e));
      setCode('');
      codeRef.current?.focus();
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <div className="signin-card">
        <div className="brand brand-lg">
          <img src="/icon.svg" alt="" width={40} height={40} />
          <div>
            <strong>SFF Taxi</strong>
            <span>Dispetcher paneli</span>
          </div>
        </div>

        {!sentTo ? (
          <form onSubmit={submitPhone} noValidate>
            <h1>Kirish</h1>
            <p className="muted">
              Operator telefon raqamingizga SMS kod yuboramiz. Faqat dispetcherlar kira oladi.
            </p>
            <Field label="Telefon raqam" error={error}>
              {(p) => (
                <PhoneInput
                  {...p}
                  value={phone}
                  onChange={(v) => {
                    setPhone(v);
                    setError(null);
                  }}
                  autoFocus
                />
              )}
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy} className="btn-block">
              Kod olish
            </Button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void verify(code);
            }}
            noValidate
          >
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setSentTo(null);
                setError(null);
              }}
            >
              <ArrowLeft size={16} aria-hidden /> Raqamni o‘zgartirish
            </button>
            <h1>SMS kod</h1>
            <p className="muted">
              Kod <strong>{formatPhone(sentTo)}</strong> raqamiga yuborildi.
            </p>
            <Field label="6 xonali kod" error={error}>
              {(p) => (
                <input
                  {...p}
                  ref={codeRef}
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  disabled={busy}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(digits);
                    setError(null);
                    if (digits.length === 6) void verify(digits);
                  }}
                />
              )}
            </Field>
            <Button type="submit" variant="primary" size="lg" loading={busy} className="btn-block">
              Kirish
            </Button>
            <div className="resend">
              {resendIn > 0 ? (
                <span className="muted" aria-live="off">
                  Yangi kodni {resendIn} soniyadan so‘ng so‘rashingiz mumkin
                </span>
              ) : (
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => void requestCode(sentTo)}
                >
                  Kodni qayta yuborish
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
