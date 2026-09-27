import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { driver } from '../api/driver';
import { useSession } from '../auth/session';
import { keys, useDriverMe } from '../data/queries';
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
  STEP_FIELDS,
  tashkentToday,
  toApplicationBody,
  validateApplication,
  VEHICLE_FEATURES,
  type VehicleFeature,
} from '../lib/application';
import { PLATE_HINT } from '../lib/plate';
import { Banner, Button, Choice, Field, Muted, SectionTitle, ToggleRow } from '../ui/components';
import { haptics } from '../ui/haptics';
import { Screen } from '../ui/screen';
import { colors, radius, space } from '../ui/theme';

const STEPS = ['Shaxsiy ma’lumotlar', 'Guvohnoma va litsenziya', 'Avtomobil'];

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
      title={me.data ? 'Arizani tahrirlash' : 'Haydovchi bo‘lish'}
      onBack={step > 0 ? () => setStep(step - 1) : me.data ? () => router.back() : undefined}
      footer={
        <>
          {submit.error && !Object.keys(apiErrors(submit.error)).length ? (
            <Banner tone="danger" icon="alert-circle" text={errorMessage(submit.error)} />
          ) : null}
          <Button
            title={step < STEPS.length - 1 ? 'Davom etish' : 'Arizani yuborish'}
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
        {step + 1}/{STEPS.length}. {STEPS[step]}
      </Text>

      {step === 0 ? (
        <>
          <Muted>
            Vazirlar Mahkamasining 200-son qaroriga ko‘ra: kamida 21 yosh, B toifa, 3 yillik staj va
            yo‘lovchi tashish litsenziya kartochkasi talab qilinadi.
          </Muted>
          <Field
            label="Familiya, ism, otasining ismi"
            value={form.fullName}
            onChangeText={(v) => set('fullName', v)}
            autoCapitalize="words"
            placeholder="Aliyev Vali Karimovich"
            error={shown.fullName}
          />
          <Field
            label="Tug‘ilgan sana"
            value={form.birthDate}
            onChangeText={(v) => set('birthDate', v)}
            keyboardType="numbers-and-punctuation"
            placeholder="KK.OO.YYYY"
            maxLength={10}
            error={shown.birthDate}
          />
          <Field
            label="JShShIR (PINFL)"
            value={form.pinfl}
            onChangeText={(v) => set('pinfl', v.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder="14 ta raqam"
            maxLength={14}
            hint="Pasport yoki ID kartada. 1% soliq shu raqam bo‘yicha to‘lanadi."
            error={shown.pinfl}
          />
        </>
      ) : null}

      {step === 1 ? (
        <>
          <Field
            label="Haydovchilik guvohnomasi raqami"
            value={form.licenceNumber}
            onChangeText={(v) => set('licenceNumber', v)}
            autoCapitalize="characters"
            placeholder="AF1234567"
            maxLength={12}
            error={shown.licenceNumber}
          />
          <View style={{ gap: space.xs }}>
            <Text style={styles.label}>Toifalar</Text>
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
            label="Guvohnoma berilgan sana (staj)"
            value={form.licenceIssuedOn}
            onChangeText={(v) => set('licenceIssuedOn', v)}
            keyboardType="numbers-and-punctuation"
            placeholder="KK.OO.YYYY"
            maxLength={10}
            error={shown.licenceIssuedOn}
          />
          <Field
            label="Litsenziya kartochkasi raqami"
            value={form.licenceCardNumber}
            onChangeText={(v) => set('licenceCardNumber', v)}
            autoCapitalize="characters"
            hint="Yo‘lovchi tashish uchun litsenziya kartochkasi (my.gov.uz orqali olinadi)"
            error={shown.licenceCardNumber}
          />
          <Field
            label="Kartochka amal qilish muddati"
            value={form.licenceCardExpiresOn}
            onChangeText={(v) => set('licenceCardExpiresOn', v)}
            keyboardType="numbers-and-punctuation"
            placeholder="KK.OO.YYYY"
            maxLength={10}
            error={shown.licenceCardExpiresOn}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <SectionTitle>Tez tanlash</SectionTitle>
          <Choice
            options={POPULAR_CARS.map((c) => ({ value: `${c.make}|${c.model}`, label: c.model }))}
            selected={[`${form.make}|${form.model}`]}
            onToggle={(v) => {
              const [make, model] = v.split('|');
              set('make', make!);
              set('model', model!);
            }}
          />
          <Field
            label="Marka"
            value={form.make}
            onChangeText={(v) => set('make', v)}
            placeholder="Chevrolet"
            error={shown.make}
          />
          <Field
            label="Model"
            value={form.model}
            onChangeText={(v) => set('model', v)}
            placeholder="Cobalt"
            error={shown.model}
          />
          <Field
            label="Rangi"
            value={form.colour}
            onChangeText={(v) => set('colour', v)}
            placeholder="Oq"
            error={shown.colour}
          />
          <Field
            label="Davlat raqami"
            value={form.plate}
            onChangeText={(v) => set('plate', v.toUpperCase())}
            autoCapitalize="characters"
            placeholder="20 A 123 BC"
            maxLength={14}
            hint={PLATE_HINT}
            error={shown.plate}
            style={styles.plate}
          />
          <View style={styles.pair}>
            <View style={{ flex: 1 }}>
              <Field
                label="Yili"
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
                label="Yo‘lovchi o‘rni"
                value={form.seats}
                onChangeText={(v) => set('seats', v.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={1}
                error={shown.seats}
              />
            </View>
          </View>
          <View style={{ gap: space.xs }}>
            <Text style={styles.label}>Sinf</Text>
            <Choice
              options={[
                { value: 'economy' as const, label: 'Ekonom' },
                { value: 'comfort' as const, label: 'Komfort (≤5 yil, konditsioner)' },
              ]}
              selected={[form.vehicleClass]}
              onToggle={(v) => set('vehicleClass', v)}
            />
            {shown.vehicleClass ? <Text style={styles.error}>{shown.vehicleClass}</Text> : null}
          </View>
          <ToggleRow
            label="Metan (gaz) ballon yukxonada"
            description="Ko‘p Cobalt va Nexialarda shunday: yukxona katta bo‘lsa ham katta yukli buyurtmalar sizga berilmaydi"
            value={form.cng}
            onChange={(v) => set('cng', v)}
          />
          <View style={{ gap: space.xs }}>
            <Text style={styles.label}>Qulayliklar</Text>
            <Choice
              options={VEHICLE_FEATURES.map((f) => ({ value: f, label: FEATURE_LABELS[f] }))}
              selected={form.features}
              onToggle={toggleFeature}
            />
            {shown.features ? <Text style={styles.error}>{shown.features}</Text> : null}
          </View>
          <Muted>
            Keyingi qadamda hujjatlar rasmlarini yuklaysiz: litsenziya kartochkasi, guvohnoma,
            pasport, texpasport, sug‘urta, avtomobil rasmi va selfi.
          </Muted>
        </>
      ) : null}

      {!me.data ? (
        <Button
          title="Boshqa raqam bilan kirish"
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
