import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PoolRules } from '../api/types';
import { som } from '../lib/format';
import {
  exampleProblems,
  formToPool,
  FOUNDER_EXAMPLE,
  MAX_PASSENGERS,
  type PoolExampleInput,
  poolExample,
  type PoolForm,
  poolFormProblems,
  poolToForm,
} from '../lib/pool';
import { Button, Field, MoneyInput, NumberInput, Toggle } from '../ui/controls';
import { ErrorBox, useConfirm, useToast } from '../ui/feedback';

type NumKey = Exclude<keyof PoolForm, 'enabled'>;

const FIELDS: { key: NumKey; label: string; hint?: string; suffix: string; decimals?: boolean }[] =
  [
    {
      key: 'discount_percent',
      label: 'Chegirma',
      hint: 'Har bir yo‘lovchiga, safari yetarlicha umumiy bo‘lsa',
      suffix: '%',
    },
    {
      key: 'full_discount_share_percent',
      label: 'To‘liq chegirma uchun umumiy qism',
      hint: 'Yo‘lovchi safarining shuncha qismi birga bo‘lsa, to‘liq chegirma; kamroq — mutanosib',
      suffix: '%',
    },
    {
      key: 'detour_city_min',
      label: 'Qo‘shimcha vaqt chegarasi, shahar',
      hint: 'Mashinadagi (kutayotgan) yo‘lovchi shundan ortiq kechikmaydi',
      suffix: 'daq',
      decimals: true,
    },
    {
      key: 'detour_intercity_min',
      label: 'Qo‘shimcha vaqt chegarasi, shaharlararo',
      suffix: 'daq',
      decimals: true,
    },
    {
      key: 'max_detour_percent',
      label: '… va o‘z yo‘lining ko‘pi bilan',
      hint: 'Qolgan yo‘l vaqtidan (kamida 2 daqiqa ruxsat)',
      suffix: '%',
    },
    {
      key: 'pickup_eta_min',
      label: 'Yangi yo‘lovchiga yetib kelish',
      hint: 'Uzoqroqdagi mashinaga taklif bormaydi',
      suffix: 'daq',
      decimals: true,
    },
    { key: 'search_radius_m', label: 'Qidiruv radiusi', suffix: 'm' },
    {
      key: 'pool_preference_seconds',
      label: 'Yo‘lovchili mashina ustunligi',
      hint: 'Bo‘sh mashinadan shuncha soniya uzoq bo‘lsa ham tanlanadi',
      suffix: 's',
    },
    {
      key: 'max_riders',
      label: 'Bir mashinada buyurtmalar',
      hint: `Ko‘pi bilan ${MAX_PASSENGERS}: 1 old, 2 orqa o‘rindiq`,
      suffix: 'ta',
    },
  ];

type ExampleDraft = Record<keyof PoolExampleInput, number | null>;

