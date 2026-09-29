import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSupport } from '../api/support';
import type { Ride } from '../api/types';
import { canComplain } from '../lib/complaints';
import { cancellationFeeNote, fareLines, OWED_FEE_LABEL } from '../lib/fare';
import { POOL_DISCOUNT_LABEL } from '../lib/sharing';
import { classLabel, isCargoClass, loadLine, SERVICE_NAMES, serviceTitle } from '../lib/services';
import { driverGivenName, formatDateTime, formatMoney, placeLine } from '../lib/format';
import { callPhone, openLink } from '../lib/links';
import { cardMoneyNote } from '../lib/payment';
import { cancelledText, rideScreen } from '../lib/ride-state';
import { orderPath, updateDraft } from '../trip/draft';
import { Banner, Button, Card, Divider, KeyValue, T } from '../ui/primitives';
import { colors, space } from '../ui/theme';
import { RatingForm } from './RatingForm';

/** Rating stays possible this long after the ride (the API's window). */
const RATING_WINDOW_MS = 7 * 86_400_000;

/**
 * A finished ride: the fare and what it is made of, the fiscal receipt, the rating for a
 * completed ride, or why it was cancelled (with the refund of a prepaid card ride) and a
 * way to order again; a complaint or a lost item for a week after the ride.
 */
