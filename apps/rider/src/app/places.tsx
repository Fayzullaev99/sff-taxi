import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeError } from '../api/client';
import { useSavedPlaces } from '../api/queries';
import type { SavedPlace } from '../api/types';
import { useT } from '../i18n';
import { confirm, notify } from '../lib/dialogs';
import { savedLabel, type SaveTarget, savedToPlace } from '../lib/places';
import { removePlace, unhideRecentPlaces, usePlaces } from '../trip/places-store';
import {
  Button,
  Card,
  Divider,
  Icon,
  type IconName,
  IconButton,
  PressableRow,
  T,
} from '../ui/primitives';
import { ErrorView, LoadingView } from '../ui/states';
import { colors, space } from '../ui/theme';

/** The API keeps at most 20 places per rider (home and work included). */
const MAX_PLACES = 20;

/**
 * Saved places, kept in the account (the same on every phone): home, work and up to 18
 * others. Adding goes through the address search (or the map); home and work replace the
 * previous one.
 */
export default function PlacesScreen() {
  const { t } = useT();
  const insets = useSafeAreaInsets();
  const query = useSavedPlaces();
  const places = usePlaces();
  const [removing, setRemoving] = useState<string | null>(null);
  const [unhiding, setUnhiding] = useState(false);

  const unhide = async () => {
    setUnhiding(true);
    const ok = await unhideRecentPlaces();
    setUnhiding(false);
    if (ok) notify(t('common.actions.done'), t('history.places.unhidden'));
  };

  const add = (save: SaveTarget) =>
    router.push({ pathname: '/search', params: { field: 'dropoff', save } });

  const remove = async (place: SavedPlace, name: string) => {
    const ok = await confirm({
      title: t('history.places.removeQuestion'),
      message: name,
      confirmText: t('common.actions.delete'),
      destructive: true,
    });
    if (!ok) return;
    setRemoving(place.id);
    try {
      await removePlace(place.id);
    } catch (e) {
      notify(t('history.places.removeFailed'), describeError(e));
    } finally {
      setRemoving(null);
    }
  };

  if (query.isPending) return <LoadingView />;
  if (query.isError && !query.data) {
    return <ErrorView error={query.error} onRetry={() => void query.refetch()} />;
  }

  const full = places.list.length >= MAX_PLACES;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space(8) }]}
    >
      <Card style={styles.card}>
        {(['home', 'work'] as const).map((kind, i) => {
          const saved = places[kind];
          const line = saved ? savedToPlace(saved).title : t('history.places.tapToAdd');
          return (
            <View key={kind}>
              {i > 0 ? <Divider style={styles.divider} /> : null}
              <PlaceRow
                icon={kind === 'home' ? 'home-outline' : 'briefcase-outline'}
                title={savedLabel(kind)}
                line={line}
                onPress={() => add(kind)}
                onRemove={saved ? () => void remove(saved, savedLabel(kind)) : undefined}
                removing={removing === saved?.id}
              />
            </View>
          );
        })}
      </Card>

      {places.others.length ? (
        <Card style={styles.card}>
          {places.others.map((p, i) => {
            const place = savedToPlace(p);
            return (
              <View key={p.id}>
                {i > 0 ? <Divider style={styles.divider} /> : null}
                <PlaceRow
                  icon="star-outline"
                  title={place.subtitle ?? place.title}
                  line={place.subtitle ? place.title : null}
                  onRemove={() => void remove(p, place.title)}
                  removing={removing === p.id}
                />
              </View>
            );
          })}
        </Card>
      ) : null}

      <Button
        title={t('history.places.addOther')}
        icon="add"
        variant="secondary"
        disabled={full}
        onPress={() => add('other')}
      />
      <T variant="small" color={colors.textMuted}>
        {full
          ? t('history.places.maxReached', { max: MAX_PLACES })
          : t('history.places.syncedNote')}
      </T>
      <Divider style={styles.divider} />
      <T variant="small" color={colors.textMuted}>
        {t('history.places.hideHint')}
      </T>
      <Button
        title={t('history.places.unhide')}
        icon="eye-outline"
        variant="ghost"
        loading={unhiding}
        onPress={() => void unhide()}
      />
    </ScrollView>
  );
}

function PlaceRow({
  icon,
  title,
  line,
  onPress,
  onRemove,
  removing,
}: {
  icon: IconName;
  title: string;
  line: string | null;
  onPress?: () => void;
  onRemove?: () => void;
  removing: boolean;
}) {
  const { t } = useT();
  return (
    <View style={styles.placeRow}>
      <PressableRow
        style={styles.placeMain}
        onPress={onPress}
        disabled={!onPress}
        accessibilityLabel={`${title}${line ? `: ${line}` : ''}${
          onPress ? `. ${t('common.actions.edit')}` : ''
        }`}
      >
        <Icon name={icon} size={20} />
        <View style={styles.flex}>
          <T variant="bodyStrong" numberOfLines={1}>
            {title}
          </T>
          {line ? (
            <T variant="small" color={colors.textMuted} numberOfLines={2}>
              {line}
            </T>
          ) : null}
        </View>
      </PressableRow>
      {onRemove ? (
        <IconButton
          name={removing ? 'hourglass-outline' : 'trash-outline'}
          label={t('history.places.removeA11y', { title })}
          color={colors.danger}
          onPress={removing ? undefined : onRemove}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(4), gap: space(3) },
  card: { gap: space(1) },
  flex: { flex: 1, minWidth: 0 },
  divider: { marginVertical: space(1) },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  placeMain: { flex: 1, gap: space(3), minHeight: 48 },
});
