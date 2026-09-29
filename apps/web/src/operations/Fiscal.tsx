import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RotateCw, Save } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorText } from '../api/client';
import { useFiscalRules, useReceipt, useReceipts } from '../api/queries';
import type { FiscalReceipt, FiscalRules, ReceiptStatus } from '../api/types';
import { dateTime, RECEIPT_STATUS, RECEIPT_TONE, som } from '../lib/format';
import { fiscalProblems, isPlaceholder } from '../lib/ops';
import { Badge, Button, Field, NumberInput, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { LoadMore } from '../ui/LoadMore';
import { Modal } from '../ui/Modal';

type Tab = 'receipts' | 'settings';

function Payload({ receipt }: { receipt: FiscalReceipt }) {
  const p = receipt.payload;
  if (!p) return <span className="muted">—</span>;
  const item = p.items?.[0];
  return (
    <details className="payload">
      <summary>
        {p.receiptNumber ?? 'chek'}
        {item && ` · MXIK ${item.mxik}`}
      </summary>
      <pre>{JSON.stringify(p, null, 2)}</pre>
    </details>
  );
}

/**
 * Sends one skipped or pending receipt again (POST receipts/:id/retry) after a confirmation;
 * a sent receipt is final. The receipt number stays the same: never issued twice.
 */
function useRetryReceipt() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const retry = useMutation({
    mutationFn: (id: string) =>
      api<FiscalReceipt>(`/v1/admin/fiscal/receipts/${id}/retry`, { method: 'POST' }),
    onSuccess: (receipt) => {
      queryClient.setQueryData(['fiscal', 'receipt', receipt.id], receipt);
      void queryClient.invalidateQueries({ queryKey: ['fiscal', 'receipts'] });
      toast(`Chek ${receipt.payload?.receiptNumber ?? ''} navbatga qo‘yildi`);
    },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const ask = (r: FiscalReceipt) =>
    void confirm({
      title: 'Chekni qayta yuborish',
      text:
        r.status === 'skipped'
          ? 'Saqlangan chek fiskal provayderga (OFD) yuboriladi. Chek raqami o‘zgarmaydi, ikki marta chiqmaydi.'
          : 'Yuborilmay turgan chek qayta navbatga qo‘yiladi. Chek raqami o‘zgarmaydi.',
      confirm: 'Qayta yuborish',
    }).then((ok) => ok && retry.mutate(r.id));
  return { retry, ask };
}

/** One receipt in full (GET receipts/:id): status, attempts, the error, the payload. */
function ReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const receipt = useReceipt(id);
  const { retry, ask } = useRetryReceipt();
  const r = receipt.data;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Chek ${r?.payload?.receiptNumber ?? ''}`}
      variant="drawer"
      footer={
        r && r.status !== 'sent' ? (
          <Button
            variant="primary"
            icon={<RotateCw size={15} />}
            loading={retry.isPending}
            onClick={() => ask(r)}
          >
            Qayta yuborish
          </Button>
        ) : undefined
      }
    >
      {receipt.error ? (
        <ErrorBox error={receipt.error} onRetry={() => void receipt.refetch()} />
      ) : !r ? (
        <Loading />
      ) : (
        <>
          <p>
            <Badge tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS[r.status]}</Badge>{' '}
            <strong>{som(r.amount)}</strong>
          </p>
          <dl className="facts facts-2">
            <div>
              <dt>Buyurtma</dt>
              <dd>
                {r.rideId ? (
                  <Link to={`/rides/${r.rideId}`}>safar #{r.payload?.orderNumber ?? ''}</Link>
                ) : (
                  <>shaharlararo bron #{r.payload?.orderNumber ?? ''}</>
                )}
              </dd>
            </div>
            <div>
              <dt>Provayder</dt>
              <dd>{r.provider}</dd>
            </div>
            <div>
              <dt>Tuzilgan</dt>
              <dd>{dateTime(r.createdAt)}</dd>
            </div>
            <div>
              <dt>Yuborilgan</dt>
              <dd>{r.sentAt ? dateTime(r.sentAt) : '—'}</dd>
            </div>
            <div>
              <dt>Urinishlar</dt>
              <dd>{r.attempts}</dd>
            </div>
            <div>
              <dt>Soliq tizimidagi raqami</dt>
              <dd className="mono">{r.receiptId ?? '—'}</dd>
            </div>
            {r.payload?.receivedCash !== undefined && (
              <div>
                <dt>Naqd</dt>
                <dd>{som(r.payload.receivedCash / 100)}</dd>
              </div>
            )}
            {r.payload?.receivedCard !== undefined && (
              <div>
                <dt>Karta</dt>
                <dd>{som(r.payload.receivedCard / 100)}</dd>
              </div>
            )}
          </dl>
          {r.lastError && (
            <div className="alert alert-error" role="alert">
              Oxirgi xato: {r.lastError}
            </div>
          )}
          {r.status === 'sent' && (
            <p className="muted small">Yuborilgan chek yakuniy: qayta yuborilmaydi.</p>
          )}
          {r.url && (
            <p>
              <a href={r.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={13} aria-hidden /> Chekni ochish (soliq.uz)
              </a>
            </p>
          )}
          {r.payload?.items && r.payload.items.length > 0 && (
            <div className="table-scroll">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Nomi</th>
                    <th>MXIK</th>
                    <th>Qadoq</th>
                    <th className="num">Narx</th>
                  </tr>
                </thead>
                <tbody>
                  {r.payload.items.map((item, i) => (
                    <tr key={i}>
                      <td>{item.name}</td>
                      <td className="mono">{item.mxik}</td>
                      <td className="mono">{item.packageCode}</td>
                      <td className="num">{som(item.price / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Payload receipt={r} />
        </>
      )}
    </Modal>
  );
}

function ReceiptsTab() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as ReceiptStatus | '';
  const openId = params.get('receipt');
  const receipts = useReceipts(status);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const one = useRetryReceipt();
  const rows = useMemo(() => receipts.data?.pages.flat() ?? [], [receipts.data]);
  const openReceipt = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('receipt', id);
    else next.delete('receipt');
    setParams(next, { replace: true });
  };
  const resend = useMutation({
    mutationFn: (which: 'skipped' | 'pending') =>
      api<{ queued: number }>('/v1/admin/fiscal/receipts/resend', {
        method: 'POST',
        body: { status: which },
      }),
    onSuccess: ({ queued }) => {
      void queryClient.invalidateQueries({ queryKey: ['fiscal', 'receipts'] });
      toast(queued ? `${queued} ta chek navbatga qo‘yildi` : 'Yuboriladigan chek yo‘q');
    },
  });
  const ask = (which: 'skipped' | 'pending') =>
    void confirm({
      title:
        which === 'skipped' ? 'Saqlangan cheklarni yuborish' : 'Osilib qolganlarni qayta yuborish',
      text:
        which === 'skipped'
          ? 'Fiskal provayder (OFD) ulangandan va MXIK kodlari kiritilgandan keyin bosing: saqlangan cheklar (500 tagacha) soliq tizimiga yuboriladi. Har bir chek raqami o‘zgarmaydi, ikki marta chiqmaydi.'
          : 'Yuborilmay turgan cheklar (500 tagacha) qayta navbatga qo‘yiladi.',
      confirm: 'Navbatga qo‘yish',
    }).then((ok) => ok && resend.mutate(which));

  return (
    <>
      <div className="filters">
        <Segmented
          label="Holat"
          value={status}
          onChange={(v) =>
            setParams(v ? { tab: 'receipts', status: v } : { tab: 'receipts' }, { replace: true })
          }
          options={[
            { value: '', label: 'Hammasi' },
            { value: 'pending', label: RECEIPT_STATUS.pending },
            { value: 'sent', label: RECEIPT_STATUS.sent },
            { value: 'skipped', label: 'Saqlangan' },
          ]}
        />
        <span className="filters-end">
          <Button
            size="sm"
            icon={<RotateCw size={14} />}
            loading={resend.isPending && resend.variables === 'pending'}
            onClick={() => ask('pending')}
          >
            Osilganlarni qayta yuborish
          </Button>
          <Button
            size="sm"
            variant="primary"
            loading={resend.isPending && resend.variables === 'skipped'}
            onClick={() => ask('skipped')}
          >
            Saqlanganlarni yuborish
          </Button>
        </span>
      </div>
      {resend.error && <ErrorBox error={resend.error} />}
      {receipts.error ? (
        <ErrorBox error={receipts.error} onRetry={() => void receipts.refetch()} />
      ) : receipts.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Chek yo‘q">
          Har bir yakunlangan safar va shaharlararo bron uchun chek tuziladi.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Tuzilgan</th>
                <th>Buyurtma</th>
                <th className="num">Summa</th>
                <th>Holat</th>
                <th>Chek</th>
                <th>
                  <span className="sr-only">Amal</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">
                    {dateTime(r.createdAt)}
                    {r.sentAt && <div className="muted small">yuborildi {dateTime(r.sentAt)}</div>}
                  </td>
                  <td>
                    {r.rideId ? (
                      <Link to={`/rides/${r.rideId}`}>safar #{r.payload?.orderNumber ?? ''}</Link>
                    ) : (
                      <span>shaharlararo bron #{r.payload?.orderNumber ?? ''}</span>
                    )}
                  </td>
                  <td className="num">{som(r.amount)}</td>
                  <td>
                    <Badge tone={RECEIPT_TONE[r.status]}>{RECEIPT_STATUS[r.status]}</Badge>
                    <div className="muted small">
                      {r.provider} · {r.attempts} urinish
                    </div>
                    {r.lastError && <div className="small negative clamp-2">{r.lastError}</div>}
                  </td>
                  <td className="cell-text">
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noreferrer noopener" className="small">
                        <ExternalLink size={12} aria-hidden /> Chekni ochish
                      </a>
                    )}
                    <Payload receipt={r} />
                  </td>
                  <td className="actions">
                    <Button size="sm" variant="ghost" onClick={() => openReceipt(r.id)}>
                      Batafsil
                    </Button>
                    {r.status !== 'sent' && (
                      <Button
                        size="sm"
                        icon={<RotateCw size={14} />}
                        loading={one.retry.isPending && one.retry.variables === r.id}
                        onClick={() => one.ask(r)}
                      >
                        Qayta yuborish
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore
            shown={rows.length}
            hasMore={receipts.hasNextPage}
            loading={receipts.isFetchingNextPage}
            onMore={() => void receipts.fetchNextPage()}
          />
        </div>
      )}
      {openId && <ReceiptDetail id={openId} onClose={() => openReceipt(null)} />}
    </>
  );
}

function SettingsTab() {
  const rules = useFiscalRules();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<FiscalRules | null>(null);
  useEffect(() => {
    if (rules.data) setDraft(rules.data);
  }, [rules.data]);
  const save = useMutation({
    mutationFn: (body: FiscalRules) =>
      api<FiscalRules>('/v1/admin/settings/fiscal', { method: 'PUT', body }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'fiscal'], saved);
      toast('Chek sozlamalari saqlandi');
    },
  });
  if (rules.error) return <ErrorBox error={rules.error} onRetry={() => void rules.refetch()} />;
  if (rules.isPending || !draft) return <Loading />;
  const errors = fiscalProblems(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(rules.data);
  const set = (patch: Partial<FiscalRules>) => setDraft({ ...draft, ...patch });

  return (
    <section className="card settings-form narrow-form">
      <h2>Chekdagi ma’lumotlar</h2>
      <p className="muted small">
        Platforma chekni o‘zini o‘zi band qilgan haydovchi nomidan (komissioner sifatida) beradi:
        haydovchining JShShIR chekka yoziladi. MXIK (IKPU) va qadoq kodlarini tasnif.soliq.uz dan
        soliq maslahatchisi bilan tasdiqlang.
      </p>
      {isPlaceholder(rules.data) && (
        <div className="alert alert-warn">
          MXIK kodi hali nollardan iborat: cheklar tuzilib saqlanadi, soliq tizimiga yuborilmaydi.
        </div>
      )}
      <div className="grid-2">
        <Field label="Shahar safari nomi" error={errors.city_item_name}>
          {(p) => (
            <input
              {...p}
              value={draft.city_item_name}
              maxLength={128}
              onChange={(e) => set({ city_item_name: e.target.value })}
            />
          )}
        </Field>
        <Field label="Shaharlararo o‘rindiq nomi" error={errors.intercity_item_name}>
          {(p) => (
            <input
              {...p}
              value={draft.intercity_item_name}
              maxLength={128}
              onChange={(e) => set({ intercity_item_name: e.target.value })}
            />
          )}
        </Field>
        {draft.cargo_item_name !== undefined && (
          <Field label="Yuk tashish nomi" error={errors.cargo_item_name}>
            {(p) => (
              <input
                {...p}
                value={draft.cargo_item_name ?? ''}
                maxLength={128}
                onChange={(e) => set({ cargo_item_name: e.target.value })}
              />
            )}
          </Field>
        )}
        {draft.delivery_item_name !== undefined && (
          <Field label="Yetkazish (posilka) nomi" error={errors.delivery_item_name}>
            {(p) => (
              <input
                {...p}
                value={draft.delivery_item_name ?? ''}
                maxLength={128}
                onChange={(e) => set({ delivery_item_name: e.target.value })}
              />
            )}
          </Field>
        )}
        <Field label="MXIK (IKPU) kodi" hint="17 ta raqam" error={errors.mxik_code}>
          {(p) => (
            <input
              {...p}
              className="mono"
              inputMode="numeric"
              value={draft.mxik_code}
              maxLength={17}
              onChange={(e) => set({ mxik_code: e.target.value.replace(/\D/g, '') })}
            />
          )}
        </Field>
        <Field label="Qadoq (o‘lchov birligi) kodi" error={errors.package_code}>
          {(p) => (
            <input
              {...p}
              className="mono"
              inputMode="numeric"
              value={draft.package_code}
              maxLength={10}
              onChange={(e) => set({ package_code: e.target.value.replace(/\D/g, '') })}
            />
          )}
        </Field>
        <Field
          label="QQS"
          hint="O‘zini o‘zi band qilganlar QQS to‘lamaydi: 0"
          error={errors.vat_percent}
        >
          {(p) => (
            <NumberInput
              {...p}
              decimals
              suffix="%"
              value={draft.vat_percent}
              onChange={(v) => set({ vat_percent: v ?? Number.NaN })}
            />
          )}
        </Field>
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <div className="form-actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(rules.data)}>
          Bekor qilish
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} />}
          disabled={!dirty || Object.keys(errors).length > 0}
          loading={save.isPending}
          onClick={() =>
            void confirm({
              title: 'Chek sozlamalarini saqlash',
              text: 'Yangi cheklar shu kodlar bilan tuziladi. Oldin tuzilganlar o‘zgarmaydi.',
              confirm: 'Saqlash',
            }).then((ok) => ok && save.mutate({ ...draft }))
          }
        >
          Saqlash
        </Button>
      </div>
    </section>
  );
}

/**
 * Electronic fiscal receipts (Resolution 200): every completed ride and seat gets one; they
 * are kept while no fiscal provider is connected and sent once it is. Settings: the item
 * names and the classifier codes.
 */
export default function Fiscal() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'receipts';
  return (
    <div>
      <PageHeader
        title="Fiskal cheklar"
        subtitle="Har bir safar va o‘rindiq uchun elektron chek (soliq tizimi, OFD orqali)"
      />
      <div className="filters">
        <Segmented
          label="Bo‘lim"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            { value: 'receipts', label: 'Cheklar' },
            { value: 'settings', label: 'MXIK va sozlamalar' },
          ]}
        />
      </div>
      {tab === 'settings' ? <SettingsTab /> : <ReceiptsTab />}
    </div>
  );
}
