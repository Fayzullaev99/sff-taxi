import type { DriverMe } from '../api/types';
import { useT } from '../i18n';
import { classesText } from '../lib/classes';
import { preferencesError } from '../lib/pool';
import { Banner, Card, Muted, Row, Title, ToggleRow } from '../ui/components';
import { usePreferences } from './preferences';

/**
 * The car's taxi class and which rides come: a higher class's driver may take lower classes
 * too (a comfort car economy rides, on by default; business and minivan opt in), like
 * Yandex's tariffs. The class itself is changed by an operator after an inspection.
 * Nothing is shown on an API without classes.
 */
export function ClassesCard(props: { me: DriverMe }) {
  const { t } = useT();
  const prefs = usePreferences();
  const c = props.me.classes;
  if (!c) return null;
  const text = classesText(c);
  return (
    <Card>
      <Title>{t('home.classes.title')}</Title>
      <Row label={t('home.classes.own')} value={text.own} />
      <Row label={t('home.classes.rides')} value={text.rides} />
      {c.lower.length ? (
        <ToggleRow
          label={text.toggle}
          description={text.toggleHint}
          value={c.takesLower}
          disabled={prefs.isPending}
          onChange={(v) => prefs.mutate({ takesLowerClasses: v })}
        />
      ) : null}
      <Muted>{text.qualifies}</Muted>
      {prefs.error ? (
        <Banner tone="danger" icon="alert-circle" text={preferencesError(prefs.error)} />
      ) : null}
    </Card>
  );
}
