import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { describeError } from '../api/client';
import { promoEndpoints, promoKeys } from '../api/promo-api';
import type { AddedCode } from '../api/promo-types';
import { installId } from '../lib/install-id';
import { codeReady, normalizeCode } from '../lib/promo';
import { Banner, Button, TextField } from '../ui/primitives';
import { space } from '../ui/theme';

/**
 * The promo code box (profile and order screen): a campaign code is saved to the wallet, a
 * friend's invitation code makes this rider an invitee. The quote is priced again, so the
 * discount shows at once; the API's refusal is shown as it says it (expired, used, …).
 */
export function PromoCodeEntry({
  onAdded,
  autoFocus = false,
  initial = '',
}: {
  onAdded?: (result: AddedCode) => void;
  autoFocus?: boolean;
  initial?: string;
}) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = async () => {
    if (!codeReady(code) || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const added = await promoEndpoints.add(normalizeCode(code), await installId());
      queryClient.setQueryData(promoKeys.wallet, added.wallet);
      // taxi, delivery and cargo quotes alike
      void queryClient.invalidateQueries({ queryKey: ['quote'] });
      setResult({
        ok: true,
        text:
          added.added.kind === 'referral'
            ? 'Taklif kodi qabul qilindi: birinchi safaringizga chegirma'
            : `${added.added.code} qo‘shildi: mos safarda chegirma o‘zi qo‘llanadi`,
      });
      setCode('');
      onAdded?.(added);
    } catch (e) {
      setResult({ ok: false, text: describeError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <TextField
          style={styles.flex}
          placeholder="Promokod yoki taklif kodi"
          accessibilityLabel="Promokod yoki taklif kodi"
          value={code}
          onChangeText={(t) => {
            setResult(null);
            setCode(t.toUpperCase());
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          maxLength={24}
          returnKeyType="done"
          onSubmitEditing={() => void apply()}
        />
        <Button
          title="Qo‘llash"
          variant="dark"
          loading={busy}
          disabled={!codeReady(code)}
          onPress={() => void apply()}
        />
      </View>
      {result ? <Banner tone={result.ok ? 'success' : 'danger'} message={result.text} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  flex: { flex: 1 },
});
