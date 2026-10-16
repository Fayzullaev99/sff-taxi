import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useIsSignedIn } from '../../api/session';
import { pendingInvite } from '../../lib/pending-invite';
import { normalizeCode } from '../../lib/promo';
import { PromoCodeEntry } from '../../order/PromoCodeEntry';
import { Button, Card, Icon, T } from '../../ui/primitives';
import { colors, space } from '../../ui/theme';

/**
 * A promo-code link from an ad or the landing site (https://taxi.<domain>/promo/CODE through
 * the app link, or sfftaxi://promo/CODE): the code is filled in and saved to the wallet. The
 * same code box and the same sign-in detour as an invitation (invite/[code].tsx).
 */
export default function PromoLinkScreen() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(raw ?? '');
  const signedIn = useIsSignedIn();

  useEffect(() => {
    if (code) void pendingInvite.set(signedIn ? null : code);
  }, [code, signedIn]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Icon name="pricetag-outline" size={40} color={colors.ink} />
        <T variant="h2" accessibilityRole="header">
          Sizga promokod: {code}
        </T>
        <T variant="body" color={colors.textMuted}>
          Kod hamyoningizga saqlanadi va mos safarda chegirma narxda ko‘rinadi. Shartlari kod yonida
          yoziladi.
        </T>
        {signedIn ? (
          <PromoCodeEntry initial={code} onAdded={() => router.replace('/home')} />
        ) : (
          <Button
            title="Kirish va kodni qo‘llash"
            onPress={() => router.replace('/sign-in')}
            accessibilityLabel={`Kirish, keyin ${code} kodini qo‘llash`}
          />
        )}
        <Button
          title="Keyinroq"
          variant="ghost"
          onPress={() => {
            void pendingInvite.set(null);
            router.replace(signedIn ? '/home' : '/sign-in');
          }}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4) },
  card: { gap: space(3), alignItems: 'stretch' },
});
