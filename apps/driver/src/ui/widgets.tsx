import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDriverConfig, useFeatures, useSupport } from '../data/queries';
import { litSegments } from '../lib/countdown';
import { som } from '../lib/format';
import { OFFICE_TOP_UP_STEPS } from '../lib/money';
import { suggestedTopup } from '../lib/topup';
import { useGpsQuality } from '../location/use-tracking-mode';
import { call, openTelegram } from './actions';
import type { LicenceVerification } from '../api/types';
import { Banner, Button, Card, Chip, Muted, Title, TONES } from './components';
import { colors, radius, space } from './theme';

const SEGMENTS = 36;

/**
 * The offer's countdown ring: 36 segments around the seconds left. Plain views instead
 * of SVG or animations, so a low-end phone redraws it cheaply a few times a second.
 */
export const CountdownRing = memo(function CountdownRing(props: {
  seconds: number;
  fraction: number;
  urgent: boolean;
  size?: number;
}) {
  const size = props.size ?? 200;
  const lit = litSegments(props.fraction, SEGMENTS);
  const color = props.urgent ? colors.danger : colors.brand;
  const seg = { w: Math.max(6, size / 22), h: size / 9 };
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${props.seconds} soniya qoldi`}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: seg.w,
            height: seg.h,
            borderRadius: seg.w / 2,
            backgroundColor: i < lit ? color : colors.surfaceRaised,
            transform: [
              { rotate: `${(i * 360) / SEGMENTS}deg` },
              { translateY: -(size / 2 - seg.h / 2) },
            ],
          }}
        />
      ))}
      <Text style={[styles.ringSeconds, { color, fontSize: size * 0.34 }]}>{props.seconds}</Text>
      <Text style={styles.ringUnit}>soniya</Text>
    </View>
  );
});

/** The GPS indicator: how good the fixes are and whether the API takes them. */
export function GpsIndicator() {
  const q = useGpsQuality();
  const tone =
    q.level === 'good'
      ? 'success'
      : q.level === 'fair'
        ? 'warning'
        : q.level === 'off'
          ? 'neutral'
          : 'danger';
  const t = TONES[tone];
  return (
    <View style={{ gap: space.xs }}>
      <View style={[styles.gps, { backgroundColor: t.bg }]}>
        <Ionicons
          name={q.level === 'off' ? 'navigate-outline' : 'navigate'}
          size={18}
          color={t.fg}
        />
        <Text style={[styles.gpsText, { color: t.fg }]}>{q.label}</Text>
      </View>
      {q.hint ? <Muted>{q.hint}</Muted> : null}
    </View>
  );
}

/**
 * How to top up, with the missing amount when the balance is below the minimum: by card
 * (Payme/Click) when the API has a provider, and in cash at the office.
 */
export function TopUpCard(props: { shortBy?: number }) {
  const router = useRouter();
  const support = useSupport();
  const features = useFeatures();
  const config = useDriverConfig();
  const byCard = features.features.cardPayments || config.topups.providers.length > 0;
  const amount = suggestedTopup(props.shortBy ?? 0, config.topups);
  return (
    <Card>
      <Title>Balansni to‘ldirish</Title>
      {props.shortBy ? (
        <Banner
          tone="danger"
          icon="wallet"
          text={`Liniyaga chiqish uchun kamida ${som(props.shortBy)} to‘ldiring`}
        />
      ) : null}
      {byCard ? (
        <Button
          title="Karta bilan to‘ldirish"
          icon="card"
          big
          onPress={() => router.push(`/topup?amount=${props.shortBy ? amount : ''}`)}
        />
      ) : null}
      <Text style={styles.stepsTitle}>{byCard ? 'Yoki ofisda naqd:' : 'Ofisda naqd:'}</Text>
      {OFFICE_TOP_UP_STEPS.map((s, i) => (
        <View key={s} style={styles.step}>
          <View style={styles.stepNo}>
            <Text style={styles.stepNoText}>{i + 1}</Text>
          </View>
          <Text style={styles.stepText}>{s}</Text>
        </View>
      ))}
      <Muted>{support.officeAddress}</Muted>
      {support.phone ? (
        <Button
          title="Ofisga qo‘ng‘iroq qilish"
          icon="call"
          variant="secondary"
          onPress={() => call(support.phone)}
        />
      ) : null}
    </Card>
  );
}

const LICENCE_LOOK: Record<
  LicenceVerification,
  { label: string; tone: 'success' | 'warning' | 'danger'; text: string | null }
> = {
  unverified: {
    label: 'Tekshirilmoqda',
    tone: 'warning',
    text: 'Operator kartochkangizni Transport vazirligi reyestrida tekshiradi. Tasdiqlanmaguncha ariza tasdiqlanmaydi va liniyaga chiqib bo‘lmaydi.',
  },
  valid: { label: 'Reyestrda tasdiqlangan', tone: 'success', text: null },
  invalid: {
    label: 'Tasdiqlanmadi',
    tone: 'danger',
    text: 'Kartochka reyestrda topilmadi yoki amal qilmaydi. Raqamini tekshiring: arizani tuzatib qayta yuboring yoki ofisga murojaat qiling.',
  },
};

/**
 * The licence card's check with the Ministry of Transport's registry
 * (`licenceCard.verification`): approval and going online need a verified card.
 */
export function LicenceCardStatus(props: {
  verification: LicenceVerification | undefined;
  showOk?: boolean;
}) {
  const look = props.verification ? LICENCE_LOOK[props.verification] : null;
  if (!look || (props.verification === 'valid' && !props.showOk)) return null;
  return (
    <View style={{ gap: space.xs }}>
      <Chip
        label={`Litsenziya kartochkasi: ${look.label}`}
        tone={look.tone}
        icon={props.verification === 'valid' ? 'shield-checkmark' : 'shield-half'}
      />
      {look.text ? <Muted>{look.text}</Muted> : null}
    </View>
  );
}

/** Contact for appeals and questions: the "human appeal" promise (market analysis §1.5). */
export function SupportCard(props: { title?: string; text: string }) {
  const support = useSupport();
  return (
    <Card>
      <Title>{props.title ?? 'Operator bilan bog‘lanish'}</Title>
      <Muted>{props.text}</Muted>
      <Muted>{support.officeAddress}</Muted>
      {support.phone ? (
        <Button title="Qo‘ng‘iroq qilish" icon="call" onPress={() => call(support.phone)} />
      ) : (
        <Muted>Telefon: ofisdan so‘rang</Muted>
      )}
      {support.telegram ? (
        <Button
          title={`Telegram: ${support.telegram.replace(/^https?:\/\/t\.me\//, '@')}`}
          icon="paper-plane"
          variant="secondary"
          onPress={() => openTelegram(support.telegram!)}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  ringSeconds: { fontWeight: '900', fontVariant: ['tabular-nums'] },
  ringUnit: { color: colors.muted, fontSize: 16, fontWeight: '700', marginTop: -8 },
  gps: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
  },
  gpsText: { fontSize: 14, fontWeight: '800' },
  step: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  stepNo: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNoText: { color: colors.onBrand, fontWeight: '900' },
  stepText: { flex: 1, color: colors.text, fontSize: 16, lineHeight: 22 },
  stepsTitle: { color: colors.muted, fontSize: 15, fontWeight: '800' },
});
