import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useSession } from '../auth/session';
import { useAppeals, useDriverMe } from '../data/queries';
import { DOCUMENTS } from '../lib/application';
import { date, dateTime, som } from '../lib/format';
import { Banner, Button, Card, Loading, Muted, Row, Title } from '../ui/components';
import { Screen } from '../ui/screen';
import { colors, space } from '../ui/theme';
import { LicenceCardStatus, SupportCard } from '../ui/widgets';

const LOOK = {
  pending: {
    icon: 'hourglass' as const,
    color: colors.brand,
    title: 'Arizangiz ko‘rib chiqilmoqda',
    text: 'Operator hujjatlaringizni tekshiradi, odatda 1 ish kuni ichida. Natija haqida bildirishnoma keladi.',
  },
  rejected: {
    icon: 'close-circle' as const,
    color: colors.danger,
    title: 'Ariza rad etildi',
    text: 'Sababini o‘qing, ma’lumotlarni to‘g‘rilang va arizani qayta yuboring.',
  },
  blocked: {
    icon: 'lock-closed' as const,
    color: colors.danger,
    title: 'Hisobingiz bloklangan',
    text: 'Blok sababi quyida yozilgan. Rozi bo‘lmasangiz, murojaat yuboring — har bir murojaatni inson ko‘rib chiqadi.',
  },
};

/** Where a driver who cannot work yet stands: pending, rejected (why) or blocked (why, appeal). */
export default function Status() {
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
        <Text style={styles.title}>{look.title}</Text>
        <Muted center>{look.text}</Muted>
      </View>

      {d.statusReason ? (
        <Banner tone="danger" icon="information-circle" title="Sabab" text={d.statusReason} />
      ) : null}

      {canAppeal ? (
        <Card>
          <Title>Qarorga e’tiroz</Title>
          {openAppeal ? (
            <Banner
              tone="info"
              icon="hourglass"
              title="Murojaatingiz ko‘rib chiqilmoqda"
              text={`${dateTime(openAppeal.createdAt)} yuborilgan. Operator javobi shu yerda ko‘rinadi.`}
            />
          ) : lastAnswer?.resolution ? (
            <Banner
              tone="neutral"
              icon="chatbox"
              title="Operator javobi"
              text={lastAnswer.resolution}
            />
          ) : (
            <Muted>
              Qaror noto‘g‘ri deb hisoblasangiz, yozing: har bir murojaatni inson ko‘rib chiqadi.
            </Muted>
          )}
          <Button
            title={openAppeal ? 'Murojaatlarim' : 'Murojaat yuborish'}
            icon="create"
            variant={openAppeal ? 'secondary' : 'primary'}
            onPress={() => router.push('/appeals')}
          />
        </Card>
      ) : null}

      {blockers.length ? (
        <Card>
          <Title>Ishlash uchun</Title>
          {blockers.map((b) => (
            <Banner key={b} tone="warning" icon="alert-circle" text={b} />
          ))}
        </Card>
      ) : null}

      {missing.length ? (
        <Card>
          <Title>Hujjatlar yetishmaydi</Title>
          <Muted>
            Tasdiqlash uchun barcha hujjatlar kerak. Yetishmayotganlari:{' '}
            {missing.map((m) => m.label).join(', ')}.
          </Muted>
          <Button
            title="Hujjatlarni yuklash"
            icon="document-attach"
            onPress={() => router.push('/documents')}
          />
        </Card>
      ) : d.status === 'pending' ? (
        <Banner tone="success" icon="checkmark-circle" text="Barcha hujjatlar yuklangan." />
      ) : null}

      <Card>
        <Title>Arizangiz</Title>
        <Row label="F.I.Sh." value={d.fullName} />
        {d.vehicle ? (
          <>
            <Row
              label="Avtomobil"
              value={`${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}`}
            />
            <Row label="Davlat raqami" value={d.vehicle.plateFormatted} strong />
          </>
        ) : null}
        <Row label="Yuborilgan" value={dateTime(d.createdAt)} />
        <Row
          label="Litsenziya kartochkasi"
          value={`${d.licenceCard.number} · ${date(d.licenceCard.expiresOn)} gacha`}
        />
        <LicenceCardStatus verification={d.licenceCard.verification} showOk />
        {d.status === 'blocked' && d.balance < 0 ? (
          <Row label="Balans" value={som(d.balance)} tone="danger" />
        ) : null}
        {d.status === 'pending' || d.status === 'rejected' ? (
          <Button
            title={d.status === 'rejected' ? 'Tuzatib, qayta yuborish' : 'Arizani tahrirlash'}
            icon="create"
            variant={d.status === 'rejected' ? 'primary' : 'secondary'}
            onPress={() => router.push('/apply')}
          />
        ) : null}
        {missing.length === 0 ? (
          <Button
            title="Hujjatlar"
            icon="documents"
            variant="secondary"
            onPress={() => router.push('/documents')}
          />
        ) : null}
      </Card>

      {d.status === 'blocked' ? (
        <SupportCard
          title="Ofis"
          text="Ofisga kelishingiz yoki qo‘ng‘iroq qilishingiz ham mumkin: telefon raqamingizni ayting, operator sababni tushuntiradi."
        />
      ) : (
        <SupportCard text="Savollaringiz bo‘lsa, ofisga keling yoki qo‘ng‘iroq qiling." />
      )}

      <Button
        title="Chiqish"
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
