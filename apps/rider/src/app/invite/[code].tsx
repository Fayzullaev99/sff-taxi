import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useIsSignedIn } from '../../api/session';
import { useT } from '../../i18n';
import { pendingInvite } from '../../lib/pending-invite';
import { normalizeCode } from '../../lib/promo';
import { PromoCodeEntry } from '../../order/PromoCodeEntry';
import { Button, Card, Icon, T } from '../../ui/primitives';
import { colors, space } from '../../ui/theme';

/**
 * An invitation link (sfftaxi://invite/CODE, or the web page's "open in the app"): the code
 * is filled in; a rider who is not signed in yet signs in first and comes back here.
 */
export default function InviteScreen() {
  const { t } = useT();
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(raw ?? '');
  const signedIn = useIsSignedIn();

  useEffect(() => {
    // not signed in yet: kept, and the sign-in brings the rider back here (once)
    if (code) void pendingInvite.set(signedIn ? null : code);
  }, [code, signedIn]);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Icon name="gift-outline" size={40} color={colors.ink} />
        <T variant="h2" accessibilityRole="header">
          {t('profile.invite.title')}
        </T>
        <T variant="body" color={colors.textMuted}>
          {t('profile.invite.text')}
        </T>
        {signedIn ? (
          <PromoCodeEntry initial={code} onAdded={() => router.replace('/home')} />
        ) : (
          <Button
            title={t('profile.invite.signIn')}
            onPress={() => router.replace('/sign-in')}
            accessibilityLabel={t('profile.invite.signInA11y', { code })}
          />
        )}
        <Button
          title={t('profile.invite.later')}
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
