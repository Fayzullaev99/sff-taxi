import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Vibration } from 'react-native';
import { useSession } from '../../auth/session';
import { useDriverMe } from '../../data/queries';
import { tashkentToday } from '../../lib/application';
import { date, formatPhone, RIDE_CLASSES } from '../../lib/format';
import { NAV_APPS, type NavApp } from '../../lib/links';
import {
  hasBackgroundPermission,
  requestBackgroundPermission,
  restartTracking,
} from '../../location/tracker';
import {
  OFFER_SOUND,
  OFFER_VIBRATION,
  OFFERS_CHANNEL,
  registerPushDevice,
  requestPushPermission,
} from '../../notifications/push';
import { usePushPermission } from '../../notifications/use-push';
import { getPreferredNavApp, setPreferredNavApp } from '../../ui/actions';
import { Banner, Button, Card, Choice, Loading, Muted, Row, Title } from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { WomenRidersCard } from '../../home/women-riders-card';
import { CARGO_CLASS_LABELS } from '../../lib/service';
import { Screen } from '../../ui/screen';
import { LicenceCardStatus, SupportCard } from '../../ui/widgets';

/** Profile and settings: car and licence, documents, notifications, GPS, navigator, sign-out. */
export default function Profile() {
  const router = useRouter();
  const session = useSession();
  const me = useDriverMe();
  const push = usePushPermission();
  const [navApp, setNavApp] = useState<NavApp | 'ask'>('ask');
  const [background, setBackground] = useState<boolean | null>(null);

  useEffect(() => {
    void getPreferredNavApp().then((a) => setNavApp(a ?? 'ask'));
    void hasBackgroundPermission().then(setBackground);
  }, []);

  if (!me.data) return <Loading />;
  const d = me.data;
  const cardExpired = d.licenceCard.expiresOn < tashkentToday();

  const testSound = async () => {
    haptics.tap();
    Vibration.vibrate(OFFER_VIBRATION);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Sinov: yangi buyurtma',
        body: 'Buyurtma ovozi shunday eshitiladi',
        sound: OFFER_SOUND,
      },
      trigger: Platform.OS === 'android' ? { channelId: OFFERS_CHANNEL } : null,
    }).catch(() => Alert.alert('Ovoz chalinmadi', 'Bildirishnomalarga ruxsat bering.'));
  };

  const signOut = () =>
    Alert.alert('Chiqasizmi?', 'Liniyadan chiqasiz va bu telefonga buyurtmalar kelmaydi.', [
      { text: 'Bekor qilish', style: 'cancel' },
      { text: 'Chiqish', style: 'destructive', onPress: () => void session.signOut() },
    ]);

  return (
    <Screen title="Profil" refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      <Card>
        <Title>{d.fullName}</Title>
        {d.phone ? <Row label="Telefon" value={formatPhone(d.phone)} /> : null}
        {d.vehicle ? (
          <>
            <Row
              label="Avtomobil"
              value={`${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}, ${d.vehicle.year}`}
            />
            <Row label="Davlat raqami" value={d.vehicle.plateFormatted} strong />
            {d.vehicle.service === 'cargo' ? (
              <>
                <Row
                  label="Xizmat"
                  value={`Yuk tashish · ${CARGO_CLASS_LABELS[d.vehicle.cargoClass ?? ''] ?? 'yuk mashinasi'}`}
                />
                {d.vehicle.payloadKg ? (
                  <Row label="Yuk ko‘tarish" value={`${d.vehicle.payloadKg} kg`} />
                ) : null}
                <Muted>Yuk mashinasiga faqat yuk buyurtmalari keladi.</Muted>
              </>
            ) : (
              <Row label="Sinf" value={RIDE_CLASSES[d.vehicle.class] ?? d.vehicle.class} />
            )}
            {d.vehicle.cngInTrunk !== undefined && d.vehicle.service !== 'cargo' ? (
              <Row
                label="Katta yukli buyurtmalar"
                value={
                  d.vehicle.luggage
                    ? 'Keladi'
                    : d.vehicle.cngInTrunk
                      ? 'Kelmaydi: yukxonada gaz ballon'
                      : 'Kelmaydi: katta yukxona belgilanmagan'
                }
              />
            ) : null}
          </>
        ) : null}
        <Row label="Guvohnoma" value={d.licence.number} />
        <Row
          label="Litsenziya kartochkasi"
          value={`${d.licenceCard.number} · ${date(d.licenceCard.expiresOn)} gacha`}
          tone={cardExpired ? 'danger' : undefined}
        />
        <LicenceCardStatus verification={d.licenceCard.verification} showOk />
        {cardExpired ? (
          <Banner
            tone="danger"
            icon="alert-circle"
            text="Litsenziya kartochkasi muddati o‘tgan: yangisini yuklang va ofisga murojaat qiling."
          />
        ) : null}
        <Muted>Ma’lumotlarni o‘zgartirish uchun operatorga murojaat qiling.</Muted>
        <Button
          title="Hujjatlar"
          icon="documents"
          variant="secondary"
          onPress={() => router.push('/documents')}
        />
      </Card>

      <WomenRidersCard me={d} />

      <Card>
        <Title>Bildirishnomalar</Title>
        {push.permission === 'granted' ? (
          <Banner
            tone="success"
            icon="notifications"
            text="Yoqilgan: buyurtmalar ilova yopiq bo‘lsa ham keladi"
          />
        ) : (
          <Banner
            tone="danger"
            icon="notifications-off"
            text="O‘chiq: ilova fonda bo‘lsa buyurtmalarni eshitmaysiz"
          />
        )}
        {push.permission !== 'granted' ? (
          <Button
            title="Yoqish"
            icon="notifications"
            onPress={() =>
              push.permission === 'blocked'
                ? void Linking.openSettings()
                : void requestPushPermission().then((ok) => {
                    if (ok) void registerPushDevice();
                    void push.refresh();
                  })
            }
          />
        ) : null}
        <Button
          title="Buyurtma ovozini sinash"
          icon="volume-high"
          variant="secondary"
          onPress={() => void testSound()}
        />
        {Platform.OS === 'android' ? (
          <Muted>
            Ovoz balandligi “Buyurtmalar” kanali sozlamasida: Sozlamalar → Ilovalar → SFF Taxi
            Haydovchi → Bildirishnomalar.
          </Muted>
        ) : null}
      </Card>

      <Card>
        <Title>Joylashuv</Title>
        {background ? (
          <Banner
            tone="success"
            icon="location"
            text="“Har doim” ruxsat berilgan: navigator ochiq bo‘lsa ham ishlaydi"
          />
        ) : (
          <>
            <Banner
              tone="warning"
              icon="location"
              text="Faqat ilova ochiqligida: navigatorga o‘tsangiz buyurtmalar kechikishi mumkin"
            />
            <Button
              title="“Har doim” ruxsat berish"
              icon="location"
              variant="secondary"
              onPress={() =>
                void requestBackgroundPermission().then(async (ok) => {
                  setBackground(ok);
                  if (ok) await restartTracking();
                  else void Linking.openSettings();
                })
              }
            />
          </>
        )}
        <Muted>
          Batareyani tejash rejimi ilovani to‘xtatib qo‘yishi mumkin: telefon sozlamalarida SFF Taxi
          Haydovchi uchun “Cheklovsiz” ni tanlang.
        </Muted>
      </Card>

      <Card>
        <Title>Navigator</Title>
        <Choice
          options={[
            ...NAV_APPS.map((a) => ({ value: a.app as NavApp | 'ask', label: a.label })),
            { value: 'ask', label: 'Har safar so‘rash' },
          ]}
          selected={[navApp]}
          onToggle={(v) => {
            haptics.select();
            setNavApp(v);
            void setPreferredNavApp(v === 'ask' ? null : v);
          }}
        />
      </Card>

      <SupportCard text="Savol, shikoyat yoki hujjat o‘zgarishi bo‘yicha ofisga murojaat qiling." />

      <Button title="Chiqish" icon="log-out" variant="danger" onPress={signOut} />
      <Muted center>SFF Taxi Haydovchi {Constants.expoConfig?.version ?? ''}</Muted>
    </Screen>
  );
}
