import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import { useSession } from '../auth/session';
import { keys, useDriverMe } from '../data/queries';
import { useT } from '../i18n';
import { ApiError, errorMessage } from '../lib/api-client';
import {
  type ApplicationForm,
  EMPTY_FORM,
  FEATURE_LABELS,
  firstStepWithError,
  type FormErrors,
  formFromProfile,
  LICENCE_CATEGORIES,
  POPULAR_CARS,
  RULES,
  CARGO_BODIES,
  CARGO_BODY_LABELS,
  CARGO_CARS,
  cargoClassText,
  classFitText,
  STEP_FIELDS,
  tashkentToday,
  toApplicationBody,
  validateApplication,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
  VEHICLE_FEATURES,
  type VehicleFeature,
} from '../lib/application';
import { plateHint } from '../lib/plate';
import { Banner, Button, Choice, Field, Muted, SectionTitle, ToggleRow } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, radius, space } from '../ui/theme';
import { dateInput } from '../lib/format';

const STEPS = ['personal', 'licence', 'vehicle'] as const;

/** API issue paths ("vehicle.year") → form fields. */
function fieldOfPath(path: string): keyof ApplicationForm | null {
  const map: Record<string, keyof ApplicationForm> = {
    'vehicle.make': 'make',
    'vehicle.model': 'model',
    'vehicle.colour': 'colour',
    'vehicle.plate': 'plate',
    'vehicle.year': 'year',
    'vehicle.seats': 'seats',
    'vehicle.class': 'vehicleClass',
    'vehicle.features': 'features',
    'vehicle.service': 'service',
    'vehicle.body': 'body',
    'vehicle.payloadKg': 'payloadKg',
    'vehicle.grossKg': 'grossKg',
  };
  if (map[path]) return map[path]!;
  return path in EMPTY_FORM ? (path as keyof ApplicationForm) : null;
}

function apiErrors(error: unknown): FormErrors {
  if (!(error instanceof ApiError)) return {};
  const issues = (error.body as { issues?: { path?: unknown; message?: unknown }[] } | null)
    ?.issues;
  const out: FormErrors = {};
  for (const i of issues ?? []) {
    const path = Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? '');
    const field = fieldOfPath(path);
    if (field && typeof i.message === 'string' && !out[field]) out[field] = i.message;
  }
  return out;
}

/**
 * The application wizard (Resolution 200): who you are, your licences, your car. Checked
 * on every step with the API's own rules, so a mistake is explained where it was made.
 * Also corrects a pending or rejected application (it goes back to the queue).
 */
