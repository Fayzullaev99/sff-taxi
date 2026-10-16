import { StyleSheet, Text, View } from 'react-native';
import { useDriverMe } from '../../data/queries';
import { useT } from '../../i18n';
import { biggestGain, priorityParts, scoreLevel } from '../../lib/priority';
import { Banner, Card, Loading, Muted, Row, Title } from '../../ui/components';
import { Screen } from '../../ui/screen';
import { colors, radius } from '../../ui/theme';

const LEVEL_COLOR = { high: colors.success, good: colors.brand, low: colors.danger } as const;

/**
 * The priority score, fully explained: what it is made of, how many points each part
 * gives, what lowers it, and — our promise — what it is NOT used for.
 */
export default function PriorityScreen() {
  const { t } = useT();
  const me = useDriverMe();
  if (!me.data) return <Loading />;
  const p = me.data.priority;
  const s = me.data.stats;
  const parts = priorityParts(p);
  const level = scoreLevel(p.score);
  const tip = biggestGain(p);

  return (
    <Screen
      title={t('home.priority.title')}
      refreshing={me.isRefetching}
      onRefresh={() => void me.refetch()}
    >
      <Card style={{ alignItems: 'center' }}>
        <View style={[styles.big, { borderColor: LEVEL_COLOR[level.level] }]}>
          <Text style={[styles.score, { color: LEVEL_COLOR[level.level] }]}>{p.score}</Text>
          <Text style={styles.of}>/ 100</Text>
        </View>
        <Text style={[styles.level, { color: LEVEL_COLOR[level.level] }]}>{level.label}</Text>
        <Muted center>{t('home.priority.hint')}</Muted>
      </Card>

      <Banner
        tone="info"
        icon="shield-checkmark"
        title={t('home.priority.fairTitle')}
        text={t('home.priority.fairText')}
      />

      {tip ? (
        <Banner
          tone="brand"
          icon="trending-up"
          title={t('home.priority.biggestGain', { title: tip.title })}
          text={tip.improve}
        />
      ) : null}

      {parts.map((x) => (
        <Card key={x.key}>
          <View style={styles.partHead}>
            <Title>{x.title}</Title>
            <Text style={styles.value}>{x.value}</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${(x.points / x.maxPoints) * 100}%` }]} />
          </View>
          <Text style={styles.points}>
            {t('home.priority.points', { points: x.points, max: x.maxPoints })}
          </Text>
          <Muted>{x.explain}</Muted>
          <Muted>{t('home.priority.howToImprove', { text: x.improve })}</Muted>
        </Card>
      ))}

      <Card>
        <Title>{t('home.priority.statsTitle')}</Title>
        <Row label={t('home.priority.offersReceived')} value={String(s.offersReceived)} />
        <Row label={t('home.priority.offersAccepted')} value={String(s.offersAccepted)} />
        <Row label={t('home.priority.ridesCompleted')} value={String(s.ridesCompleted)} />
        <Row
          label={t('home.priority.ridesCancelled')}
          value={String(s.ridesCancelled)}
          tone={s.ridesCancelled ? 'warning' : undefined}
        />
        <Row label={t('home.priority.ratingCount')} value={String(s.ratingCount)} />
        <Muted>{t('home.priority.statsHint')}</Muted>
      </Card>

      <Card>
        <Title>{t('home.priority.notAffectedTitle')}</Title>
        <Muted>{t('home.priority.notAffectedNoShow')}</Muted>
        <Muted>{t('home.priority.notAffectedOffline')}</Muted>
        <Muted>{t('home.priority.notAffectedBalance')}</Muted>
        <Muted>{t('home.priority.disagree')}</Muted>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  score: { fontSize: 64, fontWeight: '900', fontVariant: ['tabular-nums'] },
  of: { fontSize: 16, color: colors.muted, fontWeight: '700', marginTop: -8 },
  level: { fontSize: 22, fontWeight: '900' },
  partHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  value: { fontSize: 22, fontWeight: '900', color: colors.brand },
  track: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.brand, borderRadius: radius.pill },
  points: { fontSize: 15, fontWeight: '800', color: colors.text },
});
