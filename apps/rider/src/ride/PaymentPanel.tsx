import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CardProvider, Ride } from '../api/types';
import { formatClock, formatMoney } from '../lib/format';
import { useNow } from '../lib/hooks';
import { openLink } from '../lib/links';
import { checkoutLinks, paymentSecondsLeft } from '../lib/payment';
import { Banner, Button, Icon, T } from '../ui/primitives';
import { colors, radius, space } from '../ui/theme';

/** Where Payme/Click send the rider back (the API's PAYMENT_RETURN_URL, app scheme). */
const PAYMENT_RETURN_PREFIX = 'sfftaxi://payments';

/**
 * A card ride waiting for its prepayment: the amount, the time left (10 minutes, then the
 * API cancels the ride) and the providers' checkout pages, opened in an in-app browser
 * tab. Payme/Click confirm the payment to the API server to server; the ride is polled
 * (and nudged over the stream), so the search starts on this screen by itself.
 */
export function PaymentPanel({
  ride,
  onCheck,
}: {
  ride: Ride;
  /** Re-reads the ride; resolves when the answer is in. */
  onCheck: () => Promise<unknown>;
}) {
  const now = useNow(1000);
  const [opening, setOpening] = useState<CardProvider | null>(null);
  // "I paid — check": a spinner, then a word when the payment has not arrived yet (the
  // screen moves on by itself once it has); before, the tap did nothing visible
  const [checking, setChecking] = useState(false);
  const [notYet, setNotYet] = useState(false);

  const check = async () => {
    setChecking(true);
    setNotYet(false);
    await onCheck().catch(() => undefined);
    setChecking(false);
    setNotYet(true);
  };
  const left = paymentSecondsLeft(ride.payment, now);
  const links = checkoutLinks(ride.payment);
  const amount = ride.payment?.amount ?? ride.fare.quoted;
  const expired = left === 0;

  const pay = async (provider: CardProvider, url: string) => {
    setOpening(provider);
    try {
      // an auth session closes the tab by itself when the provider sends the rider back to
      // PAYMENT_RETURN_URL (sfftaxi://payments/{intentId}); else the rider closes it
      await WebBrowser.openAuthSessionAsync(url, PAYMENT_RETURN_PREFIX, {
        toolbarColor: colors.brand,
        controlsColor: colors.ink,
        showTitle: true,
        enableBarCollapsing: true,
      });
    } catch {
      // no browser tab available: the system browser
      await openLink(url);
    } finally {
      setOpening(null);
      void onCheck();
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.amount} accessible accessibilityRole="text">
        <Icon name="card" size={22} color={colors.ink} />
        <View style={styles.flex}>
          <T variant="small" color={colors.textMuted}>
            To‘lanadigan summa
          </T>
          <T variant="price">{formatMoney(amount)}</T>
        </View>
        {left !== null && !expired ? (
          <View
            style={styles.timer}
            accessibilityLabel={`To‘lash uchun ${formatClock(left)} qoldi`}
          >
            <Icon name="time-outline" size={16} color={colors.ink} />
            <T variant="bodyStrong">{formatClock(left)}</T>
          </View>
        ) : null}
      </View>

      {expired ? (
        <Banner
          tone="warning"
          title="To‘lov vaqti tugadi"
          message="To‘lov tekshirilmoqda. To‘lamagan bo‘lsangiz, buyurtma bir necha daqiqada bekor qilinadi va kartadan pul yechilmaydi."
        />
      ) : (
        <T variant="body" color={colors.textMuted}>
          Narx o‘zgarmaydi. To‘lov tasdiqlangach haydovchi qidiruvi avtomatik boshlanadi. Bekor
          qilsangiz, pul to‘liq qaytariladi.
        </T>
      )}

      {links.map((link) => (
        <Button
          key={link.provider}
          title={link.label}
          size="lg"
          icon="card-outline"
          variant={link.provider === links[0]!.provider ? 'primary' : 'dark'}
          loading={opening === link.provider}
          disabled={opening !== null && opening !== link.provider}
          onPress={() => void pay(link.provider, link.url)}
        />
      ))}
      {!links.length && !expired ? (
        <T variant="small" color={colors.textMuted}>
          To‘lov sahifasi tayyorlanmoqda…
        </T>
      ) : null}

      <Button
        title="To‘ladim — tekshirish"
        variant="secondary"
        icon="refresh"
        loading={checking}
        onPress={() => void check()}
      />
      {notYet && !checking && !expired ? (
        <T variant="small" color={colors.textMuted} accessibilityLiveRegion="polite">
          To‘lov hali kelmadi. To‘lov sahifasida to‘lovni yakunlang — tasdiq kelishi bilan haydovchi
          qidiruvi o‘zi boshlanadi.
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  flex: { flex: 1, minWidth: 0 },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    padding: space(3.5),
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(2.5),
    paddingVertical: space(1.5),
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
});