export default function Apply() {
  const { t } = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const session = useSession();
  const me = useDriverMe();
  const initial = useMemo(() => (me.data ? formFromProfile(me.data) : EMPTY_FORM), [me.data]);
  const [form, setForm] = useState<ApplicationForm>(initial);
  const [step, setStep] = useState(0);
  const [shown, setShown] = useState<FormErrors>({});

  const set = <K extends keyof ApplicationForm>(key: K, value: ApplicationForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setShown((e) => ({ ...e, [key]: undefined }));
  };
  const cargo = form.service === 'cargo';

  const submit = useMutation({
    mutationFn: () => driver.apply(toApplicationBody(form)),
    onSuccess: (next) => {
      haptics.success();
      qc.setQueryData(keys.me, next);
      router.replace(next.missingDocuments.length ? '/documents' : '/status');
    },
    onError: (error) => {
      haptics.error();
      const e = apiErrors(error);
      if (Object.keys(e).length) {
        setShown(e);
        const s = firstStepWithError(e);
        if (s >= 0) setStep(s);
      }
    },
  });

  const next = () => {
    const all = validateApplication(form, tashkentToday());
    const here: FormErrors = {};
    for (const f of STEP_FIELDS[step]!) if (all[f]) here[f] = all[f];
    setShown(here);
    if (Object.keys(here).length) {
      haptics.error();
      return;
    }
    if (step < STEPS.length - 1) setStep(step + 1);
    else submit.mutate();
  };

  const toggleCategory = (c: string) =>
    set(
      'licenceCategories',
      form.licenceCategories.includes(c)
        ? form.licenceCategories.filter((x) => x !== c)
        : [...form.licenceCategories, c],
    );
  const toggleFeature = (f: VehicleFeature) =>
    set(
      'features',
      form.features.includes(f) ? form.features.filter((x) => x !== f) : [...form.features, f],
    );

  return (
    <Screen
      keyboard
      title={me.data ? t('apply.form.editTitle') : t('apply.form.newTitle')}
      onBack={step > 0 ? () => setStep(step - 1) : me.data ? () => router.back() : undefined}
      footer={
        <>
          {submit.error && !Object.keys(apiErrors(submit.error)).length ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(submit.error)} />
          ) : null}
          <Button
            title={step < STEPS.length - 1 ? t('common.actions.next') : t('apply.form.submit')}
            icon={step < STEPS.length - 1 ? 'arrow-forward' : 'send'}
            big
            loading={submit.isPending}
            onPress={next}
          />
        </>
      }
    >
      <View style={styles.progress}>
        {STEPS.map((s, i) => (
          <View key={s} style={[styles.bar, i <= step && { backgroundColor: colors.brand }]} />
        ))}
      </View>
      <Text style={styles.stepTitle}>
        {t('apply.form.stepOf', {
          step: step + 1,
          total: STEPS.length,
          title: t(`apply.form.steps.${STEPS[step]!}`),
        })}
      </Text>

      {step === 0 ? (
        <>
          <Muted>{t('apply.form.resolution200')}</Muted>
          <Field
            label={t('apply.form.fullName')}
            value={form.fullName}
            onChangeText={(v) => set('fullName', v)}
            autoCapitalize="words"
            placeholder={t('apply.form.fullNamePlaceholder')}
            error={shown.fullName}
          />
          <Field
            label={t('apply.form.birthDate')}
            value={form.birthDate}
            onChangeText={(v) => set('birthDate', dateInput(v))}
            keyboardType="number-pad"
            placeholder={t('apply.form.datePlaceholder')}
            maxLength={10}
            error={shown.birthDate}
          />
          <Field
            label={t('apply.form.pinfl')}
            value={form.pinfl}
            onChangeText={(v) => set('pinfl', v.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder={t('apply.form.pinflPlaceholder')}
            maxLength={14}
            hint={t('apply.form.pinflHint')}
            error={shown.pinfl}
          />
          <View style={{ gap: space.xs }}>
            <Text style={styles.label}>{t('apply.form.gender')}</Text>
            <Choice
              options={[
                { value: 'female', label: t('apply.form.female') },
                { value: 'male', label: t('apply.form.male') },
              ]}
              selected={form.gender ? [form.gender] : []}
              onToggle={(v) => set('gender', form.gender === v ? null : v)}
            />
            <Muted>{t('apply.form.genderHint')}</Muted>
          </View>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Field
            label={t('apply.form.licenceNumber')}
            value={form.licenceNumber}
            onChangeText={(v) => set('licenceNumber', v)}
            autoCapitalize="characters"
            placeholder="AF1234567"
            maxLength={12}
            error={shown.licenceNumber}
          />
          <View style={{ gap: space.xs }}>
            <Text style={styles.label}>{t('apply.form.categories')}</Text>
            <Choice
              options={LICENCE_CATEGORIES.map((c) => ({ value: c, label: c }))}
              selected={form.licenceCategories}
              onToggle={toggleCategory}
            />
            {shown.licenceCategories ? (
              <Text style={styles.error}>{shown.licenceCategories}</Text>
            ) : null}
          </View>
          <Field
            label={t('apply.form.licenceIssuedOn')}
            value={form.licenceIssuedOn}
            onChangeText={(v) => set('licenceIssuedOn', dateInput(v))}
            keyboardType="number-pad"
            placeholder={t('apply.form.datePlaceholder')}
            maxLength={10}
            error={shown.licenceIssuedOn}
          />
          <Field
            label={t('apply.form.licenceCardNumber')}
            value={form.licenceCardNumber}
            onChangeText={(v) => set('licenceCardNumber', v)}
            autoCapitalize="characters"
            hint={t('apply.form.licenceCardHint')}
            error={shown.licenceCardNumber}
          />
          <Field
            label={t('apply.form.licenceCardExpiresOn')}
            value={form.licenceCardExpiresOn}
            onChangeText={(v) => set('licenceCardExpiresOn', dateInput(v))}
            keyboardType="number-pad"
            placeholder={t('apply.form.datePlaceholder')}
            maxLength={10}
            error={shown.licenceCardExpiresOn}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SectionTitle>{t('apply.vehicle.whatDoYouCarry')}</SectionTitle>
          <Choice
            options={[
              { value: 'taxi' as const, label: t('apply.vehicle.taxi') },
              { value: 'cargo' as const, label: t('apply.vehicle.cargo') },
            ]}
            selected={[form.service]}
            onToggle={(v) => {
              set('service', v);
              // a cargo cab has 1-2 seats besides the driver, a taxi 4
              if (v === 'cargo' && Number(form.seats) > RULES.maxCargoCabSeats) set('seats', '1');
              if (v === 'taxi' && form.service === 'cargo') set('seats', '4');
            }}
          />
          {cargo ? <Banner tone="info" icon="cube" text={t('apply.vehicle.cargoInfo')} /> : null}
          <SectionTitle>{t('apply.vehicle.quickPick')}</SectionTitle>
          {cargo ? (
            <Choice
              options={CARGO_CARS.map((c) => ({ value: c.model, label: c.model }))}
              selected={[form.model]}
              onToggle={(v) => {
                const c = CARGO_CARS.find((x) => x.model === v)!;
                set('make', c.make);
                set('model', c.model);
                set('body', c.body);
                set('payloadKg', String(c.payloadKg));
                set('grossKg', String(c.grossKg));
                set('seats', String(c.seats));
              }}
            />
          ) : (
            <Choice
              options={POPULAR_CARS.map((c) => ({ value: `${c.make}|${c.model}`, label: c.model }))}
              selected={[`${form.make}|${form.model}`]}
              onToggle={(v) => {
                const [make, model] = v.split('|');
                set('make', make!);
                set('model', model!);
              }}
            />
          )}
          <Field
            label={t('apply.vehicle.make')}
            value={form.make}
            onChangeText={(v) => set('make', v)}
            placeholder="Chevrolet"
            error={shown.make}
          />
          <Field
            label={t('apply.vehicle.model')}
            value={form.model}
            onChangeText={(v) => set('model', v)}
            placeholder="Cobalt"
            error={shown.model}
          />
          <Field
            label={t('apply.vehicle.colour')}
            value={form.colour}
            onChangeText={(v) => set('colour', v)}
            placeholder={t('apply.vehicle.colourPlaceholder')}
            error={shown.colour}
          />
          <Field
            label={t('apply.vehicle.plate')}
            value={form.plate}
            onChangeText={(v) => set('plate', v.toUpperCase())}
            autoCapitalize="characters"
            placeholder="20 A 123 BC"
            maxLength={14}
            hint={plateHint()}
            error={shown.plate}
            style={styles.plate}
          />
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Field
                label={t('apply.vehicle.year')}
                value={form.year}
                onChangeText={(v) => set('year', v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                placeholder="2019"
                maxLength={4}
                error={shown.year}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={cargo ? t('apply.vehicle.cabSeats') : t('apply.vehicle.seats')}
                value={form.seats}
                onChangeText={(v) => set('seats', v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={1}
                error={shown.seats}
              />
            </View>
          </View>
          {cargo ? (
            <>
              <View style={{ gap: space.xs }}>
                <Text style={styles.label}>{t('apply.vehicle.bodyType')}</Text>
                <Choice
                  options={CARGO_BODIES.map((b) => ({ value: b, label: CARGO_BODY_LABELS[b] }))}
                  selected={form.body ? [form.body] : []}
                  onToggle={(v) => set('body', v)}
                />
                {shown.body ? <Text style={styles.error}>{shown.body}</Text> : null}
              </View>
              <View style={styles.pair}>
                <View style={{ flex: 1 }}>
                  <Field
                    label={t('apply.vehicle.payloadKg')}
                    value={form.payloadKg}
                    onChangeText={(v) => set('payloadKg', v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    placeholder="550"
                    maxLength={5}
                    error={shown.payloadKg}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label={t('apply.vehicle.grossKg')}
                    value={form.grossKg}
                    onChangeText={(v) => set('grossKg', v.replace(/\D/g, ''))}
                    keyboardType="number-pad"
                    placeholder="1400"
                    maxLength={5}
                    hint={t('apply.vehicle.grossHint')}
                    error={shown.grossKg}
                  />
                </View>
              </View>
              {/^\d+$/.test(form.payloadKg) && Number(form.payloadKg) > 0 ? (
                <Muted>
                  {t('apply.vehicle.youWillGet', {
                    orders: cargoClassText(Number(form.payloadKg)),
                  })}
                </Muted>
              ) : null}
            </>
          ) : null}
          {cargo ? null : (
            <>
              <View style={{ gap: space.xs }}>
                <Text style={styles.label}>{t('apply.vehicle.classLabel')}</Text>
                <Choice
                  options={VEHICLE_CLASSES.map((c) => ({
                    value: c,
                    label: VEHICLE_CLASS_LABELS[c],
                  }))}
                  selected={[form.vehicleClass]}
                  onToggle={(v) => {
                    set('vehicleClass', v);
                    // a minivan has 6-7 seats; back from a minivan, a sedan's 4
                    if (v === 'minivan' && Number(form.seats) < RULES.minMinivanSeats) {
                      set('seats', String(RULES.minMinivanSeats));
                    } else if (v !== 'minivan' && Number(form.seats) > RULES.maxSeats) {
                      set('seats', String(RULES.maxSeats));
                    }
                  }}
                />
                <Muted>{classFitText(form)}</Muted>
                {shown.vehicleClass ? <Text style={styles.error}>{shown.vehicleClass}</Text> : null}
              </View>
              <ToggleRow
                label={t('apply.vehicle.cng')}
                description={t('apply.vehicle.cngDescription')}
                value={form.cng}
                onChange={(v) => set('cng', v)}
              />
              <View style={{ gap: space.xs }}>
                <Text style={styles.label}>{t('apply.vehicle.features')}</Text>
                <Choice
                  options={VEHICLE_FEATURES.map((f) => ({ value: f, label: FEATURE_LABELS[f] }))}
                  selected={form.features}
                  onToggle={toggleFeature}
                />
                {shown.features ? <Text style={styles.error}>{shown.features}</Text> : null}
              </View>
            </>
          )}
          <Muted>{t('apply.vehicle.documentsNext')}</Muted>
        </>
      ) : null}

      {!me.data ? (
        <Button
          title={t('apply.form.signInWithOtherNumber')}
          variant="ghost"
          onPress={() => void session.signOut()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: space.xs },
  bar: { flex: 1, height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  stepTitle: { fontSize: 20, fontWeight: '800', color: colors.text },
  label: { fontSize: 15, fontWeight: '700', color: colors.text },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600' },
  pair: { flexDirection: 'row', gap: space.md },
  plate: { fontSize: 24, fontWeight: '800', letterSpacing: 2 },
});
