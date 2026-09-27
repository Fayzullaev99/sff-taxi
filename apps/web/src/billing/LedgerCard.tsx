import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, fieldErrors } from '../api/client';
import { useLedger } from '../api/queries';
import type { AdminDriver, LedgerKind, Standing } from '../api/types';
import { dateTime, LEDGER_KINDS, signedSom, som } from '../lib/format';
import { type EntryKind, entryProblems } from '../lib/ops';
import { Button, Field, MoneyInput, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';

const KIND_LABEL: Record<EntryKind, string> = {
  topup: 'Naqd to‘ldirish',
  payout: 'Pul o‘tkazish',
  adjustment: 'Tuzatish',
};

/** The ledger kinds a filter shows; null shows everything. */
function visible(kinds: LedgerKind[] | null, kind: LedgerKind) {
  return !kinds || kinds.includes(kind);
}

/**
 * A driver's balance: record a cash top-up at the office, a payout of card-ride money
 * (a debit, with the transfer reference) or a signed correction; below, the ledger
 * (card top-ups arrive from Payme/Click as "To‘ldirish" entries with the provider's name).
 */
export function LedgerCard({
  driver,
  kinds = ['topup', 'payout', 'adjustment'],
  filter = null,
  title = 'Balans',
}: {
  driver: Pick<AdminDriver, 'id' | 'fullName' | 'balance'>;
  kinds?: EntryKind[];
  /** Show only these ledger kinds (e.g. top-ups and payouts). */
  filter?: LedgerKind[] | null;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const ledger = useLedger(driver.id, cursor);
  const [kind, setKind] = useState<EntryKind>(kinds[0] ?? 'topup');
  const [amount, setAmount] = useState<number | null>(null);
  const [negative, setNegative] = useState(false);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // a payout is sent as a positive amount: the API debits it
  const signed = amount === null ? null : kind === 'adjustment' && negative ? -amount : amount;
  const local = entryProblems(kind, amount, note, driver.balance);

  const record = useMutation({
    mutationFn: () =>
      api<Standing>(`/v1/admin/billing/drivers/${driver.id}/ledger`, {
        method: 'POST',
        body: { kind, amount: signed, note: note.trim() || null },
      }),
    onSuccess: (standing) => {
      queryClient.setQueryData<AdminDriver>(['driver', driver.id], (d) =>
        d ? { ...d, balance: standing.balance } : d,
      );
      void queryClient.invalidateQueries({ queryKey: ['driver', driver.id] });
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      setCursors([null]);
      setAmount(null);
      setNote('');
      setSubmitted(false);
      toast(`${driver.fullName}: balans ${som(standing.balance)}`);
    },
  });
  const server = fieldErrors(record.error);

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(local).length || signed === null) return;
    const ok = await confirm({
      title: KIND_LABEL[kind],
      text: (
        <p>
          {driver.fullName}:{' '}
          <strong>{kind === 'payout' ? signedSom(-signed) : signedSom(signed)} so‘m</strong>
          {kind === 'topup'
            ? ' naqd qabul qilindi.'
            : kind === 'payout'
              ? ` haydovchiga o‘tkazildi (${note.trim()}).`
              : `. Izoh: ${note.trim()}`}
        </p>
      ),
      confirm: 'Yozish',
    });
    if (ok) record.mutate();
  };

  const items = ledger.data?.items.filter((e) => visible(filter, e.kind)) ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <Wallet size={17} aria-hidden /> {title}
        </h2>
        <strong className={`balance${driver.balance < 0 ? ' negative' : ''}`}>
          {som(driver.balance)}
        </strong>
      </div>
      <div className="ledger-form">
        {kinds.length > 1 && (
          <Segmented
            label="Yozuv turi"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setSubmitted(false);
            }}
            options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
        )}
        {kind === 'payout' && (
          <p className="muted small">
            Karta safarlari puli haydovchiga o‘tkazilganda yoziladi: balansdan ayiriladi.
          </p>
        )}
        <div className="grid-3 align-end">
          <Field label="Summa" error={submitted ? (local.amount ?? server.amount) : null}>
            {(p) => <MoneyInput {...p} value={amount} onChange={setAmount} />}
          </Field>
          {kind === 'adjustment' ? (
            <Field label="Yo‘nalish">
              {(p) => (
                <select
                  {...p}
                  value={negative ? 'minus' : 'plus'}
                  onChange={(e) => setNegative(e.target.value === 'minus')}
                >
                  <option value="plus">Qo‘shish (+)</option>
                  <option value="minus">Ayirish (−)</option>
                </select>
              )}
            </Field>
          ) : (
            <div />
          )}
          <Field
            label={
              kind === 'topup'
                ? 'Izoh (ixtiyoriy)'
                : kind === 'payout'
                  ? 'Qayerga, o‘tkazma raqami'
                  : 'Izoh'
            }
            error={submitted ? (local.note ?? server.note) : null}
          >
            {(p) => (
              <input
                {...p}
                value={note}
                maxLength={300}
                onChange={(e) => setNote(e.target.value)}
              />
            )}
          </Field>
        </div>
        {record.error && !Object.keys(server).length && <ErrorBox error={record.error} />}
        <Button
          variant="primary"
          size="sm"
          loading={record.isPending}
          onClick={() => void submit()}
        >
          Yozish
        </Button>
      </div>

      {ledger.error ? (
        <ErrorBox error={ledger.error} onRetry={() => void ledger.refetch()} />
      ) : ledger.isPending ? (
        <Loading />
      ) : !items.length ? (
        <Empty title="Yozuvlar yo‘q" />
      ) : (
        <div className="table-scroll">
          <table className="table compact">
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Tur</th>
                <th className="num">Summa</th>
                <th>Izoh / safar</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{dateTime(e.createdAt)}</td>
                  <td>{LEDGER_KINDS[e.kind] ?? e.kind}</td>
                  <td className={`num${e.amount < 0 ? ' negative' : ''}`}>{signedSom(e.amount)}</td>
                  <td>
                    {e.note}
                    {e.rideId && (
                      <>
                        {e.note ? ' · ' : ''}
                        <Link to={`/rides/${e.rideId}`}>safar</Link>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="pager">
        <Button
          size="sm"
          variant="ghost"
          disabled={cursors.length === 1}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          ← Yangiroq
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ledger.data?.nextCursor}
          onClick={() =>
            ledger.data?.nextCursor && setCursors((c) => [...c, ledger.data.nextCursor])
          }
        >
          Eskiroq →
        </Button>
      </div>
    </section>
  );
}
