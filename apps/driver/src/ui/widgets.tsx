import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useDriverConfig, useFeatures, useSupport } from '../data/queries';
import { useT } from '../i18n';
import { litSegments } from '../lib/countdown';
import { som } from '../lib/format';
import { OFFICE_TOP_UP_STEPS } from '../lib/money';
import { suggestedTopup } from '../lib/topup';
import { useGpsQuality, useSavingBattery } from '../location/use-tracking-mode';
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
  const { t } = useT();
  const size = props.size ?? 200;
  const lit = litSegments(props.fraction, SEGMENTS);
  const color = props.urgent ? colors.danger : colors.brand;
  const seg = { w: Math.max(6, size / 22), h: size / 9 };
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={t('profile.widgets.secondsLeft', { count: props.seconds })}
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
      {/* sized to the ring: a large system font would spill over it */}
      <Text
        style={[styles.ringSeconds, { color, fontSize: size * 0.34 }]}
        maxFontSizeMultiplier={1}
      >
        {props.seconds}
      </Text>
      <Text style={styles.ringUnit} maxFontSizeMultiplier={1.15}>
        {t('profile.widgets.seconds')}
      </Text>
    </View>
  );
});

/** The GPS indicator: how good the fixes are and whether the API takes them. */
export const GpsIndicator = memo(function GpsIndicator() {
  const { t: tr } = useT();
  const q = useGpsQuality();
  const saving = useSavingBattery();
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
      {saving && q.level !== 'off' ? (
        <View style={[styles.gps, { backgroundColor: TONES.warning.bg }]}>
          <Ionicons name="battery-dead" size={18} color={TONES.warning.fg} />
          <Text style={[styles.gpsText, { color: TONES.warning.fg }]}>
            {tr('profile.widgets.lowBattery')}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

/**
 * How to top up, with the missing amount when the balance is below the minimum: by card
 * (Payme/Click) when the API has a provider, and in cash at the office.
 */
export function TopUpCard(props: { shortBy?: number }) {
  const { t } = useT();
  const router = useRouter();
  const support = useSupport();
  const features = useFeatures();
  const config = useDriverConfig();
  const byCard = features.features.cardPayments || config.topups.providers.length > 0;
  const amount = suggestedTopup(props.shortBy ?? 0, config.topups);
  return (
    <Card>
      <Title>{t('common.screens.topup')}</Title>
      {props.shortBy ? (
        <Banner
          tone="danger"
          icon="wallet"
          text={t('profile.widgets.topupShort', { amount: som(props.shortBy) })}
        />
      ) : null}
      {byCard ? (
        <Button
          title={t('profile.widgets.topupByCard')}
          icon="card"
          big
          onPress={() => router.push(`/topup?amount=${props.shortBy ? amount : ''}`)}
        />
      ) : null}
      <Text style={styles.stepsTitle}>
        {byCard ? t('profile.widgets.orCashAtOffice') : t('profile.widgets.cashAtOffice')}
      </Text>
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
          title={t('profile.support.callOffice')}
          icon="call"
          variant="secondary"
          onPress={() => call(support.phone)}
        />
      ) : null}
    </Card>
  );
}

/** The tone of each verification; its label and text are `profile.widgets.licence.*`. */
const LICENCE_LOOK: Record<
  LicenceVerification,
  { tone: 'success' | 'warning' | 'danger'; text: 'unverifiedText' | 'invalidText' | null }
> = {
  unverified: { tone: 'warning', text: 'unverifiedText' },
  valid: { tone: 'success', text: null },
  invalid: { tone: 'danger', text: 'invalidText' },
};

/**
 * The licence card's check with the Ministry of Transport's registry
 * (`licenceCard.verification`): approval and going online need a verified card.
 */
export function LicenceCardStatus(props: {
  verification: LicenceVerification | undefined;
  showOk?: boolean;
}) {
  const { t } = useT();
  const look = props.verification ? LICENCE_LOOK[props.verification] : null;
  if (!look || !props.verification || (props.verification === 'valid' && !props.showOk)) {
    return null;
  }
  return (
    <View style={{ gap: space.xs }}>
      <Chip
        label={t('profile.widgets.licence.chip', {
          status: t(`profile.widgets.licence.${props.verification}`),
        })}
        tone={look.tone}
        icon={props.verification === 'valid' ? 'shield-checkmark' : 'shield-half'}
      />
      {look.text ? <Muted>{t(`profile.widgets.licence.${look.text}`)}</Muted> : null}
    </View>
  );
}

/** Contact for appeals and questions: the "human appeal" promise (market analysis §1.5). */
export function SupportCard(props: { title?: string; text: string }) {
  const { t } = useT();
  const support = useSupport();
  return (
    <Card>
      <Title>{props.title ?? t('profile.support.contactTitle')}</Title>
      <Muted>{props.text}</Muted>
      <Muted>{support.officeAddress}</Muted>
      {support.phone ? (
        <Button title={t('common.actions.call')} icon="call" onPress={() => call(support.phone)} />
      ) : (
        <Muted>{t('profile.support.askPhone')}</Muted>
      )}
      {support.telegram ? (
        <Button
          title={t('profile.support.telegram', {
            handle: support.telegram.replace(/^https?:\/\/t\.me\//, '@'),
          })}
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
