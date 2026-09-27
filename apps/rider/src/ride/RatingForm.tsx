import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ApiError, describeError } from '../api/client';
import { endpoints } from '../api/endpoints';
import { keys } from '../api/queries';
import type { Ride } from '../api/types';
import { Banner, Button, Chip, T, TextField } from '../ui/primitives';
import { StarInput } from '../ui/Rating';
import { space } from '../ui/theme';

/** Tags the API stores with the stars (free text, ≤ 30 characters, ≤ 5 per rating). */
const GOOD_TAGS = [
  'Toza mashina',
  'Xushmuomala',
  'Ehtiyotkor haydadi',
  'Tez yetib keldi',
  'Yo‘lni yaxshi biladi',
];
const BAD_TAGS = [
  'Kechikdi',
  'Qo‘pol muomala',
  'Xavfli haydadi',
  'Mashina iflos',
  'Ortiqcha pul so‘radi',
];

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
        title="Rahmat!"
        message="Bahoyingiz haydovchilar sifatini yaxshilashga yordam beradi."
      />
    );
  }

  const options = stars !== null && stars <= 3 ? BAD_TAGS : GOOD_TAGS;

  const submit = async () => {
    if (stars === null) return;
    setBusy(true);
    setError(null);
    try {
      await endpoints.rate(rideId, {
        stars,
        tags: tags.filter((t) => options.includes(t)),
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
        {driverName ? `${driverName} bilan safar qanday o‘tdi?` : 'Safar qanday o‘tdi?'}
      </T>
      <StarInput
        value={stars}
        label="Haydovchini baholang"
        onChange={(v) => {
          // switching between good and bad tags drops the other kind
          if ((stars ?? 5) > 3 !== v > 3) setTags([]);
          setStars(v);
        }}
      />
      {stars !== null ? (
        <>
          <View style={styles.tags}>
            {options.map((t) => (
              <Chip
                key={t}
                label={t}
                selected={tags.includes(t)}
                onPress={() =>
                  setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])
                }
              />
            ))}
          </View>
          <TextField
            placeholder="Izoh (ixtiyoriy)"
            value={comment}
            onChangeText={setComment}
            maxLength={500}
            multiline
            accessibilityLabel="Izoh"
          />
          {error ? <Banner tone="danger" message={error} /> : null}
          <Button title="Baholash" size="lg" loading={busy} onPress={() => void submit()} />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space(3) },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), justifyContent: 'center' },
});
