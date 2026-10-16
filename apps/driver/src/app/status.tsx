import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/session';
import { useAppeals, useDriverMe } from '../data/queries';
import { useT } from '../i18n';
import { DOCUMENTS } from '../lib/application';
import { date, dateTime, som } from '../lib/format';
import { Banner, Button, Card, Loading, Muted, Row, Title } from '../ui/components';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';
import { LicenceCardStatus, SupportCard } from '../ui/widgets';

/** The icon of each status; its title and text are `apply.status.<key>.title/text`. */
const LOOK = {
  pending: { key: 'pending' as const, icon: 'hourglass' as const, color: colors.brand },
  rejected: { key: 'rejected' as const, icon: 'close-circle' as const, color: colors.danger },
  blocked: { key: 'blocked' as const, icon: 'lock-closed' as const, color: colors.danger },
};

/** Where a driver who cannot work yet stands: pending, rejected (why) or blocked (why, appeal). */
export default function Status() {
  const { t } = useT();
  const router = useRouter();
  const session = useSession();
  const me = useDriverMe();
  const d = me.data;
  const canAppeal = d?.status === 'rejected' || d?.status === 'blocked';
  const appeals = useAppeals(canAppeal);
  if (!d) return <Loading />;
  const openAppeal = appeals.data?.find((a) => a.status === 'open') ?? null;
  const lastAnswer = appeals.data?.find((a) => a.status === 'resolved') ?? null;
  // the first blocker repeats the status (shown above): the rest is what still stops work
  const blockers = d.status === 'active' ? d.blockers : d.blockers.slice(1);
  const look = LOOK[d.status as keyof typeof LOOK] ?? LOOK.pending;
  const missing = DOCUMENTS.filter((x) => d.missingDocuments.includes(x.kind));

  return (
    <Screen refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <View style={styles.hero}>
        <Ionicons name={look.icon} size={72} color={look.color} />
        <Text style={styles.title}>{t(`apply.status.${look.key}.title`)}</Text>
        <Muted center>{t(`apply.status.${look.key}.text`)}</Muted>
      </View>

      {d.statusReason ? (
        <Banner
          tone="danger"
          icon="information-circle"
          title={t('apply.status.reason')}
          text={d.statusReason}
        />
      ) : null}

      {canAppeal ? (
        <Card>
          <Title>{t('apply.status.appealTitle')}</Title>
          {openAppeal ? (
            <Banner
              tone="info"
              icon="hourglass"
              title={t('apply.appeals.pendingTitle')}
              text={t('apply.status.appealSentAt', { time: dateTime(openAppeal.createdAt) })}
            />
          ) : lastAnswer?.resolution ? (
            <Banner
              tone="neutral"
              icon="chatbox"
              title={t('apply.appeals.operatorAnswer')}
              text={lastAnswer.resolution}
            />
          ) : (
            <Muted>{t('apply.status.appealHint')}</Muted>
          )}
          <Button
            title={openAppeal ? t('apply.status.myAppeals') : t('apply.status.sendAppeal')}
            icon="create"
            variant={openAppeal ? 'secondary' : 'primary'}
            onPress={() => router.push('/appeals')}
          />
        </Card>
      ) : null}

      {blockers.length ? (
        <Card>
          <Title>{t('apply.status.toWork')}</Title>
          {blockers.map((b) => (
            <Banner key={b} tone="warning" icon="alert-circle" text={b} />
          ))}
        </Card>
      ) : null}

      {missing.length ? (
        <Card>
          <Title>{t('apply.status.missingTitle')}</Title>
          <Muted>
            {t('apply.status.missingText', { list: missing.map((m) => m.label).join(', ') })}
          </Muted>
          <Button
            title={t('apply.status.uploadDocuments')}
            icon="document-attach"
            onPress={() => router.push('/documents')}
          />
        </Card>
      ) : d.status === 'pending' ? (
        <Banner tone="success" icon="checkmark-circle" text={t('apply.status.allUploaded')} />
      ) : null}

      <Card>
        <Title>{t('apply.status.yourApplication')}</Title>
        <Row label={t('apply.status.fullName')} value={d.fullName} />
        {d.vehicle ? (
          <>
            <Row
              label={t('apply.status.vehicle')}
              value={`${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}`}
            />
            <Row label={t('apply.status.plate')} value={d.vehicle.plateFormatted} strong />
          </>
        ) : null}
        <Row label={t('apply.status.sentAt')} value={dateTime(d.createdAt)} />
        <Row
          label={t('apply.status.licenceCard')}
          value={`${d.licenceCard.number} · ${t('common.units.until', { time: date(d.licenceCard.expiresOn) })}`}
        />
        <LicenceCardStatus verification={d.licenceCard.verification} showOk />
        {d.status === 'blocked' && d.balance < 0 ? (
          <Row label={t('apply.status.balance')} value={som(d.balance)} tone="danger" />
        ) : null}
        {d.status === 'pending' || d.status === 'rejected' ? (
          <Button
            title={
              d.status === 'rejected' ? t('apply.status.fixAndResend') : t('apply.form.editTitle')
            }
            icon="create"
            variant={d.status === 'rejected' ? 'primary' : 'secondary'}
            onPress={() => router.push('/apply')}
          />
        ) : null}
        {missing.length === 0 ? (
          <Button
            title={t('common.screens.documents')}
            icon="documents"
            variant="secondary"
            onPress={() => router.push('/documents')}
          />
        ) : null}
      </Card>

      {d.status === 'blocked' ? (
        <SupportCard
          title={t('apply.status.officeTitle')}
          text={t('apply.status.officeBlockedText')}
        />
      ) : (
        <SupportCard text={t('apply.status.officeText')} />
      )}

      <Button
        title={t('common.actions.signOut')}
        icon="log-out"
        variant="ghost"
        onPress={() => void session.signOut()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, marginTop: space.xl },
  title: { fontSize: 26, fontWeight: '900', color: colors.text, textAlign: 'center' },
});
