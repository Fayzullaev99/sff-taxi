import type { DriverMe } from '../api/types';
import { useT } from '../i18n';
import { preferencesError } from '../lib/pool';
import { Banner, Card, Muted, Row, Title, ToggleRow } from '../ui/components';
import { usePreferences } from './preferences';

/**
 * The gender the driver declared and whether an operator verified it against the passport;
 * a verified woman driver may take women riders only (Uber's "Women Preferences").
 * Nothing is shown on an API without these fields.
 */
export function WomenRidersCard(props: { me: DriverMe }) {
  const { t } = useT();
  const prefs = usePreferences();
  const { me } = props;
  if (me.gender === undefined && me.womenRidersOnly === undefined) return null;
  const verifiedWoman = me.gender === 'female' && me.genderVerified === true;
  return (
    <Card>
      <Title>{t('home.women.title')}</Title>
      <Row
        label={t('home.women.gender')}
        value={
          me.gender
            ? t('home.women.genderValue', {
                gender: t(me.gender === 'female' ? 'home.women.female' : 'home.women.male'),
                state: t(me.genderVerified ? 'home.women.verified' : 'home.women.pending'),
              })
            : t('home.women.notSet')
        }
      />
      {verifiedWoman ? (
        <ToggleRow
          label={t('home.women.onlyWomen')}
          description={t('home.women.onlyWomenHint')}
          value={me.womenRidersOnly === true}
          disabled={prefs.isPending}
          onChange={(v) => prefs.mutate({ womenRidersOnly: v })}
        />
      ) : (
        <Muted>
          {me.gender === 'female' ? t('home.women.afterVerify') : t('home.women.changeGender')}
        </Muted>
      )}
      {prefs.error ? (
        <Banner tone="danger" icon="alert-circle" text={preferencesError(prefs.error)} />
      ) : null}
    </Card>
  );
}
