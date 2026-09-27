import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Search, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorText, fieldErrors } from '../api/client';
import { useDriver, useDrivers, useRefunds } from '../api/queries';
import type { DriverListItem, Refund, Standing } from '../api/types';
import { ago, dateTime, DRIVER_STATUS, PROVIDERS, som } from '../lib/format';
import { formatPhone } from '../lib/phone';
import { useDebounced } from '../map/places';
import { Badge, Button, Field, MoneyInput, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';
import { TextDialog } from '../ui/TextDialog';
import { entryProblems } from '../lib/ops';
import { LedgerCard } from './LedgerCard';

type Tab = 'refunds' | 'payouts' | 'topups';

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
          Oldindan to‘langan karta safari bekor qilinsa, shu yerda paydo bo‘ladi.
        </Empty>
      ) : (
        <div className="card table-card">
          <p className="table-note small">
            <strong>{refunds.data.length}</strong> ta to‘lov, jami <strong>{som(total)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Safar</th>
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
                    <Link to={`/rides/${r.rideId}`}>#{r.rideNumber}</Link>
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
          title={`#${recording.rideNumber}: ${som(recording.amount)} qaytarildi`}
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
              void queryClient.invalidateQueries({ queryKey: ['ride', recording.rideId] });
              toast(`#${recording.rideNumber}: qaytarish yozildi`);
            })
          }
          onClose={() => setRecording(null)}
        />
      )}
    </>
  );
}

function PayoutDialog({ driver, onClose }: { driver: DriverListItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(driver.balance);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const local = entryProblems('payout', amount, note, driver.balance);
  const pay = useMutation({
    mutationFn: () =>
      api<Standing>(`/v1/admin/billing/drivers/${driver.id}/ledger`, {
        method: 'POST',
        body: { kind: 'payout', amount, note: note.trim() },
      }),
    onSuccess: (standing) => {
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['driver', driver.id] });
      toast(`${driver.fullName}: ${som(amount!)} o‘tkazildi, balans ${som(standing.balance)}`);
      onClose();
    },
  });
  const server = fieldErrors(pay.error);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${driver.fullName}: pul o‘tkazish`}
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
      <p>
        Balansda <strong>{som(driver.balance)}</strong> (karta safarlari puli). Pulni haydovchi
        kartasiga o‘tkazgandan keyin yozing: balansdan ayiriladi.
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

/** Drivers holding money on their balance (card-ride fares): pay it out and record it. */
function PayoutsTab() {
  const drivers = useDrivers('all');
  const [paying, setPaying] = useState<DriverListItem | null>(null);
  const owed = useMemo(
    () => (drivers.data ?? []).filter((d) => d.balance > 0).sort((a, b) => b.balance - a.balance),
    [drivers.data],
  );
  const total = owed.reduce((s, d) => s + d.balance, 0);
  return (
    <>
      <p className="muted small">
        Karta safarlari puli haydovchi balansiga tushadi. Musbat balansli haydovchilar — eng
        kattasidan. O‘tkazma avtomatik emas: pulni o‘tkazib, shu yerda yozing.
      </p>
      {drivers.error ? (
        <ErrorBox error={drivers.error} onRetry={() => void drivers.refetch()} />
      ) : drivers.isPending ? (
        <Loading />
      ) : !owed.length ? (
        <Empty title="To‘lanadigan pul yo‘q">Hech bir haydovchining balansi musbat emas.</Empty>
      ) : (
        <div className="card table-card">
          <p className="table-note small">
            <strong>{owed.length}</strong> ta haydovchi, jami <strong>{som(total)}</strong>
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Holat</th>
                <th className="num">Balans</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {owed.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/drivers/${d.id}`}>
                      <strong>{d.fullName}</strong>
                    </Link>
                    <div className="muted small">{formatPhone(d.phone)}</div>
                  </td>
                  <td>{DRIVER_STATUS[d.status]}</td>
                  <td className="num">{som(d.balance)}</td>
                  <td className="actions">
                    <Button size="sm" icon={<Banknote size={14} />} onClick={() => setPaying(d)}>
                      Pul o‘tkazish
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PayoutDialog driver={paying} onClose={() => setPaying(null)} />}
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

/** Money: refunds of cancelled card rides, payouts of card money, driver top-ups. */
export default function Payments() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'refunds';
  const refunds = useRefunds();
  return (
    <div>
      <PageHeader
        title="To‘lovlar"
        subtitle="Karta to‘lovlarini qaytarish, haydovchilarga pul o‘tkazish va balans to‘ldirish"
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
            { value: 'payouts', label: 'Haydovchilarga to‘lov' },
            { value: 'topups', label: 'Balans to‘ldirish' },
          ]}
        />
      </div>
      {tab === 'payouts' ? <PayoutsTab /> : tab === 'topups' ? <TopupsTab /> : <RefundsTab />}
    </div>
  );
}
