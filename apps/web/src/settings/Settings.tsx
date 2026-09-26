import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useBillingRules, useDispatchRules } from '../api/queries';
import type { BillingRules, DispatchRules } from '../api/types';
import { date, som, tashkentToday } from '../lib/format';
import { Button, Field, MoneyInput, NumberInput, PageHeader, Toggle } from '../ui/controls';
import { ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';

type Draft<T> = { [K in keyof T]: T[K] extends number ? number | null : T[K] };

interface NumSpec<T> {
  key: keyof T & string;
  label: string;
  hint?: string;
  suffix?: string;
  min: number;
  max: number;
  money?: boolean;
  decimals?: boolean;
}

function numberProblems<T>(draft: Draft<T>, specs: NumSpec<T>[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of specs) {
    const v = draft[s.key] as unknown as number | null;
    if (v === null || Number.isNaN(v)) out[s.key] = 'Qiymatni kiriting';
    else if (!s.decimals && !Number.isInteger(v)) out[s.key] = 'Butun son';
    else if (v < s.min || v > s.max) out[s.key] = `${s.min} dan ${s.max} gacha`;
  }
  return out;
}

function NumFields<T>({
  specs,
  draft,
  setDraft,
  errors,
}: {
  specs: NumSpec<T>[];
  draft: Draft<T>;
  setDraft: (d: Draft<T>) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="grid-2">
      {specs.map((s) => (
        <Field key={s.key} label={s.label} hint={s.hint} error={errors[s.key]}>
          {(p) =>
            s.money ? (
              <MoneyInput
                {...p}
                value={draft[s.key] as unknown as number | null}
                onChange={(v) => setDraft({ ...draft, [s.key]: v })}
              />
            ) : (
              <NumberInput
                {...p}
                decimals={s.decimals}
                suffix={s.suffix}
                value={draft[s.key] as unknown as number | null}
                onChange={(v) => setDraft({ ...draft, [s.key]: v })}
              />
            )
          }
        </Field>
      ))}
    </div>
  );
}

function SettingsCard<T extends object>({
  title,
  intro,
  path,
  data,
  specs,
  extraFields,
  extraProblems,
  queryKey,
}: {
  title: string;
  intro: ReactNode;
  path: string;
  data: T;
  specs: NumSpec<T>[];
  extraFields?: (draft: Draft<T>, setDraft: (d: Draft<T>) => void) => ReactNode;
  extraProblems?: (draft: Draft<T>) => Record<string, string>;
  queryKey: string[];
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft<T>>(data as Draft<T>);
  useEffect(() => setDraft(data as Draft<T>), [data]);
  const errors = { ...numberProblems(draft, specs), ...(extraProblems?.(draft) ?? {}) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const save = useMutation({
    mutationFn: () => api<T>(path, { method: 'PUT', body: draft }),
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKey, saved);
      toast(`${title}: saqlandi`);
    },
  });
  return (
    <section className="card settings-form">
      <h2>{title}</h2>
      <p className="muted small">{intro}</p>
      {extraFields?.(draft, setDraft)}
      <NumFields specs={specs} draft={draft} setDraft={setDraft} errors={errors} />
      {save.error && <ErrorBox error={save.error} />}
      <div className="form-actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(data as Draft<T>)}>
          Bekor qilish
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} />}
          disabled={!dirty || Object.keys(errors).length > 0}
          loading={save.isPending}
          onClick={() =>
            void confirm({
              title: `${title}ni saqlash`,
              text: 'O‘zgarishlar darhol amal qiladi.',
              confirm: 'Saqlash',
            }).then((ok) => ok && save.mutate())
          }
        >
          Saqlash
        </Button>
      </div>
    </section>
  );
}

const DISPATCH_SPECS: NumSpec<DispatchRules>[] = [
  {
    key: 'offer_timeout_seconds',
    label: 'Taklifga javob vaqti',
    hint: 'Haydovchi shu vaqt ichida qabul qilmasa, keyingisiga o‘tadi',
    suffix: 's',
    min: 5,
    max: 120,
  },
  {
    key: 'direct_offers',
    label: 'Navbat bilan takliflar soni',
    hint: 'Keyin hammaga e’lon',
    min: 1,
    max: 10,
  },
  { key: 'search_radius_m', label: 'Qidiruv radiusi', suffix: 'm', min: 500, max: 50_000 },
  { key: 'candidates', label: 'Yo‘l bo‘yicha solishtiriladigan eng yaqinlar', min: 1, max: 50 },
  {
    key: 'broadcast_radius_m',
    label: 'E’lon radiusi',
    hint: 'Qidiruv radiusidan katta emas',
    suffix: 'm',
    min: 500,
    max: 50_000,
  },
  {
    key: 'broadcast_timeout_seconds',
    label: 'E’lon davomiyligi',
    hint: 'Keyin operatorga signal',
    suffix: 's',
    min: 10,
    max: 600,
  },
  {
    key: 'search_timeout_seconds',
    label: 'Qidiruv chegarasi',
    hint: 'Shundan keyin tizim buyurtmani bekor qiladi',
    suffix: 's',
    min: 60,
    max: 3600,
  },
  {
    key: 'location_max_age_seconds',
    label: 'GPS eskirish vaqti',
    hint: 'Eskiroq joylashuvli haydovchiga taklif bormaydi',
    suffix: 's',
    min: 30,
    max: 3600,
  },
  {
    key: 'tie_window_seconds',
    label: 'Teng yaqinlik oralig‘i',
    hint: 'Shu farq ichida ustuvorlik bali hal qiladi',
    suffix: 's',
    min: 0,
    max: 600,
  },
  {
    key: 'no_show_after_minutes',
    label: '“Yo‘lovchi chiqmadi” mumkin bo‘ladi',
    suffix: 'daq',
    min: 1,
    max: 60,
  },
];