/** Two riders' prices and the shared part: each pays and the driver gets, at the draft's rules. */
function PoolCalculator({ form }: { form: PoolForm }) {
  const [x, setX] = useState<ExampleDraft>(FOUNDER_EXAMPLE);
  const problems = exampleProblems(x);
  const rulesOk =
    form.discount_percent !== null &&
    form.full_discount_share_percent !== null &&
    form.full_discount_share_percent > 0;
  const result =
    rulesOk && !Object.keys(problems).length
      ? poolExample(x as PoolExampleInput, {
          discount_percent: form.discount_percent!,
          full_discount_share_percent: form.full_discount_share_percent!,
        })
      : null;
  const money = (key: 'fareA' | 'fareB', label: string) => (
    <Field label={label} error={problems[key]}>
      {(p) => <MoneyInput {...p} value={x[key]} onChange={(v) => setX({ ...x, [key]: v })} />}
    </Field>
  );
  const km = (key: 'tripAKm' | 'tripBKm' | 'sharedKm', label: string) => (
    <Field label={label} error={problems[key]}>
      {(p) => (
        <NumberInput
          {...p}
          decimals
          suffix="km"
          value={x[key]}
          onChange={(v) => setX({ ...x, [key]: v })}
        />
      )}
    </Field>
  );
  return (
    <div className="pool-calc" aria-label="Hamroh narxi kalkulyatori">
      <h3>Misol: ikki yo‘lovchi bir mashinada</h3>
      <div className="grid-2">
        {money('fareA', 'A yo‘lovchi narxi (yolg‘iz)')}
        {km('tripAKm', 'A safari')}
        {money('fareB', 'B yo‘lovchi narxi (yolg‘iz)')}
        {km('tripBKm', 'B safari')}
        {km('sharedKm', 'Birga yurilgan qism')}
      </div>
      {result ? (
        <dl className="facts facts-2" aria-live="polite">
          <div>
            <dt>A to‘laydi</dt>
            <dd>
              <strong>{som(result.a.pays)}</strong>
              {result.a.discount > 0 && (
                <div className="muted small">chegirma {som(result.a.discount)}</div>
              )}
            </dd>
          </div>
          <div>
            <dt>B to‘laydi</dt>
            <dd>
              <strong>{som(result.b.pays)}</strong>
              {result.b.discount > 0 && (
                <div className="muted small">chegirma {som(result.b.discount)}</div>
              )}
            </dd>
          </div>
          <div>
            <dt>Haydovchi oladi</dt>
            <dd>
              <strong>{som(result.driver)}</strong>
              <div className="muted small">
                yolg‘iz safarlardan {som(x.fareA!)} dan {result.driver >= x.fareA! ? 'ko‘p' : 'kam'}
              </div>
            </dd>
          </div>
        </dl>
      ) : (
        <p className="muted small">Qiymatlarni to‘g‘rilang.</p>
      )}
      <p className="muted small">
        Chegirma = narx × chegirma % × min(1, birga km ÷ (o‘z safari km × to‘liq chegirma qismi)).
        Asoschining misoli: A 100 000, B yo‘lning yarmida qo‘shilib shu joyga boradi (40 000) — 15%
        da A 85 000, B 34 000, haydovchi 119 000. Ilovasiz yo‘lovchilar hisobga olinmaydi; o‘rindiq
        narxli safarlarga chegirma yo‘q.
      </p>
      <Button size="sm" variant="ghost" onClick={() => setX(FOUNDER_EXAMPLE)}>
        Asoschi misolini qaytarish
      </Button>
    </div>
  );
}

/** "Hamroh bilan" rules (admin/settings/pool): times in minutes here, seconds in the API. */
export function PoolSettingsCard({ data }: { data: PoolRules }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<PoolForm>(() => poolToForm(data));
  useEffect(() => setForm(poolToForm(data)), [data]);
  const errors = poolFormProblems(form);
  const dirty = JSON.stringify(form) !== JSON.stringify(poolToForm(data));
  const save = useMutation({
    mutationFn: (body: PoolRules) =>
      api<PoolRules>('/v1/admin/settings/pool', { method: 'PUT', body }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'pool'], saved);
      toast('Hamroh bilan: saqlandi');
    },
  });
  return (
    <section className="card settings-form settings-wide">
      <h2>Hamroh bilan (shared ride)</h2>
      <p className="muted small">
        Rozi bo‘lgan yo‘lovchilar bir yo‘nalishdagi mashinada birga ketadi: hech kim kutmaydi, yangi
        yo‘lovchi faqat yo‘l ustida bo‘lsa olinadi. Old o‘rindiqda 1, orqada ko‘pi bilan 2 kishi.
        Chegirma faqat birga yurilgan qismga qarab beriladi.
      </p>
      <Toggle
        checked={form.enabled}
        onChange={(enabled) => setForm({ ...form, enabled })}
        label="Hamroh bilan safarlar yoqilgan"
      />
      <div className="grid-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint} error={errors[f.key]}>
            {(p) => (
              <NumberInput
                {...p}
                decimals={f.decimals}
                suffix={f.suffix}
                value={form[f.key]}
                onChange={(v) => setForm({ ...form, [f.key]: v })}
              />
            )}
          </Field>
        ))}
      </div>
      <PoolCalculator form={form} />
      {save.error && <ErrorBox error={save.error} />}
      <div className="form-actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setForm(poolToForm(data))}>
          Bekor qilish
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} />}
          disabled={!dirty || Object.keys(errors).length > 0}
          loading={save.isPending}
          onClick={() =>
            void confirm({
              title: 'Hamroh bilan qoidalarini saqlash',
              text: 'Yangi qoidalar keyingi moslashtirishlardan amal qiladi.',
              confirm: 'Saqlash',
            }).then((ok) => ok && save.mutate(formToPool(form)))
          }
        >
          Saqlash
        </Button>
      </div>
    </section>
  );
}
