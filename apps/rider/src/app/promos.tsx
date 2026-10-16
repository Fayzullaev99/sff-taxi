import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { promoEndpoints, promoKeys, useCredits, useWallet } from '../api/promo-api';
import type { PromoWallet, SavedPromo } from '../api/promo-types';
import { useT } from '../i18n';
import { confirm, notify } from '../lib/dialogs';
import { formatDateTime, formatMoney } from '../lib/format';
import { installId } from '../lib/install-id';
import {
  creditKindLabel,
  inviteMessage,
  inviteOffer,
  promoConditions,
  promoValueText,
} from '../lib/promo';
import { PromoCodeEntry } from '../order/PromoCodeEntry';
import { Banner, Button, Card, Divider, Icon, IconButton, SectionTitle, T } from '../ui/primitives';
import { ErrorView, LoadingView } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

/**
 * Promo codes and bonuses: enter a code, the saved codes (usable or why not), the ride
 * credit with its history, and "Do'stni taklif qil": the rider's own code to share.
 */
export default function PromosScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void installId().then((id) => {
      setDeviceId(id);
      setReady(true);
    });
  }, []);
  const wallet = useWallet(deviceId);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!ready || (wallet.isPending && !wallet.data)) return <LoadingView />;
  if (!wallet.data) {
    return <ErrorView error={wallet.error} onRetry={() => void wallet.refetch()} />;
  }
  const w = wallet.data;
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Card style={styles.card}>
        <T variant="h3" accessibilityRole="header">
          {t('profile.promos.codeTitle')}
        </T>
        <T variant="small" color={colors.textMuted}>
          {[
            t('profile.promos.codeHint'),
            w.canEnterReferral ? t('profile.promos.codeHintReferral') : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </T>
        <PromoCodeEntry />
        {w.invitedBy && w.invitedBy.welcomeRidesLeft > 0 ? (
          <Banner
            tone="success"
            icon="gift-outline"
            message={t('profile.promos.invitedBy', { code: w.invitedBy.code })}
          />
        ) : null}
      </Card>

      {w.promos.length ? (
        <>
          <SectionTitle>{t('profile.promos.myCodes')}</SectionTitle>
          <Card style={styles.list}>
            {w.promos.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <PromoRow promo={p} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('profile.promos.bonusTitle')}</SectionTitle>
      <Card style={styles.card}>
        <View style={styles.balanceRow}>
          <Icon name="wallet-outline" size={24} color={colors.ink} />
          <View style={styles.flex}>
            <T variant="h2">{formatMoney(w.credit.balance)}</T>
            <T variant="small" color={colors.textMuted}>
              {t('profile.promos.bonusHint', { percent: w.credit.maxPercent })}
            </T>
          </View>
        </View>
        <Button
          title={historyOpen ? t('profile.promos.historyClose') : t('profile.promos.historyOpen')}
          variant="secondary"
          size="sm"
          onPress={() => setHistoryOpen((o) => !o)}
        />
        {historyOpen ? <CreditHistory /> : null}
      </Card>

      {w.referral.enabled ? <InviteCard wallet={w} /> : null}
    </ScrollView>
  );
}

function PromoRow({ promo }: { promo: SavedPromo }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    const ok = await confirm({
      title: t('profile.promos.remove.title', { code: promo.code }),
      message: t('profile.promos.remove.message'),
      confirmText: t('common.actions.delete'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      queryClient.setQueryData(promoKeys.wallet, await promoEndpoints.remove(promo.id));
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
    } catch (e) {
      notify(t('profile.promos.remove.failed'), describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const conditions = promoConditions(promo);
  return (
    <View style={styles.promoRow} accessible>
      <View style={[styles.badge, !promo.usable ? styles.badgeOff : null]}>
        <Icon name="pricetag" size={18} color={promo.usable ? colors.ink : colors.textMuted} />
      </View>
      <View style={styles.flex}>
        <T variant="bodyStrong">{promo.code}</T>
        <T variant="small">{promoValueText(promo)}</T>
        {promo.description ? (
          <T variant="small" color={colors.textMuted}>
            {promo.description}
          </T>
        ) : null}
        {conditions ? (
          <T variant="small" color={colors.textMuted}>
            {conditions}
          </T>
        ) : null}
        {!promo.usable && promo.reason ? (
          <T variant="small" color={colors.warning}>
            {promo.reason}
          </T>
        ) : null}
      </View>
      <IconButton
        name="trash-outline"
        label={t('profile.promos.remove.a11y', { code: promo.code })}
        size={40}
        onPress={() => {
          if (!busy) void remove();
        }}
      />
    </View>
  );
}

function CreditHistory() {
  const { t } = useT();
  const credits = useCredits(true);
  const items = useMemo(() => credits.data?.pages.flatMap((p) => p.items) ?? [], [credits.data]);
  if (credits.isPending) return <T variant="small">{t('profile.promos.loading')}</T>;
  if (credits.isError && !items.length) {
    return <Banner tone="warning" message={describeError(credits.error)} />;
  }
  if (!items.length) {
    return (
      <T variant="small" color={colors.textMuted}>
        {t('profile.promos.noBonus')}
      </T>
    );
  }
  return (
    <View style={styles.history}>
      {items.map((c) => (
        <View key={c.id} style={styles.historyRow}>
          <View style={styles.flex}>
            <T variant="smallStrong">
              {creditKindLabel(c.kind)}
              {c.rideNumber ? ` · #${c.rideNumber}` : ''}
            </T>
            <T variant="caption" color={colors.textMuted}>
              {formatDateTime(c.createdAt)}
            </T>
          </View>
          <T variant="bodyStrong" color={c.amount > 0 ? colors.success : colors.text}>
            {c.amount > 0 ? '+' : '−'}
            {formatMoney(Math.abs(c.amount))}
          </T>
        </View>
      ))}
      {credits.hasNextPage ? (
        <Button
          title={t('common.actions.more')}
          variant="ghost"
          size="sm"
          loading={credits.isFetchingNextPage}
          onPress={() => void credits.fetchNextPage()}
        />
      ) : null}
    </View>
  );
}

/** "Do'stni taklif qil": the rider's code, what both sides get, the share sheet. */
function InviteCard({ wallet }: { wallet: PromoWallet }) {
  const { t } = useT();
  const r = wallet.referral;
  const share = async () => {
    try {
      await Share.share({ message: inviteMessage(r), url: r.url });
    } catch {
      // dismissed or unavailable
    }
  };
  return (
    <>
      <SectionTitle>{t('profile.promos.invite.title')}</SectionTitle>
      <Card style={styles.card}>
        <T variant="body">{inviteOffer(r)}</T>
        <View
          style={styles.code}
          accessible
          accessibilityLabel={t('profile.promos.invite.yourCodeA11y', {
            code: r.code.split('').join(' '),
          })}
        >
          <T variant="small" color={colors.textMuted}>
            {t('profile.promos.invite.yourCode')}
          </T>
          <T variant="plate">{r.code}</T>
        </View>
        <Button
          title={t('common.actions.share')}
          icon="share-social-outline"
          onPress={() => void share()}
        />
        <T variant="small" color={colors.textMuted}>
          {t('profile.promos.invite.stats', {
            invited: r.invited,
            rewarded: r.rewarded,
            earned: formatMoney(r.earned),
          })}
        </T>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  card: { gap: space(3) },
  list: { gap: 0, paddingVertical: space(1) },
  flex: { flex: 1, minWidth: 0 },
  promoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(3),
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeOff: { backgroundColor: colors.surface },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  history: { gap: space(2) },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  code: {
    alignItems: 'center',
    gap: space(1),
    padding: space(3),
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brand,
    borderStyle: 'dashed',
  },
});
