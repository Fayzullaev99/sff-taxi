import { StyleSheet, Text, View } from 'react-native';
import { useDriverMe } from '../../data/queries';
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
  const me = useDriverMe();
  if (!me.data) return <Loading />;
  const p = me.data.priority;
  const s = me.data.stats;
  const parts = priorityParts(p);
  const level = scoreLevel(p.score);
  const tip = biggestGain(p);

  return (
    <Screen title="Reyting" refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <Card style={{ alignItems: 'center' }}>
        <View style={[styles.big, { borderColor: LEVEL_COLOR[level.level] }]}>
          <Text style={[styles.score, { color: LEVEL_COLOR[level.level] }]}>{p.score}</Text>
          <Text style={styles.of}>/ 100</Text>
        </View>
        <Text style={[styles.level, { color: LEVEL_COLOR[level.level] }]}>{level.label}</Text>
        <Muted center>Ustuvorlik ko‘rsatkichi. Yangi haydovchi 91 dan boshlaydi.</Muted>
      </Card>

      <Banner
        tone="info"
        icon="shield-checkmark"
        title="Adolatli taqsimot"
        text="Buyurtma har doim yo‘l bo‘yicha eng tez yetib boradigan haydovchiga beriladi. Reyting faqat yetib borish vaqti 1 daqiqa ichida teng bo‘lgan haydovchilar orasida hal qiladi. Pul to‘lab reytingni oshirib bo‘lmaydi."
      />

      {tip ? (
        <Banner
          tone="brand"
          icon="trending-up"
          title={`Eng ko‘p ball: ${tip.title}`}
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
            {x.points} / {x.maxPoints} ball
          </Text>
          <Muted>{x.explain}</Muted>
          <Muted>Qanday oshirish: {x.improve}</Muted>
        </Card>
      ))}

      <Card>
        <Title>Sizning statistikangiz</Title>
        <Row label="Kelgan takliflar" value={String(s.offersReceived)} />
        <Row label="Qabul qilingan" value={String(s.offersAccepted)} />
        <Row label="Yakunlangan safarlar" value={String(s.ridesCompleted)} />
        <Row
          label="Qabul qilib bekor qilingan"
          value={String(s.ridesCancelled)}
          tone={s.ridesCancelled ? 'warning' : undefined}
        />
        <Row label="Baholar soni" value={String(s.ratingCount)} />
        <Muted>
          Yangi haydovchi jazolanmasligi uchun har bir qism boshlang‘ich qiymatdan boshlanadi (10
          tadan 8 ta qabul, 10 ta toza safar, beshta 4,8 baho) — ko‘rsatkich sizning ishingiz bilan
          asta o‘zgaradi. U kunlik nolga tushmaydi.
        </Muted>
      </Card>

      <Card>
        <Title>Nimalar reytingga ta’sir qilmaydi</Title>
        <Muted>• Yo‘lovchi chiqmagani uchun bekor qilish (kutish vaqtidan keyin)</Muted>
        <Muted>• Liniyadan chiqish va dam olish</Muted>
        <Muted>• Balans va abonement</Muted>
        <Muted>
          Qaror bilan rozi bo‘lmasangiz, ofisga murojaat qiling — har bir shikoyatni inson ko‘rib
          chiqadi.
        </Muted>
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
