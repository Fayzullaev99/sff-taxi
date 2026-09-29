import type { DriverMe } from '../api/types';
import { preferencesError } from '../lib/pool';
import { Banner, Card, Muted, Row, Title, ToggleRow } from '../ui/components';
import { usePreferences } from './preferences';

const GENDER_LABEL = { female: 'Ayol', male: 'Erkak' } as const;

/**
 * The gender the driver declared and whether an operator verified it against the passport;
 * a verified woman driver may take women riders only (Uber's "Women Preferences").
 * Nothing is shown on an API without these fields.
 */
export function WomenRidersCard(props: { me: DriverMe }) {
  const prefs = usePreferences();
  const { me } = props;
  if (me.gender === undefined && me.womenRidersOnly === undefined) return null;
  const verifiedWoman = me.gender === 'female' && me.genderVerified === true;
  return (
    <Card>
      <Title>Yo‘lovchilar</Title>
      <Row
        label="Jinsi"
        value={
          me.gender
            ? `${GENDER_LABEL[me.gender]} · ${me.genderVerified ? 'tasdiqlangan' : 'tekshirilmoqda'}`
            : 'Ko‘rsatilmagan'
        }
      />
      {verifiedWoman ? (
        <ToggleRow
          label="Faqat ayol yo‘lovchilar"
          description="Faqat ayol yo‘lovchilarning buyurtmalari keladi."
          value={me.womenRidersOnly === true}
          disabled={prefs.isPending}
          onChange={(v) => prefs.mutate({ womenRidersOnly: v })}
        />
      ) : (
        <Muted>
          {me.gender === 'female'
            ? 'Operator jinsingizni pasport bo‘yicha tasdiqlagach, “Faqat ayol yo‘lovchilar” ni yoqish mumkin.'
            : 'Jinsni o‘zgartirish uchun operatorga murojaat qiling (pasport bo‘yicha tasdiqlanadi).'}
        </Muted>
      )}
      {prefs.error ? (
        <Banner tone="danger" icon="alert-circle" text={preferencesError(prefs.error)} />
      ) : null}
    </Card>
  );
}