const BILLING_SPECS: NumSpec<BillingRules>[] = [
  {
    key: 'commission_percent',
    label: 'Shahar safarlari komissiyasi',
    suffix: '%',
    min: 0,
    max: 50,
    decimals: true,
  },
  {
    key: 'daily_cap',
    label: 'Kunlik komissiya chegarasi',
    hint: '0 — chegarasiz',
    money: true,
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'weekly_cap',
    label: 'Haftalik komissiya chegarasi',
    hint: 'Dushanba–yakshanba; 0 — chegarasiz',
    money: true,
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'intercity_commission_percent',
    label: 'Shaharlararo komissiya',
    suffix: '%',
    min: 0,
    max: 50,
    decimals: true,
  },
  {
    key: 'intercity_trip_cap',
    label: 'Shaharlararo, bir safarga chegara',
    hint: '0 — chegarasiz',
    money: true,
    min: 0,
    max: 10_000_000,
  },
  {
    key: 'tax_percent',
    label: 'Ushlanadigan soliq',
    hint: 'O‘zini o‘zi band qilganlar, PQ-247',
    suffix: '%',
    min: 0,
    max: 20,
    decimals: true,
  },
  { key: 'pass_day_price', label: 'Kunlik abonement', money: true, min: 0, max: 10_000_000 },
  { key: 'pass_week_price', label: 'Haftalik abonement', money: true, min: 0, max: 10_000_000 },
];

/** Dispatch parameters and driver billing (commission promo, caps, passes, tax, minimum). */
export default function Settings() {
  const dispatch = useDispatchRules();
  const billing = useBillingRules();
  return (
    <div>
      <PageHeader
        title="Sozlamalar"
        subtitle="Haydovchi qidirish qoidalari va haydovchilar hisob-kitobi (butun platforma uchun)"
      />
      {dispatch.error && (
        <ErrorBox error={dispatch.error} onRetry={() => void dispatch.refetch()} />
      )}
      {billing.error && <ErrorBox error={billing.error} onRetry={() => void billing.refetch()} />}
      {dispatch.isPending || billing.isPending ? (
        <Loading />
      ) : (
        <div className="settings-grid">
          {dispatch.data && (
            <SettingsCard<DispatchRules>
              title="Dispetcherlik"
              intro="Avval eng yaqin (yo‘l bo‘yicha) haydovchilarga navbat bilan, keyin radius ichidagi hammaga e’lon, so‘ng operatorga signal."
              path="/v1/admin/settings/dispatch"
              queryKey={['settings', 'dispatch']}
              data={dispatch.data}
              specs={DISPATCH_SPECS}
              extraProblems={(d): Record<string, string> =>
                d.broadcast_radius_m !== null &&
                d.search_radius_m !== null &&
                d.broadcast_radius_m > d.search_radius_m
                  ? {
                      broadcast_radius_m:
                        'E’lon radiusi qidiruv radiusidan katta bo‘lmasligi kerak',
                    }
                  : {}
              }
            />
          )}
          {billing.data && (
            <SettingsCard<BillingRules>
              title="Hisob-kitob"
              intro="Naqd safarlarda komissiya va soliq haydovchi balansidan yechiladi. Abonement shahar safarlari komissiyasini almashtiradi."
              path="/v1/admin/settings/billing"
              queryKey={['settings', 'billing']}
              data={billing.data}
              specs={BILLING_SPECS}
              extraFields={(d, setD) => (
                <div className="grid-2">
                  <Field
                    label="Aksiya: komissiyasiz davr tugashi"
                    hint={
                      d.promo_until
                        ? d.promo_until >= tashkentToday()
                          ? `${date(d.promo_until)} gacha komissiya 0%`
                          : 'Aksiya tugagan'
                        : 'Aksiya yo‘q'
                    }
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="date"
                        value={d.promo_until ?? ''}
                        disabled={d.promo_until === null}
                        onChange={(e) => setD({ ...d, promo_until: e.target.value || null })}
                      />
                    )}
                  </Field>
                  <div className="field toggle-field">
                    <Toggle
                      checked={d.promo_until !== null}
                      onChange={(on) =>
                        setD({
                          ...d,
                          promo_until: on ? (billing.data.promo_until ?? tashkentToday()) : null,
                        })
                      }
                      label="Komissiyasiz aksiya"
                    />
                  </div>
                  <Field
                    label="Ruxsat etilgan qarz (minimal balans)"
                    hint={`Balans ${som(d.min_balance === null ? 0 : d.min_balance)} dan past bo‘lsa, haydovchi liniyaga chiqolmaydi va taklif olmaydi`}
                    error={
                      d.min_balance === null
                        ? 'Qiymatni kiriting'
                        : d.min_balance > 0 || d.min_balance < -10_000_000
                          ? '0 yoki manfiy'
                          : null
                    }
                  >
                    {(p) => (
                      <NumberInput
                        {...p}
                        suffix="so‘m"
                        value={d.min_balance === null ? null : -d.min_balance}
                        onChange={(v) => setD({ ...d, min_balance: v === null ? null : -v })}
                      />
                    )}
                  </Field>
                </div>
              )}
              extraProblems={(d): Record<string, string> =>
                d.min_balance === null || d.min_balance > 0 || d.min_balance < -10_000_000
                  ? { min_balance: 'Minimal balans' }
                  : d.promo_until !== null && !/^\d{4}-\d{2}-\d{2}$/.test(d.promo_until)
                    ? { promo_until: 'Sana' }
                    : {}
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
