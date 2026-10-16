import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import type { Ride } from '../api/types';
import { useT } from '../i18n';
import { Banner, Button, Chip, T, TextField } from '../ui/primitives';
import { StarInput } from '../ui/Rating';
import { space } from '../ui/theme';

/** Tags the API stores with the stars (free text, ≤ 30 characters, ≤ 5 per rating). */
const GOOD_TAG_KEYS = [
  'ride.rating.good.cleanCar',
  'ride.rating.good.polite',
  'ride.rating.good.carefulDriving',
  'ride.rating.good.fast',
  'ride.rating.good.knowsRoads',
] as const;
const BAD_TAG_KEYS = [
  'ride.rating.bad.late',
  'ride.rating.bad.rude',
  'ride.rating.bad.dangerousDriving',
  'ride.rating.bad.dirtyCar',
  'ride.rating.bad.overcharged',
] as const;

/** The rider rates the driver once (the API's `rated` says whether it was done). */
export function RatingForm({
  rideId,
  driverName,
  rated,
}: {
  rideId: string;
  driverName: string | null;
  rated: boolean;
}) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const markRated = (id: string) =>
    queryClient.setQueryData<Ride>(keys.ride(id), (ride) =>
      ride ? { ...ride, rated: true } : ride,
    );
  const [stars, setStars] = useState<number | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (rated) {
    return (
      <Banner
        tone="success"
        title={t('ride.rating.thanksTitle')}
        message={t('ride.rating.thanksMessage')}
      />
    );
  }

  const options = (stars !== null && stars <= 3 ? BAD_TAG_KEYS : GOOD_TAG_KEYS).map((key) =>
    t(key),
  );

  const submit = async () => {
    if (stars === null) return;
    setBusy(true);
    setError(null);
    try {
      await endpoints.rate(rideId, {
        stars,
        tags: tags.filter((tag) => options.includes(tag)),
        comment: comment.trim() || null,
      });
      markRated(rideId);
    } catch (e) {
      // already rated (from another phone) or too late: nothing more to do here
      if (e instanceof ApiError && (e.status === 409 || e.status === 410)) {
        markRated(rideId);
        return;
      }
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <T variant="h3" align="center" accessibilityRole="header">
        {driverName
          ? t('ride.rating.questionWith', { name: driverName })
          : t('ride.rating.question')}
      </T>
      <StarInput
        value={stars}
        label={t('ride.rating.rateDriver')}
        onChange={(v) => {
          // switching between good and bad tags drops the other kind
          if ((stars ?? 5) > 3 !== v > 3) setTags([]);
          setStars(v);
        }}
      />
      {stars !== null ? (
        <>
          <View style={styles.tags}>
            {options.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                selected={tags.includes(tag)}
                onPress={() =>
                  setTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag])
                }
              />
            ))}
          </View>
          <TextField
            placeholder={t('ride.rating.commentPlaceholder')}
            value={comment}
            onChangeText={setComment}
            maxLength={500}
            multiline
            accessibilityLabel={t('ride.rating.comment')}
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button
            title={t('ride.rating.submit')}
            size="lg"
            loading={busy}
            onPress={() => void submit()}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), justifyContent: 'center' },
});
