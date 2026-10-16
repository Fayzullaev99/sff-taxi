import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import { useT } from '../i18n';
import { formatClock, formatLocalPhoneInput, formatPhone, normalizePhone } from '../lib/format';
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
  const { t } = useT();
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
      setError(t('auth.phoneIncomplete'));
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
                {t('common.app.name')}
              </T>
              <T variant="body" color={colors.textMuted}>
                {t('auth.intro')}
              </T>
            </>
          ) : null}
          <TextField
            label={t('auth.phoneLabel')}
            prefix="+998"
            placeholder={t('auth.phonePlaceholder')}
            value={local}
            onChangeText={(text) => {
              setError(null);
              setLocal(formatLocalPhoneInput(text));
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
            title={t('auth.getCode')}
            size="lg"
            loading={busy}
            disabled={!phone}
            onPress={requestCode}
          />
        </>
      ) : null}

      {step === 'code' ? (
        <>
          {!compact ? <T variant="h1">{t('auth.enterCode')}</T> : null}
          <T variant="body" color={colors.textMuted}>
            {t('auth.codeSentTo', { phone: phone ? formatPhone(phone) : '' })}{' '}
            <T
              variant="bodyStrong"
              color={colors.brandText}
              onPress={() => {
                setStep('phone');
                setError(null);
              }}
            >
              {t('auth.changeNumber')}
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
              onChangeText={(text) => {
                const digits = text.replace(/\D/g, '').slice(0, CODE_LENGTH);
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
              accessibilityLabel={t('auth.codeLabel')}
            />
          </Pressable>
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title={t('common.actions.confirm')}
            size="lg"
            loading={busy}
            disabled={code.length !== CODE_LENGTH}
            onPress={() => void verify(code)}
          />
          <Button
            title={
              secondsLeft > 0
                ? t('auth.resendIn', { time: formatClock(secondsLeft) })
                : t('auth.resend')
            }
            variant="ghost"
            disabled={secondsLeft > 0 || busy}
            onPress={requestCode}
          />
        </>
      ) : null}

      {step === 'name' ? (
        <>
          <T variant="h2">{t('auth.nameTitle')}</T>
          <T variant="body" color={colors.textMuted}>
            {t('auth.nameHint')}
          </T>
          <TextField
            label={t('auth.nameLabel')}
            placeholder={t('auth.namePlaceholder')}
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
          <Button title={t('common.actions.next')} size="lg" loading={busy} onPress={saveName} />
          <Button title={t('auth.skip')} variant="ghost" disabled={busy} onPress={onDone} />
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
