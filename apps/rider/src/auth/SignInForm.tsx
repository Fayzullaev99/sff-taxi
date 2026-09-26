import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import { formatLocalPhoneInput, formatPhone, normalizePhone } from '../lib/format';
import { useCountdown } from '../lib/hooks';
import { Banner, Button, T, TextField } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

type Step = 'phone' | 'code' | 'name';

const CODE_LENGTH = 6;

/**
 * Phone number -> SMS code (60 s before a resend) -> (for new accounts) name.
 * `onDone` runs once the rider is signed in.
 */
export function SignInForm({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('phone');
  const [local, setLocal] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const secondsLeft = useCountdown(resendAt);
  const codeInput = useRef<TextInput>(null);

  const phone = normalizePhone(local);

  const requestCode = async () => {
    if (!phone) {
      setError('Telefon raqamini to‘liq kiriting');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await endpoints.requestCode(phone);
      setResendAt(Date.now() + res.resendAfterSeconds * 1000);
      setCode('');
      setStep('code');
      setTimeout(() => codeInput.current?.focus(), 300);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        const retry = (e.body as { retryAfterSeconds?: number } | null)?.retryAfterSeconds;
        if (retry) setResendAt(Date.now() + retry * 1000);
        // a code was already sent a moment ago: let the rider type it
        if (step === 'phone' && retry && retry <= 60) setStep('code');
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string) => {
    if (!phone || value.length !== CODE_LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { isNewUser } = await endpoints.verifyCode(phone, value);
      const me = await queryClient.fetchQuery({ queryKey: keys.me, queryFn: endpoints.me });
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      void queryClient.invalidateQueries({ queryKey: keys.history });
      if (isNewUser || !me.fullName) {
        setStep('name');
      } else {
        onDone();
      }
    } catch (e) {
      setError(describeError(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const saveName = async () => {
    const fullName = name.trim();
    if (!fullName) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const me = await endpoints.updateMe(fullName);
      queryClient.setQueryData(keys.me, me);
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      {step === 'phone' ? (
        <>
          {!compact ? (
            <>
              <T variant="h1" accessibilityRole="header">
                SFF Taxi
              </T>
              <T variant="body" color={colors.textMuted}>
                Telefon raqamingizni kiriting — tasdiqlash kodini SMS orqali yuboramiz. Narx
                oldindan belgilanadi va o‘zgarmaydi.
              </T>
            </>
          ) : null}
          <TextField
            label="Telefon raqami"
            prefix="+998"
            placeholder="90 123 45 67"
            value={local}
            onChangeText={(t) => {
              setError(null);
              setLocal(formatLocalPhoneInput(t));
            }}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={12}
            returnKeyType="done"
            onSubmitEditing={requestCode}
            autoFocus={!compact}
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title="Kod olish"
            size="lg"
            loading={busy}
            disabled={!phone}
            onPress={requestCode}
          />
        </>
      ) : null}

      {step === 'code' ? (
        <>
          {!compact ? <T variant="h1">Kodni kiriting</T> : null}
          <T variant="body" color={colors.textMuted}>
            Kod {phone ? formatPhone(phone) : ''} raqamiga yuborildi.{' '}
            <T
              variant="bodyStrong"
              color={colors.brandText}
              onPress={() => {
                setStep('phone');
                setError(null);
              }}
            >
              Raqamni o‘zgartirish
            </T>
          </T>
          <Pressable onPress={() => codeInput.current?.focus()} style={styles.codeBoxes}>
            {Array.from({ length: CODE_LENGTH }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.codeBox,
                  i === code.length ? styles.codeBoxActive : null,
                  error ? styles.codeBoxError : null,
                ]}
              >
                <T variant="h2">{code[i] ?? ''}</T>
              </View>
            ))}
            <TextInput
              ref={codeInput}
              value={code}
              onChangeText={(t) => {
                const digits = t.replace(/\D/g, '').slice(0, CODE_LENGTH);
                setError(null);
                setCode(digits);
                if (digits.length === CODE_LENGTH) void verify(digits);
              }}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={CODE_LENGTH}
              style={styles.hiddenInput}
              caretHidden
              autoFocus
              accessibilityLabel="Tasdiqlash kodi"
            />
          </Pressable>
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title="Tasdiqlash"
            size="lg"
            loading={busy}
            disabled={code.length !== CODE_LENGTH}
            onPress={() => void verify(code)}
          />
          <Button
            title={
              secondsLeft > 0
                ? `Kodni qayta yuborish (${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')})`
                : 'Kodni qayta yuborish'
            }
            variant="ghost"
            disabled={secondsLeft > 0 || busy}
            onPress={requestCode}
          />
        </>
      ) : null}

      {step === 'name' ? (
        <>
          <T variant="h2">Ismingiz qanday?</T>
          <T variant="body" color={colors.textMuted}>
            Haydovchi sizga shu ism bilan murojaat qiladi.
          </T>
          <TextField
            label="Ism"
            placeholder="Masalan, Aziz"
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            maxLength={100}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={saveName}
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button title="Davom etish" size="lg" loading={busy} onPress={saveName} />
          <Button title="O‘tkazib yuborish" variant="ghost" disabled={busy} onPress={onDone} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(4) },
  codeBoxes: { flexDirection: 'row', gap: space(2), justifyContent: 'space-between' },
  codeBox: {
    flex: 1,
    maxWidth: 52,
    height: 58,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  codeBoxActive: { borderColor: colors.brand },
  codeBoxError: { borderColor: colors.danger },
  // the real input lies over the boxes, invisible, so a tap anywhere focuses it
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
});
