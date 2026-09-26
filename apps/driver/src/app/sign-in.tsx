import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { auth } from '../api/driver';
import { useSession } from '../auth/session';
import { errorMessage } from '../lib/api-client';
import { formatPhone, uzPhoneDigits } from '../lib/format';
import { Banner, Button, Muted } from '../ui/components';
import { Screen } from '../ui/screen';
import { colors, radius, space, TOUCH } from '../ui/theme';

const RESEND_SECONDS = 60;

function useCountdown() {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, setLeft] as const;
}

export default function SignIn() {
  const session = useSession();
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useCountdown();
  const codeRef = useRef<TextInput>(null);

  const requestCode = useMutation({
    mutationFn: (e164: string) => auth.requestCode(e164),
    onSuccess: (sent, e164) => {
      setPhone(e164);
      setCode('');
      setResendIn(sent.resendAfterSeconds || RESEND_SECONDS);
      setTimeout(() => codeRef.current?.focus(), 100);
    },
  });

  const verify = useMutation({
    mutationFn: (args: { phone: string; code: string }) => auth.verify(args.phone, args.code),
    onSuccess: (pair) => session.signIn(pair),
  });

  const digits = uzPhoneDigits(phoneInput);
  const submitPhone = () => {
    if (digits) requestCode.mutate(`+998${digits}`);
  };
  const submitCode = (value = code) => {
    if (phone && /^\d{6}$/.test(value) && !verify.isPending) verify.mutate({ phone, code: value });
  };

  return (
    <Screen keyboard>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="car-sport" size={52} color={colors.onBrand} />
        </View>
        <Text style={styles.brand}>SFF Taxi Haydovchi</Text>
        <Muted center>Adolatli buyurtmalar, past komissiya, shaffof qoidalar</Muted>
      </View>

      {!phone ? (
        <View style={styles.form}>
          <Text style={styles.label}>Telefon raqamingiz</Text>
          <View style={styles.phoneRow}>
            <Text style={styles.prefix}>+998</Text>
            <TextInput
              style={styles.phoneInput}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="90 123 45 67"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={17}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={submitPhone}
            />
          </View>
          {requestCode.error ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(requestCode.error)} />
          ) : null}
          <Button
            title="Kod olish"
            big
            onPress={submitPhone}
            disabled={!digits}
            loading={requestCode.isPending}
          />
          <Muted center>Raqamingizga 6 xonali tasdiqlash kodi yuboriladi</Muted>
        </View>
      ) : (
        <View style={styles.form}>
          <Text style={styles.label}>SMS kod</Text>
          <Muted>{formatPhone(phone)} raqamiga yuborilgan kodni kiriting</Muted>
          <TextInput
            ref={codeRef}
            style={styles.codeInput}
            value={code}
            onChangeText={(v) => {
              const clean = v.replace(/\D/g, '').slice(0, 6);
              setCode(clean);
              if (clean.length === 6) submitCode(clean);
            }}
            placeholder="••••••"
            placeholderTextColor={colors.muted}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="sms-otp"
            maxLength={6}
            autoFocus
          />
          {verify.error ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(verify.error)} />
          ) : null}
          {requestCode.error ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(requestCode.error)} />
          ) : null}
          <Button
            title="Kirish"
            big
            onPress={() => submitCode()}
            disabled={code.length !== 6}
            loading={verify.isPending}
          />
          <Button
            title={resendIn > 0 ? `Kodni qayta yuborish (${resendIn} s)` : 'Kodni qayta yuborish'}
            variant="secondary"
            icon="refresh"
            disabled={resendIn > 0}
            loading={requestCode.isPending}
            onPress={() => requestCode.mutate(phone)}
          />
          <Button
            title="Raqamni o‘zgartirish"
            variant="ghost"
            onPress={() => {
              setPhone(null);
              setCode('');
              verify.reset();
              requestCode.reset();
            }}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, marginTop: space.xl * 2, marginBottom: space.lg },
  logo: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { fontSize: 28, fontWeight: '800', color: colors.text },
  form: { gap: space.md },
  label: { fontSize: 17, fontWeight: '700', color: colors.text },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH + 8,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    gap: space.sm,
  },
  prefix: { fontSize: 22, fontWeight: '600', color: colors.text },
  phoneInput: { flex: 1, fontSize: 22, color: colors.text, paddingVertical: space.sm },
  codeInput: {
    minHeight: TOUCH + 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    fontSize: 32,
    letterSpacing: 12,
    textAlign: 'center',
    color: colors.text,
  },
});
