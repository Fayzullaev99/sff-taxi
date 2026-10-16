import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys, useRide } from '../api/queries';
import type { StopsPreview } from '../api/types';
import { useT } from '../i18n';
import { notify } from '../lib/dialogs';
import { stopRulesText } from '../lib/fare';
import { formatMoney, placeLine } from '../lib/format';
import { lockedStopCount, priceChangeText } from '../lib/stops';
import { MAX_STOPS, removeEditStop, startStopEdit, useStopEdit } from '../trip/stop-edit';
import { Banner, Button, Card, Icon, IconButton, T } from '../ui/primitives';
import { ErrorView, LoadingView } from '../ui/states';
import { colors, radius, space } from '../ui/theme';

/**
 * The intermediate stops of a ride that is on: add, replace or remove them (at most two;
 * a stop the car already reached stays), see the new price (the server prices the new road
 * by the ride's own tariff, the discount follows) and confirm it. The driver is told at once.
 */
export default function RideStopsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const query = useRide(id, false);
  const ride = query.data;
  const edit = useStopEdit();
  const [preview, setPreview] = useState<StopsPreview | null>(null);
  const [pricing, setPricing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // start from the ride's stops once it is loaded (a second visit starts over too)
  useEffect(() => {
    if (ride && edit.rideId !== ride.id) startStopEdit(ride.id, ride.stops);
  }, [ride, edit.rideId]);

  // any change of the list voids the price shown
  const stopsKey = edit.stops.map((s) => `${s.lat},${s.lng}`).join(';');
  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [stopsKey]);

  if (!ride || edit.rideId !== ride.id) {
    return (
      <View style={styles.root}>
        <Stack.Screen options={{ title: t('ride.stops.title') }} />
        {query.isError ? (
          <ErrorView error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <LoadingView />
        )}
      </View>
    );
  }

  const locked = lockedStopCount(ride.stops);
  const original = (ride.stops ?? []).map((s) => `${s.lat},${s.lng}`).join(';');
  const unchanged = stopsKey === original;
  const mapPin = t('ride.stops.mapPin');

  const seePrice = async () => {
    setPricing(true);
    setError(null);
    try {
      setPreview(await endpoints.previewStops(ride.id, edit.stops));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPricing(false);
    }
  };

  const confirmChange = async () => {
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await endpoints.changeStops(ride.id, edit.stops, preview.fare.after);
      queryClient.setQueryData(keys.ride(ride.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.currentRide });
      notify(
        t('ride.stops.changed'),
        t('ride.stops.changedBody', {
          price: formatMoney(updated.fare.pays ?? preview.pays.after),
        }),
      );
      router.back();
    } catch (e) {
      // the price moved between the preview and now: the rider looks again
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { reason?: string } | null;
        if (body?.reason === 'price_changed') {
          setPreview(null);
          setError(t('ride.stops.priceMoved'));
          return;
        }
      }
      setError(describeError(e));
      void queryClient.invalidateQueries({ queryKey: keys.ride(ride.id) });
    } finally {
      setSaving(false);
    }
  };

  const openSearch = (index: number) =>
    router.push({
      pathname: '/search',
      params: { field: 'stop', index: String(index), ride: ride.id },
    });

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: t('ride.stops.title') }} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(4) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Card style={styles.route}>
          <Point
            color={colors.brand}
            label={t('ride.summary.from')}
            text={placeLine(ride.pickup)}
          />
          {edit.stops.map((stop, i) => {
            const fixed = i < locked;
            return (
              <View key={`${i}-${stop.lat}-${stop.lng}`}>
                <View style={styles.line} />
                <View style={styles.stopRow}>
                  <View style={styles.flex}>
                    <Point
                      color={fixed ? colors.textMuted : colors.info}
                      label={t('ride.stops.stopN', { n: i + 1 })}
                      text={stop.address ?? mapPin}
                      note={fixed ? t('ride.stops.locked') : null}
                      onPress={fixed ? undefined : () => openSearch(i)}
                    />
                  </View>
                  {fixed ? null : (
                    <IconButton
                      name="close-circle"
                      label={t('ride.stops.remove', { n: i + 1 })}
                      size={44}
                      color={colors.textMuted}
                      background="transparent"
                      onPress={() => removeEditStop(i)}
                    />
                  )}
                </View>
              </View>
            );
          })}
          <View style={styles.line} />
          <Point color={colors.ink} label={t('ride.summary.to')} text={placeLine(ride.dropoff)} />
          {edit.stops.length < MAX_STOPS ? (
            <View style={styles.addStop}>
              <Button
                title={t('ride.stops.add')}
                size="sm"
                variant="ghost"
                icon="add-circle-outline"
                onPress={() => openSearch(edit.stops.length)}
              />
            </View>
          ) : null}
        </Card>

        <T variant="small" color={colors.textMuted}>
          {t('ride.stops.hint', { max: MAX_STOPS })}
        </T>

        {preview ? (
          <Card style={styles.price}>
            <T variant="caption" color={colors.textMuted}>
              {t('ride.stops.newPrice').toUpperCase()}
            </T>
            <T variant="h2">{formatMoney(preview.pays.after)}</T>
            <T variant="small" color={colors.textMuted}>
              {priceChangeText(preview.pays.before, preview.pays.after)}
            </T>
            {preview.discount && preview.discount.after !== preview.discount.before ? (
              <T variant="small" color={colors.success}>
                {t('ride.stops.discountLine', {
                  after: formatMoney(preview.discount.after),
                  before: formatMoney(preview.discount.before),
                })}
              </T>
            ) : null}
            {preview.discount?.note ? (
              <Banner
                tone="warning"
                message={t('ride.stops.discountLost', { note: preview.discount.note })}
              />
            ) : null}
            {preview.deposit > 0 ? (
              <T variant="small" color={colors.textMuted}>
                {t('ride.stops.depositLine', { deposit: formatMoney(preview.deposit) })}
              </T>
            ) : null}
            {preview.waiting > 0 ? (
              <T variant="small" color={colors.textMuted}>
                {t('ride.stops.waitingLine', { amount: formatMoney(preview.waiting) })}
              </T>
            ) : null}
            {stopRulesText(preview.stopRules) && preview.stops > 0 ? (
              <T variant="small" color={colors.textMuted}>
                {stopRulesText(preview.stopRules)}
              </T>
            ) : null}
          </Card>
        ) : null}

        {error ? <Banner tone="danger" message={error} /> : null}

        {preview ? (
          <Button
            title={t('ride.stops.confirm', { price: formatMoney(preview.pays.after) })}
            icon="checkmark"
            loading={saving}
            disabled={saving}
            onPress={() => void confirmChange()}
          />
        ) : (
          <Button
            title={pricing ? t('ride.stops.pricing') : t('ride.stops.seePrice')}
            icon="calculator-outline"
            loading={pricing}
            disabled={pricing || unchanged}
            onPress={() => void seePrice()}
          />
        )}
        {unchanged && !preview ? (
          <T variant="small" color={colors.textMuted} align="center">
            {t('ride.stops.unchanged')}
          </T>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Point({
  color,
  label,
  text,
  note,
  onPress,
}: {
  color: string;
  label: string;
  text: string;
  note?: string | null;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.point}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <View style={styles.flex}>
        <T variant="caption" color={colors.textMuted}>
          {label.toUpperCase()}
        </T>
        <T variant="bodyStrong" numberOfLines={2}>
          {text}
        </T>
        {note ? (
          <T variant="caption" color={colors.textMuted}>
            {note}
          </T>
        ) : null}
      </View>
      {onPress ? <Icon name="create-outline" size={18} color={colors.textMuted} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${text}`}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : null)}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1, minWidth: 0 },
  content: { padding: space(4), gap: space(3) },
  route: { gap: 0, paddingVertical: space(2) },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    paddingVertical: space(2),
    minHeight: 52,
  },
  pressed: { opacity: 0.6 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  line: { width: 2, height: 14, backgroundColor: colors.border, marginLeft: 5 },
  addStop: { alignItems: 'flex-start', marginLeft: space(4) },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.ink },
  price: { gap: space(1.5), borderRadius: radius.lg },
});