export function RideSummary({ ride }: { ride: Ride }) {
  const insets = useSafeAreaInsets();
  const support = useSupport();
  const screen = rideScreen(ride);
  const completed = ride.status === 'completed';
  // fees owed from earlier cancelled rides this ride collected: a line apart from the fare
  const owedFee = ride.fare.owedFee ?? 0;
  const total = (ride.fare.total ?? ride.fare.quoted + ride.fare.waiting) + owedFee;
  const now = new Date();
  const canRate =
    completed &&
    ride.completedAt !== null &&
    now.getTime() - new Date(ride.completedAt).getTime() < RATING_WINDOW_MS &&
    ride.driver !== null;
  const money = cardMoneyNote(ride);
  // complaints are about a driver or a trip: only rides a driver took
  const complain = ride.driver !== null && canComplain(ride, now);

  const orderAgain = () => {
    updateDraft({
      pickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, address: ride.pickup.address },
      dropoff: { lat: ride.dropoff.lat, lng: ride.dropoff.lng, address: ride.dropoff.address },
      landmark: ride.pickup.landmark ?? '',
      comment: ride.comment ?? '',
      options: ride.options,
      ...(isCargoClass(ride.class) ? { cargoClass: ride.class } : { rideClass: ride.class }),
      service: ride.service ?? 'taxi',
      ...(ride.cargo
        ? {
            loaders: ride.cargo.loaders,
            riderRides: ride.cargo.riderRides,
            loadDescription: ride.cargo.description ?? '',
            loadWeight: ride.cargo.weightKg ? String(ride.cargo.weightKg) : '',
          }
        : {}),
      scheduledFor: null,
      moveMap: { lat: ride.pickup.lat, lng: ride.pickup.lng, key: Date.now() },
    });
    router.replace(orderPath(ride.service ?? 'taxi'));
  };

  const openComplaint = (type?: 'lost_item') =>
    router.push({
      pathname: '/support/new',
      params: { rideId: ride.id, number: String(ride.number), ...(type ? { type } : {}) },
    });

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(6) }]}
    >
      <View style={styles.head}>
        <T variant="h1" accessibilityRole="header">
          {serviceTitle(ride.service, screen.phase, screen.title)}
        </T>
        <T variant="small" color={colors.textMuted}>
          {ride.service && ride.service !== 'taxi' ? `${SERVICE_NAMES[ride.service]} · ` : ''}#
          {ride.number} · {formatDateTime(ride.requestedAt)} · {classLabel(ride.class)}
        </T>
        {loadLine(ride) ? (
          <T variant="small" color={colors.textMuted} numberOfLines={3}>
            {loadLine(ride)}
          </T>
        ) : null}
      </View>

      {!completed ? (
        <Banner
          tone={screen.phase === 'cancelled' ? 'info' : 'warning'}
          message={cancelledText(ride)}
        />
      ) : null}
      {ride.fare.cancellationFee > 0 ? (
        <Banner
          tone="warning"
          title={`Bekor qilish to‘lovi: ${formatMoney(ride.fare.cancellationFee)}`}
          message={cancellationFeeNote(ride.fare)}
        />
      ) : null}
      {money && screen.phase !== 'payment_failed' ? (
        <Banner tone={money.tone} title={money.title} message={money.message} />
      ) : null}

      <Card style={styles.card}>
        <KeyValue label="Qayerdan" value={placeLine(ride.pickup)} />
        <KeyValue label="Qayerga" value={placeLine(ride.dropoff)} />
        {ride.scheduledFor ? (
          <KeyValue label="Oldindan, vaqti" value={formatDateTime(ride.scheduledFor)} />
        ) : null}
        {ride.vehicle ? (
          <KeyValue
            label="Mashina"
            value={`${ride.vehicle.colour} ${ride.vehicle.model}, ${ride.vehicle.plateFormatted}`}
          />
        ) : null}
        {ride.driver ? <KeyValue label="Haydovchi" value={ride.driver.name} /> : null}
      </Card>

      {completed ? (
        <Card style={styles.card}>
          {fareLines(ride.fare.breakdown, ride.fare.waiting).map((line) => (
            <KeyValue key={line.label} label={line.label} value={formatMoney(line.amount)} />
          ))}
          {(ride.fare.poolDiscount ?? 0) > 0 ? (
            <KeyValue
              label={POOL_DISCOUNT_LABEL}
              value={`−${formatMoney(ride.fare.poolDiscount!)}`}
              valueColor={colors.success}
            />
          ) : null}
          {owedFee > 0 ? (
            <>
              <KeyValue label={OWED_FEE_LABEL} value={formatMoney(owedFee)} />
              <T variant="small" color={colors.textMuted}>
                Avvalgi safaringiz haydovchi kutgandan keyin bekor qilingan edi: o‘sha bekor qilish
                to‘lovi shu safarda naqd olindi.
              </T>
            </>
          ) : null}
          <Divider style={styles.divider} />
          <KeyValue label="Jami" value={formatMoney(total)} strong />
          {(ride.fare.deposit ?? 0) > 0 ? (
            <KeyValue
              label="Shundan oldindan to‘langan (depozit)"
              value={formatMoney(ride.fare.deposit!)}
            />
          ) : null}
          <T variant="small" color={colors.textMuted}>
            {ride.paymentMethod === 'cash'
              ? 'Naqd to‘lov haydovchiga.'
              : ride.fare.waiting > 0
                ? 'Safar narxi karta orqali oldindan to‘langan; pullik kutish naqd to‘lanadi.'
                : 'Karta orqali oldindan to‘langan.'}{' '}
            Narx buyurtmadagidek, faqat pullik kutish qo‘shiladi.
          </T>
          <Receipt ride={ride} />
        </Card>
      ) : null}

      {canRate ? (
        <Card style={styles.card}>
          <RatingForm
            rideId={ride.id}
            driverName={driverGivenName(ride.driver?.name)}
            rated={ride.rated}
          />
          <T variant="small" color={colors.textMuted} align="center">
            Choy puli ilovada hozircha yo‘q — xohlasangiz haydovchiga naqd bering.
          </T>
        </Card>
      ) : null}

      {complain ? (
        <Card style={styles.card}>
          <T variant="h3" accessibilityRole="header">
            Muammo bo‘ldimi?
          </T>
          <View style={styles.row}>
            <Button
              title="Narsam qoldi"
              icon="bag-handle-outline"
              variant="secondary"
              onPress={() => openComplaint('lost_item')}
              style={styles.flex}
            />
            <Button
              title="Shikoyat"
              icon="chatbubble-ellipses-outline"
              variant="secondary"
              onPress={() => openComplaint()}
              style={styles.flex}
            />
          </View>
        </Card>
      ) : null}

      <View style={styles.buttons}>
        {screen.phase === 'no_driver' ||
        screen.phase === 'cancelled' ||
        screen.phase === 'payment_failed' ? (
          <Button title="Qayta buyurtma berish" size="lg" icon="refresh" onPress={orderAgain} />
        ) : null}
        {screen.phase === 'no_driver' && support.phone ? (
          <Button
            title="Operatorga qo‘ng‘iroq qilish"
            variant="dark"
            size="lg"
            icon="call"
            onPress={() => void callPhone(support.phone!)}
          />
        ) : null}
        {completed ? (
          <Button title="Shu yo‘nalishda yana" variant="secondary" size="lg" onPress={orderAgain} />
        ) : null}
        <Button
          title="Bosh sahifa"
          variant={completed ? 'primary' : 'secondary'}
          size="lg"
          onPress={() => router.dismissTo('/home')}
        />
      </View>
    </ScrollView>
  );
}

/** The electronic fiscal receipt (Resolution 200): a link once the tax service issued it. */
function Receipt({ ride }: { ride: Ride }) {
  const r = ride.receipt;
  if (r?.url) {
    return (
      <Button
        title="Elektron chek"
        icon="receipt-outline"
        variant="outline"
        onPress={() => void openLink(r.url!)}
        accessibilityLabel="Elektron fiskal chekni ochish"
      />
    );
  }
  if (r?.status === 'pending') {
    return (
      <T variant="small" color={colors.textMuted}>
        Elektron chek tayyorlanmoqda — keyinroq shu yerda paydo bo‘ladi.
      </T>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1), marginBottom: space(1) },
  card: { gap: space(1) },
  divider: { marginVertical: space(2) },
  buttons: { gap: space(2.5), marginTop: space(2) },
  row: { flexDirection: 'row', gap: space(2.5), marginTop: space(1) },
  flex: { flex: 1 },
});
