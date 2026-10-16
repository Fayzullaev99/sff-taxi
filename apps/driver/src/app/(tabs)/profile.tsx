import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, Vibration } from 'react-native';
import { useSession } from '../../auth/session';
import { keys, useDriverMe } from '../../data/queries';
import type { DriverRide } from '../../api/types';
import { errorMessage } from '../../lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { changeLanguage, type Language, LANGUAGES, useT } from '../../i18n';
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
import {
  Banner,
  Button,
  Card,
  Choice,
  ErrorState,
  Loading,
  Muted,
  Row,
  Title,
} from '../../ui/components';
import { haptics } from '../../ui/haptics';
import { ClassesCard } from '../../home/classes-card';
import { WomenRidersCard } from '../../home/women-riders-card';
import { isCargoCar } from '../../lib/service';
import { CARGO_CLASS_LABELS } from '../../lib/service';
import { Screen } from '../../ui/screen';
import { LicenceCardStatus, SupportCard } from '../../ui/widgets';

/**
 * The app's language: applied at once (every screen re-renders), kept on the phone and on
 * the account (the API writes push and SMS in it).
 */
function LanguageCard() {
  const { t, lang } = useT();
  return (
    <Card>
      <Title>{t('common.language.title')}</Title>
      <Choice
        options={LANGUAGES.map((l) => ({ value: l, label: t(`common.language.${l}`) }))}
        selected={[lang]}
        onToggle={(next: Language) => {
          haptics.select();
          void changeLanguage(next);
        }}
      />
      <Muted>{t('common.language.hint')}</Muted>
    </Card>
  );
}

