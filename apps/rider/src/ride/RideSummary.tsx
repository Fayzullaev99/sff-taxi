import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Ride } from '../api/types';
import { CLASS_LABELS, fareLines } from '../lib/fare';
import { firstName, formatDateTime, formatMoney, placeLine } from '../lib/format';
import { callPhone, OPERATOR_PHONE } from '../lib/links';
import { cancelledText, rideScreen } from '../lib/ride-state';
import { updateDraft } from '../trip/draft';
import { Banner, Button, Card, Divider, KeyValue, T } from '../ui/primitives';
import { colors, space } from '../ui/theme';
import { RatingForm } from './RatingForm';

/** Rating stays possible this long after the ride (the API's window). */
const RATING_WINDOW_MS = 7 * 86_400_000;

/**
 * A finished ride: the fare and what it is made of, the rating for a completed ride, or
 * why it was cancelled with a way to order again (and the office's number when no
 * driver was found).
 */
export function RideSummary({ ride }: { ride: Ride }) {
  const insets = useSafeAreaInsets();
  const screen = rideScreen(ride);
  const completed = ride.status === 'completed';
  const total = ride.fare.total ?? ride.fare.quoted + ride.fare.waiting;
  const canRate =
    completed &&
    ride.completedAt !== null &&
    Date.now() - new Date(ride.completedAt).getTime() < RATING_WINDOW_MS &&
    ride.driver !== null;

  const orderAgain = () => {
    updateDraft({
      pickup: { lat: ride.pickup.lat, lng: ride.pickup.lng, address: ride.pickup.address },
      dropoff: { lat: ride.dropoff.lat, lng: ride.dropoff.lng, address: ride.dropoff.address },
      landmark: ride.pickup.landmark ?? '',
      comment: ride.comment ?? '',
      options: ride.options,
      rideClass: ride.class,
      moveMap: { lat: ride.pickup.lat, lng: ride.pickup.lng, key: Date.now() },
    });
    router.replace('/order');
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(6) }]}
    >
      <View style={styles.head}>
        <T variant="h1" accessibilityRole="header">
          {screen.title}
        </T>
        <T variant="small" color={colors.textMuted}>
          #{ride.number} · {formatDateTime(ride.requestedAt)} · {CLASS_LABELS[ride.class]}
        </T>
      </View>

      {!completed ? (
        <Banner
          tone={screen.phase === 'no_driver' ? 'warning' : 'info'}
          message={cancelledText(ride)}
        />
      ) : null}
      {ride.fare.cancellationFee > 0 ? (
        <Banner
          tone="warning"
          title={`Bekor qilish to‘lovi: ${formatMoney(ride.fare.cancellationFee)}`}
          message="Haydovchi yetib kelib, bepul kutish vaqti tugaganidan keyin bekor qilindi."
        />
      ) : null}

      <Card style={styles.card}>
        <KeyValue label="Qayerdan" value={placeLine(ride.pickup)} />
        <KeyValue label="Qayerga" value={placeLine(ride.dropoff)} />
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
          <Divider style={styles.divider} />
          <KeyValue label="Jami" value={formatMoney(total)} strong />
          <T variant="small" color={colors.textMuted}>
            {ride.paymentMethod === 'cash' ? 'Naqd to‘lov haydovchiga.' : 'Karta orqali.'} Narx
            buyurtmadagidek, faqat pullik kutish qo‘shiladi.
          </T>
        </Card>
      ) : null}

      {canRate ? (
        <Card style={styles.card}>
          <RatingForm rideId={ride.id} driverName={firstName(ride.driver?.name)} />
          <T variant="small" color={colors.textMuted} align="center">
            Choy puli ilovada hozircha yo‘q — xohlasangiz haydovchiga naqd bering.
          </T>
        </Card>
      ) : null}

      <View style={styles.buttons}>
        {screen.phase === 'no_driver' || screen.phase === 'cancelled' ? (
          <Button title="Qayta buyurtma berish" size="lg" icon="refresh" onPress={orderAgain} />
        ) : null}
        {screen.phase === 'no_driver' && OPERATOR_PHONE ? (
          <Button
            title="Operatorga qo‘ng‘iroq qilish"
            variant="dark"
            size="lg"
            icon="call"
            onPress={() => void callPhone(OPERATOR_PHONE!)}
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

const styles = StyleSheet.create({
  content: { padding: space(4), gap: space(3) },
  head: { gap: space(1), marginBottom: space(1) },
  card: { gap: space(1) },
  divider: { marginVertical: space(2) },
  buttons: { gap: space(2.5), marginTop: space(2) },
});
