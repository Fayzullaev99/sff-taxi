import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Pencil, Plus, Save } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorText } from '../api/client';
import { usePromo, usePromoRules, usePromos, useReferrals } from '../api/promo-queries';
import type { AdminPromo, PromoRules, ReferralStatus } from '../api/promo-types';
import { dateTime, som } from '../lib/format';
import { formatPhone } from '../lib/phone';
import {
  emptyPromoForm,
  formToBody,
  PROMO_CLASSES,
  PROMO_SERVICES,
  type PromoForm,
  promoFormProblems,
  promoRulesProblems,
  promoRulesText,
  promoState,
  promoToForm,
  promoValueText,
  REFERRAL_STATUS,
  usesText,
} from '../lib/promos';
import {
  Badge,
  Button,
  Field,
  MoneyInput,
  NumberInput,
  PageHeader,
  Segmented,
  Toggle,
} from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';
import { TextDialog } from '../ui/TextDialog';

type Tab = 'codes' | 'referrals' | 'settings';

const STACK = { display: 'grid', gap: 12 } as const;

/**
 * Rider marketing: promo codes for campaigns (who may use them, how much, until when, and
 * how they were used), the "Do'stni taklif qil" referrals (revoke abuse) and the rules of
 * the referral programme and ride credit. The platform pays every discount: drivers earn
 * the full fare.
 */
export default function Promos() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'codes';
  return (
    <div>
      <PageHeader
        title="Promokodlar va takliflar"
        subtitle="Chegirmani platforma to‘laydi: haydovchi har doim to‘liq narxni oladi"
      />
      <div className="filters">
        <Segmented
          label="Bo‘lim"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            { value: 'codes', label: 'Promokodlar' },
            { value: 'referrals', label: 'Do‘stni taklif qilish' },
            { value: 'settings', label: 'Taklif va bonus qoidalari' },
          ]}
        />
      </div>
      {tab === 'codes' ? <Codes /> : tab === 'referrals' ? <Referrals /> : <RulesCard />}
    </div>
  );
}