/** Profile and settings: car and licence, documents, notifications, GPS, navigator, sign-out. */
export default function Profile() {
  const { t } = useT();
  const router = useRouter();
  const session = useSession();
  const me = useDriverMe();
  const push = usePushPermission();
  const [navApp, setNavApp] = useState<NavApp | 'ask'>('ask');
  const [background, setBackground] = useState<boolean | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const qc = useQueryClient();

  // signing out stops the GPS and takes the driver off shift: never with a rider waiting
  // or in the car (the rider's map would freeze)
  const signOut = () => {
    if (signingOut) return;
    const ride = qc.getQueryData<DriverRide | null>(keys.current);
    if (ride) {
      Alert.alert(t('profile.signOut.finishRideTitle'), t('profile.signOut.finishRideText'));
      return;
    }
    Alert.alert(t('profile.signOut.confirmTitle'), t('profile.signOut.confirmText'), [
      { text: t('common.actions.cancel'), style: 'cancel' },
      {
        text: t('common.actions.signOut'),
        style: 'destructive',
        onPress: () => {
          setSigningOut(true);
          void session.signOut().finally(() => setSigningOut(false));
        },
      },
    ]);
  };

  useEffect(() => {
    void getPreferredNavApp().then((a) => setNavApp(a ?? 'ask'));
    void hasBackgroundPermission().then(setBackground);
  }, []);

  if (!me.data) {
    // a failed load is said, with a retry (and the way out), not an endless spinner
    return me.isError ? (
      <Screen title={t('common.screens.profile')}>
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
        <Button
          title={t('common.actions.signOut')}
          icon="log-out-outline"
          variant="secondary"
          onPress={() => signOut()}
        />
      </Screen>
    ) : (
      <Loading />
    );
  }
  const d = me.data;
  const cardExpired = d.licenceCard.expiresOn < tashkentToday();

  const testSound = async () => {
    haptics.tap();
    Vibration.vibrate(OFFER_VIBRATION);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('profile.notifications.testTitle'),
        body: t('profile.notifications.testBody'),
        sound: OFFER_SOUND,
      },
      trigger: Platform.OS === 'android' ? { channelId: OFFERS_CHANNEL } : null,
    }).catch(() =>
      Alert.alert(
        t('profile.notifications.testFailedTitle'),
        t('profile.notifications.testFailedText'),
      ),
    );
  };

  return (
    <Screen
      title={t('common.screens.profile')}
      refreshing={me.isRefetching}
      onRefresh={() => void me.refetch()}
    >
      <Card>
        <Title>{d.fullName}</Title>
        {d.phone ? <Row label={t('profile.account.phone')} value={formatPhone(d.phone)} /> : null}
        {d.vehicle ? (
          <>
            <Row
              label={t('profile.account.vehicle')}
              value={`${d.vehicle.colour} ${d.vehicle.make} ${d.vehicle.model}, ${d.vehicle.year}`}
            />
            <Row label={t('profile.account.plate')} value={d.vehicle.plateFormatted} strong />
            {d.vehicle.service === 'cargo' ? (
              <>
                <Row
                  label={t('profile.account.service')}
                  value={t('profile.account.cargoService', {
                    class:
                      CARGO_CLASS_LABELS[d.vehicle.cargoClass ?? ''] ??
                      t('common.classes.cargoCar'),
                  })}
                />
                {d.vehicle.payloadKg ? (
                  <Row
                    label={t('profile.account.payload')}
                    value={`${d.vehicle.payloadKg} ${t('common.units.kg')}`}
                  />
                ) : null}
                <Muted>{t('profile.account.cargoOnly')}</Muted>
              </>
            ) : (
              <Row
                label={t('profile.account.classLabel')}
                value={RIDE_CLASSES[d.vehicle.class] ?? d.vehicle.class}
              />
            )}
            {d.vehicle.cngInTrunk !== undefined && d.vehicle.service !== 'cargo' ? (
              <Row
                label={t('profile.account.luggage')}
                value={
                  d.vehicle.luggage
                    ? t('profile.account.luggageYes')
                    : d.vehicle.cngInTrunk
                      ? t('profile.account.luggageNoCng')
                      : t('profile.account.luggageNoTrunk')
                }
              />
            ) : null}
          </>
        ) : null}
        <Row label={t('profile.account.licence')} value={d.licence.number} />
        <Row
          label={t('profile.account.licenceCard')}
          value={`${d.licenceCard.number} · ${t('common.units.until', { time: date(d.licenceCard.expiresOn) })}`}
          tone={cardExpired ? 'danger' : undefined}
        />
        <LicenceCardStatus verification={d.licenceCard.verification} showOk />
        {cardExpired ? (
          <Banner tone="danger" icon="alert-circle" text={t('profile.account.cardExpired')} />
        ) : null}
        <Muted>{t('profile.account.changeViaOperator')}</Muted>
        <Button
          title={t('common.screens.documents')}
          icon="documents"
          variant="secondary"
          onPress={() => router.push('/documents')}
        />
      </Card>

      {isCargoCar(d) ? null : <ClassesCard me={d} />}
      {isCargoCar(d) ? null : <WomenRidersCard me={d} />}

      <LanguageCard />

      <Card>
        <Title>{t('profile.notifications.title')}</Title>
        {push.permission === 'granted' ? (
          <Banner tone="success" icon="notifications" text={t('profile.notifications.on')} />
        ) : (
          <Banner tone="danger" icon="notifications-off" text={t('profile.notifications.off')} />
        )}
        {push.permission !== 'granted' ? (
          <Button
            title={t('common.actions.enable')}
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
          title={t('profile.notifications.testSound')}
          icon="volume-high"
          variant="secondary"
          onPress={() => void testSound()}
        />
        {Platform.OS === 'android' ? (
          <Muted>{t('profile.notifications.androidVolume')}</Muted>
        ) : null}
      </Card>

      <Card>
        <Title>{t('profile.location.title')}</Title>
        {background ? (
          <Banner tone="success" icon="location" text={t('profile.location.always')} />
        ) : (
          <>
            <Banner tone="warning" icon="location" text={t('profile.location.foregroundOnly')} />
            <Button
              title={t('profile.location.allowAlways')}
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
        <Muted>{t('profile.location.battery')}</Muted>
      </Card>

      <Card>
        <Title>{t('profile.navigator.title')}</Title>
        <Choice
          options={[
            ...NAV_APPS.map((a) => ({ value: a.app as NavApp | 'ask', label: a.label })),
            { value: 'ask', label: t('profile.navigator.askEveryTime') },
          ]}
          selected={[navApp]}
          onToggle={(v) => {
            haptics.select();
            setNavApp(v);
            void setPreferredNavApp(v === 'ask' ? null : v);
          }}
        />
      </Card>

      <SupportCard text={t('profile.support.officeText')} />

      <Button
        title={t('common.actions.signOut')}
        icon="log-out"
        variant="danger"
        loading={signingOut}
        disabled={signingOut}
        onPress={signOut}
      />
      <Muted center>
        {t('common.app.name')} {Constants.expoConfig?.version ?? ''}
      </Muted>
    </Screen>
  );
}
