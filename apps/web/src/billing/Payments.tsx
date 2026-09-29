import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, CreditCard, Search, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorText, fieldErrors } from '../api/client';
import {
  type IntentFilters,
  useDriver,
  useDrivers,
  useIntents,
  useIntentSummary,
  usePayouts,
  useRefunds,
} from '../api/queries';
import {
  type DriverPayout,
  INTENT_STATUSES,
  type PaymentProvider,
  type Refund,
  type Standing,
} from '../api/types';
import {
  ago,
  dateTime,
  DRIVER_STATUS,
  INTENT_PURPOSE,
  INTENT_STATUS,
  INTENT_TONE,
  PROVIDERS,
  som,
} from '../lib/format';
import { entryProblems } from '../lib/ops';
import { intentTotals, refundSubject } from '../lib/payments';
import { formatPhone, isUzPhone, normalizePhone } from '../lib/phone';
import { useDebounced } from '../map/places';
import { Badge, Button, Field, MoneyInput, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { LoadMore } from '../ui/LoadMore';
import { Modal } from '../ui/Modal';
import { TextDialog } from '../ui/TextDialog';
import { LedgerCard } from './LedgerCard';

type Tab = 'intents' | 'refunds' | 'payouts' | 'topups';

/** Totals of card payments per purpose over the chosen days (GET intents/summary). */
function IntentSummary({ from, to }: { from: string; to: string }) {
  const summary = useIntentSummary(from || undefined, to || undefined);
  if (summary.error) {
    return <ErrorBox error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  if (!summary.data) return null;
  const totals = intentTotals(summary.data);
  return (
    <div className="summary-grid" aria-label="Jami">
      {(['ride', 'topup', 'booking'] as const).map((purpose) => {
        const t = totals[purpose];
        return (
          <section key={purpose} className="card summary-card">
            <h3>{INTENT_PURPOSE[purpose]}</h3>
            <p className="summary-main">
              <strong>{som(t.paid.amount)}</strong>{' '}
              <span className="muted small">{t.paid.count} ta to‘langan</span>
            </p>
            <ul className="plain-list small">
              {INTENT_STATUSES.filter((s) => s !== 'paid' && t.byStatus[s].count > 0).map((s) => (
                <li key={s}>
                  <Badge tone={INTENT_TONE[s]}>{INTENT_STATUS[s]}</Badge> {t.byStatus[s].count} ta ·{' '}
                  {som(t.byStatus[s].amount)}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Every card payment (GET admin/payments/intents): ride prepayments and driver top-ups, newest
 * first, filtered on the server; the filters live in the URL.
 */
function IntentsTab() {
  const [params, setParams] = useSearchParams();
  const get = (k: string) => params.get(k) ?? '';
  const [phoneText, setPhoneText] = useState(() => formatPhone(get('phone')));
  const phoneTyped = useDebounced(phoneText.trim(), 400);
  const phone = isUzPhone(phoneTyped) ? normalizePhone(phoneTyped) : '';
  const from = get('from');
  const to = get('to');
  const rangeError = from && to && from > to ? '“dan” sanasi “gacha” sanasidan keyin' : null;
  const filters: IntentFilters = {
    purpose: get('purpose') as IntentFilters['purpose'],
    status: get('status') as IntentFilters['status'],
    provider: get('provider') as PaymentProvider | '',
    phone,
    driverId: get('driverId'),
    rideId: get('rideId'),
    from: rangeError ? '' : from,
    to: rangeError ? '' : to,
  };
  const intents = useIntents(filters);
  const rows = useMemo(() => intents.data?.pages.flatMap((p) => p.items) ?? [], [intents.data]);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const filtered = ['purpose', 'status', 'provider', 'driverId', 'rideId', 'from', 'to'].some((k) =>
    params.get(k),
  );

  return (
    <>
      <div className="filters">
        <label className="sr-only" htmlFor="intent-purpose">
          Maqsad
        </label>
        <select
          id="intent-purpose"
          value={filters.purpose}
          onChange={(e) => set('purpose', e.target.value)}
        >
          <option value="">Barcha to‘lovlar</option>
          <option value="ride">{INTENT_PURPOSE.ride}</option>
          <option value="topup">{INTENT_PURPOSE.topup}</option>
          <option value="booking">{INTENT_PURPOSE.booking}</option>
        </select>
        <label className="sr-only" htmlFor="intent-status">
          Holat
        </label>
        <select
          id="intent-status"
          value={filters.status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="">Barcha holatlar</option>
          {INTENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {INTENT_STATUS[s]}
            </option>
          ))}
          <option value="failed">O‘tmagan (muddati o‘tgan yoki bekor)</option>
        </select>
        <label className="sr-only" htmlFor="intent-provider">
          To‘lov tizimi
        </label>
        <select
          id="intent-provider"
          value={filters.provider}
          onChange={(e) => set('provider', e.target.value)}
        >
          <option value="">Payme va Click</option>
          <option value="payme">Payme</option>
          <option value="click">Click</option>
        </select>
        <div className="search search-sm">
          <Search size={16} aria-hidden />
          <input
            type="search"
            inputMode="tel"
            aria-label="To‘lovchi telefoni"
            placeholder="Telefon"
            value={phoneText}
            maxLength={20}
            onChange={(e) => setPhoneText(e.target.value)}
          />
        </div>
        <label className="date-filter">
          dan
          <input type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="date-filter">
          gacha
          <input type="date" value={to} onChange={(e) => set('to', e.target.value)} />
        </label>
        {(filtered || phoneText) && (
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={() => {
              setPhoneText('');
              setParams({ tab: 'intents' }, { replace: true });
            }}
          >
            Tozalash
          </Button>
        )}
      </div>
      {rangeError && <div className="alert alert-warn">{rangeError}</div>}
      {phoneTyped && !phone && (
        <p className="muted small">Telefon to‘liq kiritilganda qidiriladi (+998 …).</p>
      )}
      {(filters.driverId || filters.rideId) && (
        <p className="small">
          Faqat{' '}
          {filters.driverId ? (
            <Link to={`/drivers/${filters.driverId}`}>shu haydovchi</Link>
          ) : (
            <Link to={`/rides/${filters.rideId}`}>shu safar</Link>
          )}{' '}
          to‘lovlari
        </p>
      )}
      <IntentSummary from={filters.from ?? ''} to={filters.to ?? ''} />
      {intents.error ? (
        <ErrorBox error={intents.error} onRetry={() => void intents.refetch()} />
      ) : intents.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Karta to‘lovi topilmadi">
          {filtered || phone
            ? 'Filtrlarni o‘zgartiring.'
            : 'Karta bilan to‘langan safarlar va balans to‘ldirishlar shu yerda ko‘rinadi.'}
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Yaratilgan</th>
                <th>Nima uchun</th>
                <th>To‘lovchi</th>
                <th className="num">Summa</th>
                <th>Tizim</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap">{dateTime(i.createdAt)}</td>
                  <td>
                    {i.purpose === 'booking' ? (
                      <>
                        {INTENT_PURPOSE.booking}
                        {i.bookingNumber != null && (
                          <div className="small">bron #{i.bookingNumber}</div>
                        )}
                      </>
                    ) : i.purpose === 'ride' ? (
                      i.rideId ? (
                        <Link to={`/rides/${i.rideId}`}>safar #{i.rideNumber ?? ''}</Link>
                      ) : (
                        INTENT_PURPOSE.ride
                      )
                    ) : (
                      <>
                        {INTENT_PURPOSE.topup}
                        {i.driverId && (
                          <div className="small">
                            <Link to={`/drivers/${i.driverId}`}>{i.driverName ?? 'haydovchi'}</Link>
                          </div>
                        )}
                      </>
                    )}
                  </td>
                  <td className="nowrap">{formatPhone(i.phone)}</td>
                  <td className="num">{som(i.amount)}</td>
                  <td>{i.provider ? (PROVIDERS[i.provider] ?? i.provider) : '—'}</td>
                  <td>
                    <Badge tone={INTENT_TONE[i.status]}>{INTENT_STATUS[i.status]}</Badge>
                    <div className="muted small">
                      {i.refundedAt
                        ? `qaytarildi ${dateTime(i.refundedAt)}`
                        : i.refundRequestedAt
                          ? `qaytarish so‘ralgan ${dateTime(i.refundRequestedAt)}`
                          : i.paidAt
                            ? `to‘landi ${dateTime(i.paidAt)}`
                            : i.status === 'pending'
                              ? `muddati ${dateTime(i.expiresAt)}`
                              : ''}
                    </div>
                    {i.refundReference && (
                      <div className="muted small clamp-2">{i.refundReference}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore
            shown={rows.length}
            hasMore={intents.hasNextPage}
            loading={intents.isFetchingNextPage}
            onMore={() => void intents.fetchNextPage()}
          />
        </div>
      )}
    </>
  );
}

/** Cancelled card rides paid in advance: refund in the provider's cabinet, then record it. */
function RefundsTab() {
  const refunds = useRefunds();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [recording, setRecording] = useState<Refund | null>(null);
  const total = refunds.data?.reduce((s, r) => s + r.amount, 0) ?? 0;
  return (
    <>
      <p className="muted small">
        Payme kabinetida qaytarilgan to‘lovlar avtomatik yoziladi. Click yoki bank orqali
        qaytarilganini shu yerda o‘tkazma raqami bilan yozing.
      </p>
      {refunds.error ? (
        <ErrorBox error={refunds.error} onRetry={() => void refunds.refetch()} />
      ) : refunds.isPending ? (
        <Loading />
      ) : !refunds.data.length ? (
        <Empty title="Qaytariladigan to‘lov yo‘q">
          Oldindan to‘langan karta safari yoki bron depoziti qaytarilishi kerak bo‘lsa, shu yerda
          paydo bo‘ladi.
        </Empty>
      ) : (
        <div className="card table-card">
          <p className="table-note small">
            <strong>{refunds.data.length}</strong> ta to‘lov, jami <strong>{som(total)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Safar / bron</th>
                <th>Yo‘lovchi</th>
                <th className="num">Summa</th>
                <th>Tizim</th>
                <th>To‘langan</th>
                <th>Bekor qilingan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {refunds.data.map((r) => (
                <tr key={r.id}>
                  <td>
                    {refundSubject(r).to ? (
                      <Link to={refundSubject(r).to!}>{refundSubject(r).label}</Link>
                    ) : (
                      refundSubject(r).label
                    )}
                  </td>
                  <td>{formatPhone(r.riderPhone)}</td>
                  <td className="num">{som(r.amount)}</td>
                  <td>{r.provider ? (PROVIDERS[r.provider] ?? r.provider) : '—'}</td>
                  <td className="nowrap">{dateTime(r.paidAt)}</td>
                  <td>
                    <span className="nowrap">{dateTime(r.refundRequestedAt)}</span>
                    {r.refundRequestedAt && (
                      <div className="muted small">{ago(r.refundRequestedAt)}</div>
                    )}
                    {r.cancelReason && <div className="muted small clamp-2">{r.cancelReason}</div>}
                  </td>
                  <td className="actions">
                    <Button size="sm" icon={<Undo2 size={14} />} onClick={() => setRecording(r)}>
                      Qaytarildi
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recording && (
        <TextDialog
          title={`${refundSubject(recording).label}: ${som(recording.amount)} qaytarildi`}
          intro={
            <p>
              {formatPhone(recording.riderPhone)} ga{' '}
              {recording.provider ? PROVIDERS[recording.provider] : 'to‘lov tizimi'} orqali
              to‘langan pul qaytarilganini tasdiqlang.
            </p>
          }
          label="Qaytarish raqami (Click tranzaksiyasi yoki bank o‘tkazmasi)"
          confirm="Qaytarildi deb yozish"
          maxLength={200}
          onSubmit={(reference) =>
            api(`/v1/admin/payments/${recording.id}/refunded`, {
              method: 'POST',
              body: { reference },
            }).then(() => {
              void queryClient.invalidateQueries({ queryKey: ['refunds'] });
              void queryClient.invalidateQueries({ queryKey: ['payments'] });
              void queryClient.invalidateQueries({ queryKey: ['ride', recording.rideId] });
              toast(`${refundSubject(recording).label}: qaytarish yozildi`);
            })
          }
          onClose={() => setRecording(null)}
        />
      )}
    </>
  );
}

function PayoutDialog({ payout, onClose }: { payout: DriverPayout; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(payout.payableNow || null);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const local = entryProblems('payout', amount, note, payout.payableNow);
  const pay = useMutation({
    mutationFn: () =>
      api<Standing>(`/v1/admin/billing/drivers/${payout.driverId}/ledger`, {
        method: 'POST',
        body: { kind: 'payout', amount, note: note.trim() },
      }),
    onSuccess: (standing) => {
      void queryClient.invalidateQueries({ queryKey: ['payouts'] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['driver', payout.driverId] });
      toast(`${payout.fullName}: ${som(amount!)} o‘tkazildi, balans ${som(standing.balance)}`);
      onClose();
    },
  });
  const server = fieldErrors(pay.error);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${payout.fullName}: pul o‘tkazish`}
      size="sm"
      busy={pay.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pay.isPending}>
            Qaytish
          </Button>
          <Button
            variant="primary"
            loading={pay.isPending}
            disabled={payout.payableNow <= 0}
            onClick={() => {
              setTouched(true);
              if (!Object.keys(local).length) pay.mutate();
            }}
          >
            O‘tkazildi deb yozish
          </Button>
        </>
      }
    >
      <dl className="facts facts-2">
        <div>
          <dt>Karta safarlari puli</dt>
          <dd>{som(payout.credited)}</dd>
        </div>
        <div>
          <dt>O‘tkazilgan</dt>
          <dd>{som(payout.paidOut)}</dd>
        </div>
        <div>
          <dt>Qarzimiz</dt>
          <dd>
            <strong>{som(payout.owed)}</strong>
          </dd>
        </div>
        <div>
          <dt>Hozir o‘tkazish mumkin</dt>
          <dd>
            <strong>{som(payout.payableNow)}</strong>
          </dd>
        </div>
      </dl>
      {payout.payableNow < payout.owed && (
        <div className="alert alert-warn">
          Balans {som(payout.balance)}: komissiya, soliq va qarzlar avval ushlab qolinadi, shuning
          uchun hozir ko‘pi bilan {som(payout.payableNow)} o‘tkaziladi.
        </div>
      )}
      <p className="muted small">
        Pulni haydovchi kartasiga o‘tkazgandan keyin yozing: balansdan ayiriladi.
      </p>
      <Field label="Summa" error={(touched && local.amount) || server.amount}>
        {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} autoFocus />}
      </Field>
      <Field
        label="Qayerga, o‘tkazma raqami"
        hint="Masalan: 8600 **** 1234, Click 123456789"
        error={(touched && local.note) || server.note}
      >
        {(p) => (
          <input {...p} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      {pay.error && !Object.keys(server).length && (
        <div className="alert alert-error" role="alert">
          {errorText(pay.error)}
        </div>
      )}
    </Modal>
  );
}

/** Card money the platform owes drivers (GET admin/drivers/payouts): pay it out, record it. */
function PayoutsTab() {
  const payouts = usePayouts();
  const [paying, setPaying] = useState<DriverPayout | null>(null);
  const rows = payouts.data ?? [];
  const total = rows.reduce((s, d) => s + d.owed, 0);
  const payable = rows.reduce((s, d) => s + d.payableNow, 0);
  return (
    <>
      <p className="muted small">
        Karta bilan oldindan to‘langan safarlar puli haydovchiga tegishli. O‘tkazma avtomatik emas:
        pulni o‘tkazib, shu yerda yozing. Hozir o‘tkazish mumkin bo‘lgani balansdan oshmaydi
        (komissiya, soliq va qarzlar avval ushlanadi).
      </p>
      {payouts.error ? (
        <ErrorBox error={payouts.error} onRetry={() => void payouts.refetch()} />
      ) : payouts.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="To‘lanadigan pul yo‘q">
          Hech bir haydovchiga karta safarlari puli qarz emasmiz.
        </Empty>
      ) : (
        <div className="card table-card">
          <p className="table-note small">
            <strong>{rows.length}</strong> ta haydovchi, qarzimiz <strong>{som(total)}</strong>,
            hozir o‘tkazish mumkin <strong>{som(payable)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Holat</th>
                <th className="num">Karta puli</th>
                <th className="num">O‘tkazilgan</th>
                <th className="num">Qarzimiz</th>
                <th className="num">Hozir mumkin</th>
                <th>Oxirgi o‘tkazma</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.driverId}>
                  <td>
                    <Link to={`/drivers/${d.driverId}`}>
                      <strong>{d.fullName}</strong>
                    </Link>
                    <div className="muted small">{formatPhone(d.phone)}</div>
                  </td>
                  <td>{DRIVER_STATUS[d.status]}</td>
                  <td className="num">{som(d.credited)}</td>
                  <td className="num">{som(d.paidOut)}</td>
                  <td className="num">
                    <strong>{som(d.owed)}</strong>
                  </td>
                  <td className="num">
                    {som(d.payableNow)}
                    {d.payableNow < d.owed && (
                      <div className="muted small">balans {som(d.balance)}</div>
                    )}
                  </td>
                  <td className="nowrap">{d.lastPayoutAt ? dateTime(d.lastPayoutAt) : '—'}</td>
                  <td className="actions">
                    <Button
                      size="sm"
                      icon={<Banknote size={14} />}
                      disabled={d.payableNow <= 0}
                      onClick={() => setPaying(d)}
                    >
                      Pul o‘tkazish
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PayoutDialog payout={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Cash handed in at the office; card top-ups (Payme/Click) show in the same ledger. */
function TopupsTab() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('driver');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const found = useDrivers('all', query);
  const chosen = useDriver(selectedId ?? undefined);
  const selected = selectedId ? (chosen.data ?? null) : null;
  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('driver', id);
    else next.delete('driver');
    setParams(next, { replace: true });
  };
  return (
    <div className="topups-layout">
      <section className="card">
        <h2>Haydovchi</h2>
        <div className="search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Ism, telefon yoki davlat raqami"
            placeholder="Ism, telefon yoki davlat raqami"
            value={q}
            maxLength={50}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        {found.error ? (
          <ErrorBox error={found.error} onRetry={() => void found.refetch()} />
        ) : found.isPending ? (
          <Loading />
        ) : !found.data.length ? (
          <Empty title="Haydovchi topilmadi" />
        ) : (
          <ul className="pick-list">
            {found.data.slice(0, 30).map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  className={d.id === selectedId ? 'is-selected' : ''}
                  aria-pressed={d.id === selectedId}
                  onClick={() => select(d.id)}
                >
                  <span>
                    <strong>{d.fullName}</strong>
                    <span className="muted small">
                      {' '}
                      {formatPhone(d.phone)}
                      {d.plateFormatted && ` · ${d.plateFormatted}`}
                    </span>
                  </span>
                  <span className={`small${d.balance < 0 ? ' negative' : ''}`}>
                    {som(d.balance)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div>
        {selectedId && chosen.error ? (
          <ErrorBox error={chosen.error} onRetry={() => void chosen.refetch()} />
        ) : selectedId && chosen.isPending ? (
          <Loading />
        ) : selected ? (
          <>
            {selected.status !== 'active' && (
              <div className="alert alert-warn">
                Holati: <Badge>{DRIVER_STATUS[selected.status]}</Badge>
              </div>
            )}
            <LedgerCard
              key={selected.id}
              driver={selected}
              kinds={['topup', 'payout']}
              filter={['topup', 'payout']}
              title={`${selected.fullName}: balans`}
            />
            <p className="small">
              <Link to={`/payments?tab=intents&purpose=topup&driverId=${selected.id}`}>
                <CreditCard size={13} aria-hidden /> Karta orqali to‘ldirishlari
              </Link>
            </p>
          </>
        ) : (
          <Empty title="Haydovchini tanlang">
            Naqd pul qabul qilinganda yozing. Karta orqali to‘ldirishlar (Payme, Click) avtomatik
            tushadi va shu ro‘yxatda ko‘rinadi.
          </Empty>
        )}
      </div>
    </div>
  );
}

/** Money: card payments, refunds of cancelled card rides, payouts of card money, top-ups. */
export default function Payments() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'refunds';
  const refunds = useRefunds();
  return (
    <div>
      <PageHeader
        title="To‘lovlar"
        subtitle="Karta to‘lovlari, ularni qaytarish, haydovchilarga pul o‘tkazish va balans to‘ldirish"
      />
      <div className="filters">
        <Segmented
          label="Bo‘lim"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            {
              value: 'refunds',
              label: `Qaytarishlar${refunds.data?.length ? ` (${refunds.data.length})` : ''}`,
            },
            { value: 'intents', label: 'Karta to‘lovlari' },
            { value: 'payouts', label: 'Haydovchilarga to‘lov' },
            { value: 'topups', label: 'Balans to‘ldirish' },
          ]}
        />
      </div>
      {tab === 'intents' ? (
        <IntentsTab />
      ) : tab === 'payouts' ? (
        <PayoutsTab />
      ) : tab === 'topups' ? (
        <TopupsTab />
      ) : (
        <RefundsTab />
      )}
    </div>
  );
}