function Codes() {
  const [q, setQ] = useState('');
  const [active, setActive] = useState<'all' | 'true' | 'false'>('all');
  const promos = usePromos(q, active);
  const [editing, setEditing] = useState<AdminPromo | 'new' | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  return (
    <>
      <div className="filters">
        <input
          type="search"
          placeholder="Kod bo‘yicha qidirish"
          aria-label="Kod bo‘yicha qidirish"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Segmented
          label="Holat"
          value={active}
          onChange={setActive}
          options={[
            { value: 'all', label: 'Hammasi' },
            { value: 'true', label: 'Yoqilgan' },
            { value: 'false', label: 'O‘chirilgan' },
          ]}
        />
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
          Yangi promokod
        </Button>
      </div>
      {promos.error ? (
        <ErrorBox error={promos.error} onRetry={() => void promos.refetch()} />
      ) : promos.isPending ? (
        <Loading />
      ) : !promos.data.length ? (
        <Empty title="Promokod yo‘q">
          Reklama kampaniyasi uchun kod yarating: foiz yoki summa, muddat va limitlar.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Kod</th>
                <th>Chegirma</th>
                <th>Muddat</th>
                <th className="num">Ishlatilgan</th>
                <th className="num">Chegirma jami</th>
                <th>Holat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {promos.data.map((p) => {
                const state = promoState(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <button type="button" className="link-btn" onClick={() => setDetails(p.id)}>
                        <strong>{p.code}</strong>
                      </button>
                      {p.description && <div className="muted small clamp-2">{p.description}</div>}
                    </td>
                    <td>
                      {promoValueText(p)}
                      {promoRulesText(p) && <div className="muted small">{promoRulesText(p)}</div>}
                    </td>
                    <td className="small">
                      {p.validFrom || p.validUntil
                        ? `${p.validFrom ? dateTime(p.validFrom) : '…'} — ${p.validUntil ? dateTime(p.validUntil) : '…'}`
                        : 'muddatsiz'}
                    </td>
                    <td className="num">
                      {usesText(p)}
                      {p.stats.reserved > 0 && (
                        <div className="muted small">{p.stats.reserved} ta ochiq safarda</div>
                      )}
                    </td>
                    <td className="num">{som(p.stats.discountTotal)}</td>
                    <td>
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Pencil size={14} />}
                        onClick={() => setEditing(p)}
                      >
                        Tahrirlash
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <PromoEditor promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {details && <PromoDetails id={details} onClose={() => setDetails(null)} />}
    </>
  );
}

/** One code's statistics and the rides that used it (a drawer next to the list). */
function PromoDetails({ id, onClose }: { id: string; onClose: () => void }) {
  const promo = usePromo(id);
  const p = promo.data;
  return (
    <Modal open onClose={onClose} variant="drawer" title={p ? `Promokod ${p.code}` : 'Promokod'}>
      {promo.error ? (
        <ErrorBox error={promo.error} onRetry={() => void promo.refetch()} />
      ) : !p ? (
        <Loading />
      ) : (
        <div style={STACK}>
          <dl className="facts">
            {(
              [
                ['Chegirma', promoValueText(p)],
                ['Yakunlangan safarlar', String(p.stats.redeemed)],
                ['Ochiq safarlarda', String(p.stats.reserved)],
                ['Chegirma jami', som(p.stats.discountTotal)],
                ['Saqlagan yo‘lovchilar', String(p.stats.saved)],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {!p.rides.length ? (
            <Empty title="Hali ishlatilmagan" />
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Safar</th>
                  <th>Yo‘lovchi</th>
                  <th className="num">Narx</th>
                  <th className="num">Chegirma</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {p.rides.map((r) => (
                  <tr key={r.rideId}>
                    <td>
                      <Link to={`/rides/${r.rideId}`}>#{r.number}</Link>
                      <div className="muted small">{dateTime(r.createdAt)}</div>
                    </td>
                    <td className="nowrap">{formatPhone(r.riderPhone)}</td>
                    <td className="num">{som(r.fare)}</td>
                    <td className="num">−{som(r.discount)}</td>
                    <td>
                      <Badge
                        tone={
                          r.status === 'redeemed'
                            ? 'green'
                            : r.status === 'reserved'
                              ? 'blue'
                              : 'neutral'
                        }
                      >
                        {r.status === 'redeemed'
                          ? 'Ishlatildi'
                          : r.status === 'reserved'
                            ? 'Safarda'
                            : 'Bekor qilingan'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

function PromoEditor({ promo, onClose }: { promo: AdminPromo | null; onClose: () => void }) {
  const [form, setForm] = useState<PromoForm>(() =>
    promo ? promoToForm(promo) : emptyPromoForm(),
  );
  const [touched, setTouched] = useState(false);
  const problems = promoFormProblems(form);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const save = useMutation({
    mutationFn: () =>
      api<AdminPromo>(promo ? `/v1/admin/promos/${promo.id}` : '/v1/admin/promos', {
        method: promo ? 'PATCH' : 'POST',
        body: formToBody(form),
      }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['promos'] });
      void queryClient.invalidateQueries({ queryKey: ['promo', saved.id] });
      toast(promo ? `${saved.code} saqlandi` : `${saved.code} yaratildi`);
      onClose();
    },
  });
  const set = <K extends keyof PromoForm>(key: K, value: PromoForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (key: 'services' | 'classes', value: string) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));
  const submit = async () => {
    setTouched(true);
    if (Object.keys(problems).length) return;
    if (promo?.isActive && !form.isActive) {
      const ok = await confirm({
        title: `${promo.code} o‘chirilsinmi?`,
        text: 'Yo‘lovchilar uni boshqa qo‘llay olmaydi. Ochiq safarlardagi chegirma saqlanadi.',
        confirm: 'O‘chirish',
        danger: true,
      });
      if (!ok) return;
    }
    save.mutate();
  };
  const err = (key: keyof PromoForm) => (touched ? problems[key] : undefined);
  return (
    <Modal
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={promo ? `Promokod ${promo.code}` : 'Yangi promokod'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Bekor qilish
          </Button>
          <Button
            variant="primary"
            icon={<Save size={16} />}
            loading={save.isPending}
            onClick={() => void submit()}
          >
            Saqlash
          </Button>
        </>
      }
    >
      <div style={STACK}>
        {save.error && <div className="alert alert-error">{errorText(save.error)}</div>}
        <div className="grid-2">
          <Field label="Kod" hint="Yo‘lovchi istalgan harfda yozishi mumkin" error={err('code')}>
            {(p) => (
              <input
                {...p}
                value={form.code}
                maxLength={30}
                onChange={(e) => set('code', e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Turi">
            {() => (
              <Segmented
                label="Chegirma turi"
                value={form.kind}
                onChange={(kind) => set('kind', kind)}
                options={[
                  { value: 'percent', label: 'Foiz' },
                  { value: 'fixed', label: 'Summa' },
                ]}
              />
            )}
          </Field>
          <Field label={form.kind === 'percent' ? 'Foiz' : 'Chegirma summasi'} error={err('value')}>
            {(p) =>
              form.kind === 'percent' ? (
                <NumberInput
                  {...p}
                  suffix="%"
                  value={form.value}
                  onChange={(v) => set('value', v)}
                />
              ) : (
                <MoneyInput {...p} value={form.value} onChange={(v) => set('value', v)} />
              )
            }
          </Field>
          {form.kind === 'percent' ? (
            <Field label="Eng ko‘p chegirma" error={err('maxDiscount')}>
              {(p) => (
                <MoneyInput
                  {...p}
                  value={form.maxDiscount}
                  onChange={(v) => set('maxDiscount', v)}
                />
              )}
            </Field>
          ) : (
            <div />
          )}
          <Field
            label="Eng kam narx"
            hint="Safar narxi shundan kam bo‘lsa, kod ishlamaydi"
            error={err('minFare')}
          >
            {(p) => <MoneyInput {...p} value={form.minFare} onChange={(v) => set('minFare', v)} />}
          </Field>
          <Field label="Har bir yo‘lovchiga" error={err('perRiderLimit')}>
            {(p) => (
              <NumberInput
                {...p}
                suffix="marta"
                value={form.perRiderLimit}
                onChange={(v) => set('perRiderLimit', v)}
              />
            )}
          </Field>
          <Field label="Jami limit" hint="Bo‘sh — cheklovsiz" error={err('usageLimit')}>
            {(p) => (
              <NumberInput
                {...p}
                suffix="safar"
                value={form.usageLimit}
                onChange={(v) => set('usageLimit', v)}
              />
            )}
          </Field>
          <div />
          <Field label="Boshlanishi (Toshkent vaqti)" error={err('validFrom')}>
            {(p) => (
              <input
                {...p}
                type="datetime-local"
                value={form.validFrom}
                onChange={(e) => set('validFrom', e.target.value)}
              />
            )}
          </Field>
          <Field label="Tugashi (Toshkent vaqti)" error={err('validUntil')}>
            {(p) => (
              <input
                {...p}
                type="datetime-local"
                value={form.validUntil}
                onChange={(e) => set('validUntil', e.target.value)}
              />
            )}
          </Field>
        </div>
        <Chips
          label="Xizmatlar (hech biri — hammasi)"
          options={PROMO_SERVICES}
          selected={form.services}
          onToggle={(v) => toggleIn('services', v)}
        />
        <Chips
          label="Sinflar (hech biri — hammasi)"
          options={PROMO_CLASSES}
          selected={form.classes}
          onToggle={(v) => toggleIn('classes', v)}
        />
        <Toggle
          checked={form.firstRideOnly}
          onChange={(v) => set('firstRideOnly', v)}
          label="Faqat birinchi safar (hali safar qilmagan yo‘lovchilar)"
        />
        <Toggle checked={form.isActive} onChange={(v) => set('isActive', v)} label="Yoqilgan" />
        <Field label="Izoh (yo‘lovchi ham ko‘radi)" error={err('description')}>
          {(p) => (
            <input
              {...p}
              value={form.description}
              maxLength={300}
              placeholder="Masalan: Kuzgi aksiya — 20% chegirma"
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Tavsif (ruscha)"
          hint="Ruscha ilovada shu ko‘rinadi; bo‘sh qolsa — o‘zbekcha izoh"
          error={err('descriptionRu')}
        >
          {(p) => (
            <input
              {...p}
              value={form.descriptionRu}
              maxLength={300}
              placeholder="Например: Осенняя акция — скидка 20%"
              onChange={(e) => set('descriptionRu', e.target.value)}
            />
          )}
        </Field>
      </div>
    </Modal>
  );
}

function Chips({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <fieldset className="chips">
      <legend>{label}</legend>
      {options.map((o) => (
        <label key={o.value} className={`chip${selected.includes(o.value) ? ' is-active' : ''}`}>
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={() => onToggle(o.value)}
          />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

function Referrals() {
  const [status, setStatus] = useState<ReferralStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const referrals = useReferrals(status, q);
  const [revoking, setRevoking] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const items = referrals.data?.items ?? [];
  return (
    <>
      <div className="filters">
        <input
          type="search"
          placeholder="Telefon yoki kod"
          aria-label="Telefon yoki kod"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Segmented
          label="Holat"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Hammasi' },
            { value: 'pending', label: 'Kutilmoqda' },
            { value: 'rewarded', label: 'Bonus berildi' },
            { value: 'capped', label: 'Limit' },
            { value: 'revoked', label: 'Bekor' },
          ]}
        />
      </div>
      {referrals.error ? (
        <ErrorBox error={referrals.error} onRetry={() => void referrals.refetch()} />
      ) : referrals.isPending ? (
        <Loading />
      ) : !items.length ? (
        <Empty title="Taklif yo‘q">
          Yo‘lovchilar do‘stlarini taklif qilganda shu yerda ko‘rinadi.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Sana</th>
                <th>Taklif qilgan</th>
                <th>Taklif qilingan</th>
                <th>Holat</th>
                <th className="num">Bonus</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{dateTime(r.createdAt)}</td>
                  <td>
                    {formatPhone(r.referrerPhone)}
                    <div className="muted small">
                      {r.referrerName ?? '—'} · kod {r.code}
                    </div>
                  </td>
                  <td>
                    {formatPhone(r.inviteePhone)}
                    <div className="muted small">{r.inviteeName ?? '—'}</div>
                  </td>
                  <td>
                    <Badge tone={REFERRAL_STATUS[r.status].tone}>
                      {REFERRAL_STATUS[r.status].label}
                    </Badge>
                    {r.revokeNote && <div className="muted small">{r.revokeNote}</div>}
                    {r.rewardRideId && (
                      <div className="small">
                        <Link to={`/rides/${r.rewardRideId}`}>birinchi safar</Link>
                      </div>
                    )}
                  </td>
                  <td className="num">{r.rewardAmount ? som(r.rewardAmount) : '—'}</td>
                  <td>
                    {r.status !== 'revoked' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Ban size={14} />}
                        onClick={() => setRevoking(r.id)}
                      >
                        Bekor qilish
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revoking && (
        <TextDialog
          title="Taklifni bekor qilish"
          intro={
            <p className="small">
              Taklif qilinganning chegirmasi to‘xtaydi; berilgan bonus taklif qilganning bonus
              hisobidan (qolgancha) qaytarib olinadi.
            </p>
          }
          label="Sabab"
          confirm="Bekor qilish"
          danger
          suggestions={['Bitta odam, ikki raqam', 'Bir qurilmadan ko‘p hisob', 'Soxta taklif']}
          onSubmit={(note) =>
            api(`/v1/admin/referrals/${revoking}/revoke`, { method: 'POST', body: { note } }).then(
              () => {
                void queryClient.invalidateQueries({ queryKey: ['referrals'] });
                toast('Taklif bekor qilindi');
              },
            )
          }
          onClose={() => setRevoking(null)}
        />
      )}
    </>
  );
}

type RulesDraft = {
  [K in keyof PromoRules]: PromoRules[K] extends number ? number | null : PromoRules[K];
};

function RulesCard() {
  const rules = usePromoRules();
  if (rules.error) return <ErrorBox error={rules.error} onRetry={() => void rules.refetch()} />;
  if (!rules.data) return <Loading />;
  return <RulesForm data={rules.data} />;
}

function RulesForm({ data }: { data: PromoRules }) {
  const [draft, setDraft] = useState<RulesDraft>(data);
  useEffect(() => setDraft(data), [data]);
  const queryClient = useQueryClient();
  const toast = useToast();
  const filled = Object.values(draft).every((v) => v !== null);
  const problems = filled ? promoRulesProblems(draft as PromoRules) : {};
  const save = useMutation({
    mutationFn: () => api<PromoRules>('/v1/admin/settings/promo', { method: 'PUT', body: draft }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'promo'], saved);
      toast('Taklif va bonus qoidalari saqlandi');
    },
  });
  const money = (key: keyof PromoRules, label: string, hint?: ReactNode) => (
    <Field label={label} hint={hint} error={problems[key]}>
      {(p) => (
        <MoneyInput
          {...p}
          value={draft[key] as number | null}
          onChange={(v) => setDraft({ ...draft, [key]: v })}
        />
      )}
    </Field>
  );
  const num = (key: keyof PromoRules, label: string, suffix: string, hint?: ReactNode) => (
    <Field label={label} hint={hint} error={problems[key]}>
      {(p) => (
        <NumberInput
          {...p}
          suffix={suffix}
          value={draft[key] as number | null}
          onChange={(v) => setDraft({ ...draft, [key]: v })}
        />
      )}
    </Field>
  );
  return (
    <section className="card settings-form">
      <h2>Do‘stni taklif qilish</h2>
      <Toggle
        checked={draft.referral_enabled}
        onChange={(v) => setDraft({ ...draft, referral_enabled: v })}
        label="Taklif dasturi yoqilgan"
      />
      <div className="grid-2">
        {num('invitee_discount_percent', 'Yangi yo‘lovchiga chegirma', '%')}
        {money('invitee_max_discount', 'Chegirma ko‘pi bilan')}
        {num('invitee_rides', 'Chegirmali safarlar', 'ta', 'Birinchi safar(lar)')}
        {money('referrer_bonus', 'Taklif qilganga bonus', 'Do‘sti birinchi safarini yakunlagach')}
        {num('monthly_reward_cap', 'Oyiga bonusli takliflar', 'ta', '0 — cheklovsiz')}
      </div>
      <Field
        label="Taklif sahifasi (ilova o‘rnatilmagan telefonlar uchun)"
        error={problems.invite_url}
      >
        {(p) => (
          <input
            {...p}
            value={draft.invite_url}
            onChange={(e) => setDraft({ ...draft, invite_url: e.target.value })}
          />
        )}
      </Field>
      <h2>Bonus va chegirmalar</h2>
      <div className="grid-2">
        {num(
          'credit_max_percent',
          'Bonus safarning ko‘pi bilan',
          '%',
          'Qolganini yo‘lovchi to‘laydi',
        )}
        {money('min_rider_pays', 'Yo‘lovchi kamida to‘laydi', 'Har qanday chegirmadan keyin')}
      </div>
      {save.error && <div className="alert alert-error">{errorText(save.error)}</div>}
      <div className="row-actions">
        <Button
          variant="primary"
          icon={<Save size={16} />}
          loading={save.isPending}
          disabled={!filled || Object.keys(problems).length > 0}
          onClick={() => save.mutate()}
        >
          Saqlash
        </Button>
      </div>
    </section>
  );
}
