import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  CircleX,
  FileText,
  ShieldCheck,
  Undo2,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, errorText, fieldErrors } from '../api/client';
import { useDriver, useLedger, useLive } from '../api/queries';
import {
  type AdminDriver,
  type DriverDecision,
  type DriverDocument,
  type RideClass,
  type Standing,
  VEHICLE_FEATURES,
  type VehicleFeature,
} from '../api/types';
import { approvalChecks, expiryState, isImageUrl } from '../lib/drivers';
import {
  ACTORS,
  ago,
  CLASSES,
  date,
  dateTime,
  DOCUMENTS,
  DRIVER_STATE,
  DRIVER_STATUS,
  DRIVER_STATUS_TONE,
  FEATURES,
  fullYears,
  LEDGER_KINDS,
  percent,
  rating,
  signedSom,
  som,
  tashkentToday,
} from '../lib/format';
import { Badge, Button, Field, MoneyInput, PageHeader, PhoneLink, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

const DECISIONS: Record<
  DriverDecision,
  { title: string; button: string; danger: boolean; reasonRequired: boolean; hint: string }
> = {
  approve: {
    title: 'Arizani tasdiqlash',
    button: 'Tasdiqlash',
    danger: false,
    reasonRequired: false,
    hint: 'Haydovchi liniyaga chiqishi mumkin bo‘ladi.',
  },
  reject: {
    title: 'Arizani rad etish',
    button: 'Rad etish',
    danger: true,
    reasonRequired: true,
    hint: 'Sabab haydovchiga ko‘rinadi: nimani to‘g‘rilashi kerakligini yozing.',
  },
  block: {
    title: 'Haydovchini bloklash',
    button: 'Bloklash',
    danger: true,
    reasonRequired: true,
    hint: 'Smena darhol tugaydi, takliflar qaytarib olinadi. Sabab haydovchiga ko‘rinadi.',
  },
  unblock: {
    title: 'Blokdan chiqarish',
    button: 'Blokdan chiqarish',
    danger: false,
    reasonRequired: true,
    hint: 'Sabab tarixda saqlanadi.',
  },
};

function DecisionDialog({
  driver,
  decision,
  onClose,
}: {
  driver: AdminDriver;
  decision: DriverDecision;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const d = DECISIONS[decision];
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const text = reason.trim();
  const invalid =
    (d.reasonRequired || text) && text.length < 3 ? 'Sababni yozing (kamida 3 ta belgi)' : null;
  const failing =
    decision === 'approve' ? approvalChecks(driver, tashkentToday()).filter((c) => !c.ok) : [];

  const decide = useMutation({
    mutationFn: () =>
      api<AdminDriver>(`/v1/admin/drivers/${driver.id}/${decision}`, {
        method: 'POST',
        body: { reason: text || null },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['driver', driver.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      toast(`${updated.fullName}: ${DRIVER_STATUS[updated.status]}`);
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={d.title}
      size="sm"
      busy={decide.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={decide.isPending}>
            Qaytish
          </Button>
          <Button
            variant={d.danger ? 'danger' : 'primary'}
            loading={decide.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) decide.mutate();
            }}
          >
            {d.button}
          </Button>
        </>
      }
    >
      <p>
        <strong>{driver.fullName}</strong> — {d.hint}
      </p>
      {failing.length > 0 && (
        <div className="alert alert-warn">
          Talablar bajarilmagan: {failing.map((c) => c.label).join('; ')}. Server tasdiqlashni rad
          etadi.
        </div>
      )}
      <Field
        label={d.reasonRequired ? 'Sabab' : 'Izoh (ixtiyoriy)'}
        error={(touched && invalid) || (decide.error ? errorText(decide.error) : null)}
      >
        {(p) => (
          <textarea
            {...p}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
        )}
      </Field>
    </Modal>
  );
}

function DocumentTile({
  doc,
  today,
  onOpen,
}: {
  doc: DriverDocument;
  today: string;
  onOpen: () => void;
}) {
  const state = expiryState(doc.expiresOn, today);
  return (
    <li className="doc-tile">
      <button
        type="button"
        className="doc-preview"
        onClick={onOpen}
        aria-label={`${DOCUMENTS[doc.kind]}: kattalashtirish`}
      >
        {isImageUrl(doc.url) ? (
          <img src={doc.url} alt="" loading="lazy" />
        ) : (
          <FileText size={32} aria-hidden />
        )}
      </button>
      <div className="doc-meta">
        <strong>{DOCUMENTS[doc.kind]}</strong>
        <span className="muted small">yuklangan {date(doc.uploadedAt)}</span>
        {doc.expiresOn && (
          <Badge tone={state === 'expired' ? 'red' : state === 'soon' ? 'amber' : 'neutral'}>
            {state === 'expired' ? 'muddati o‘tgan' : 'amal qiladi'} {date(doc.expiresOn)}
          </Badge>
        )}
        <a href={doc.url} target="_blank" rel="noreferrer noopener" className="small">
          Asl faylni ochish
        </a>
      </div>
    </li>
  );
}

function VehicleEditor({ driver }: { driver: AdminDriver }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const v = driver.vehicle!;
  const [rideClass, setRideClass] = useState<RideClass>(v.class);
  const [features, setFeatures] = useState<VehicleFeature[]>(v.features);
  const changed =
    rideClass !== v.class ||
    features.length !== v.features.length ||
    features.some((f) => !v.features.includes(f));
  const save = useMutation({
    mutationFn: () =>
      api<AdminDriver>(`/v1/admin/drivers/${driver.id}/vehicle`, {
        method: 'PATCH',
        body: { class: rideClass, features },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['driver', driver.id], updated);
      toast('Avtomobil ma’lumotlari saqlandi');
    },
  });
  return (
    <div className="vehicle-editor">
      <Segmented
        label="Avtomobil sinfi"
        value={rideClass}
        onChange={setRideClass}
        options={[
          { value: 'economy', label: CLASSES.economy },
          { value: 'comfort', label: CLASSES.comfort },
        ]}
      />
      <div className="toggles" role="group" aria-label="Imkoniyatlar">
        {VEHICLE_FEATURES.map((f) => (
          <label key={f} className="check">
            <input
              type="checkbox"
              checked={features.includes(f)}
              onChange={(e) =>
                setFeatures((list) =>
                  e.target.checked ? [...list, f] : list.filter((x) => x !== f),
                )
              }
            />
            {FEATURES[f]}
          </label>
        ))}
      </div>
      {save.error && <ErrorBox error={save.error} />}
      <Button
        size="sm"
        variant="primary"
        disabled={!changed}
        loading={save.isPending}
        onClick={() => save.mutate()}
      >
        Saqlash
      </Button>
    </div>
  );
}

function LedgerCard({ driver }: { driver: AdminDriver }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const ledger = useLedger(driver.id, cursor);
  const [kind, setKind] = useState<'topup' | 'adjustment'>('topup');
  const [amount, setAmount] = useState<number | null>(null);
  const [negative, setNegative] = useState(false);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const signed = amount === null ? null : kind === 'adjustment' && negative ? -amount : amount;
  const local: Record<string, string> = {};
  if (!amount) local.amount = 'Summani kiriting';
  if (kind === 'adjustment' && note.trim().length < 1) local.note = 'Tuzatish uchun izoh yozing';

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
      setCursors([null]);
      setAmount(null);
      setNote('');
      setSubmitted(false);
      toast(`Balans: ${som(standing.balance)}`);
    },
  });
  const server = fieldErrors(record.error);

  const submit = async () => {
    setSubmitted(true);
    if (Object.keys(local).length || signed === null) return;
    const ok = await confirm({
      title: kind === 'topup' ? 'Balansni to‘ldirish' : 'Balansni tuzatish',
      text: (
        <p>
          {driver.fullName}: <strong>{signedSom(signed)} so‘m</strong>
          {kind === 'topup' ? ' naqd qabul qilindi.' : `. Izoh: ${note.trim()}`}
        </p>
      ),
      confirm: 'Yozish',
    });
    if (ok) record.mutate();
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <Wallet size={17} aria-hidden /> Balans
        </h2>
        <strong className={`balance${driver.balance < 0 ? ' negative' : ''}`}>
          {som(driver.balance)}
        </strong>
      </div>
      <div className="ledger-form">
        <Segmented
          label="Yozuv turi"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'topup', label: 'Naqd to‘ldirish' },
            { value: 'adjustment', label: 'Tuzatish' },
          ]}
        />
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
            label={kind === 'adjustment' ? 'Izoh' : 'Izoh (ixtiyoriy)'}
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
      ) : !ledger.data.items.length ? (
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
              {ledger.data.items.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{dateTime(e.createdAt)}</td>
                  <td>{LEDGER_KINDS[e.kind]}</td>
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

/** Everything to verify and manage one driver (market analysis O3). */
export default function DriverPage() {
  const { driverId } = useParams();
  const driver = useDriver(driverId);
  const live = useLive(15_000);
  const [decision, setDecision] = useState<DriverDecision | null>(null);
  const [preview, setPreview] = useState<DriverDocument | null>(null);
  const today = tashkentToday();

  if (driver.isPending) return <Loading />;
  if (driver.error) return <ErrorBox error={driver.error} onRetry={() => void driver.refetch()} />;
  const d = driver.data;
  const checks = approvalChecks(d, today);
  const cardState = expiryState(d.licenceCard.expiresOn, today);
  const onBoard = live.data?.drivers.find((x) => x.id === d.id);
  const currentRide = onBoard?.rideId ?? onBoard?.offeredRideId ?? null;

  return (
    <div className="driver-page">
      <Link to="/drivers" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Haydovchilar
      </Link>
      <PageHeader
        title={d.fullName}
        subtitle={
          <>
            <Badge tone={DRIVER_STATUS_TONE[d.status]}>{DRIVER_STATUS[d.status]}</Badge>{' '}
            {d.isOnline && (
              <Badge tone="green">Onlayn {onBoard ? `· ${DRIVER_STATE[onBoard.state]}` : ''}</Badge>
            )}{' '}
            <PhoneLink phone={d.phone} />
          </>
        }
        actions={
          <>
            {d.status === 'pending' && (
              <>
                <Button
                  variant="success"
                  icon={<CircleCheck size={16} />}
                  onClick={() => setDecision('approve')}
                >
                  Tasdiqlash
                </Button>
                <Button
                  variant="danger"
                  icon={<CircleX size={16} />}
                  onClick={() => setDecision('reject')}
                >
                  Rad etish
                </Button>
              </>
            )}
            {(d.status === 'active' || d.status === 'pending') && (
              <Button
                variant="danger"
                icon={<Ban size={16} />}
                onClick={() => setDecision('block')}
              >
                Bloklash
              </Button>
            )}
            {d.status === 'blocked' && (
              <Button icon={<Undo2 size={16} />} onClick={() => setDecision('unblock')}>
                Blokdan chiqarish
              </Button>
            )}
          </>
        }
      />
      {d.statusReason && (
        <div className={`alert ${d.status === 'blocked' ? 'alert-error' : 'alert-warn'}`}>
          Sabab: {d.statusReason}
        </div>
      )}
      {cardState !== 'ok' && (
        <div className={`alert ${cardState === 'expired' ? 'alert-error' : 'alert-warn'}`}>
          Litsenziya kartochkasi {cardState === 'expired' ? 'muddati o‘tgan' : 'muddati tugayapti'}:{' '}
          {date(d.licenceCard.expiresOn)}
        </div>
      )}
      {currentRide && (
        <div className="alert alert-info">
          Hozir buyurtmada: <Link to={`/dispatch?ride=${currentRide}`}>xaritada ochish</Link>
        </div>
      )}

      <div className="driver-grid">
        <div className="driver-col">
          {d.status === 'pending' && (
            <section className="card">
              <h2>
                <ShieldCheck size={17} aria-hidden /> Tekshiruv ro‘yxati
              </h2>
              <ul className="checklist">
                {checks.map((c) => (
                  <li key={c.label} className={c.ok ? 'is-ok' : 'is-bad'}>
                    {c.ok ? (
                      <CircleCheck size={16} aria-label="bajarilgan" />
                    ) : (
                      <CircleX size={16} aria-label="bajarilmagan" />
                    )}
                    <span>
                      {c.label}
                      {c.detail && <span className="muted small"> — {c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2>Shaxsiy ma’lumotlar</h2>
            <dl className="facts facts-2">
              <div>
                <dt>Tug‘ilgan sana</dt>
                <dd>
                  {date(d.birthDate)} ({fullYears(d.birthDate, today)} yosh)
                </dd>
              </div>
              <div>
                <dt>JShShIR (PINFL)</dt>
                <dd className="mono">{d.pinfl}</dd>
              </div>
              <div>
                <dt>Guvohnoma</dt>
                <dd>
                  <span className="mono">{d.licence.number}</span> ·{' '}
                  {d.licence.categories.join(', ')}
                </dd>
              </div>
              <div>
                <dt>Berilgan (staj)</dt>
                <dd>
                  {date(d.licence.issuedOn)} ({fullYears(d.licence.issuedOn, today)} yil)
                </dd>
              </div>
              <div>
                <dt>Litsenziya kartochkasi</dt>
                <dd className="mono">{d.licenceCard.number}</dd>
              </div>
              <div>
                <dt>Amal qiladi</dt>
                <dd>{date(d.licenceCard.expiresOn)}</dd>
              </div>
              <div>
                <dt>Ariza</dt>
                <dd>{dateTime(d.createdAt)}</dd>
              </div>
              {d.approvedAt && (
                <div>
                  <dt>Tasdiqlangan</dt>
                  <dd>{dateTime(d.approvedAt)}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="card">
            <h2>Avtomobil</h2>
            {d.vehicle ? (
              <>
                <p>
                  <strong>
                    {d.vehicle.colour} {d.vehicle.make} {d.vehicle.model}
                  </strong>{' '}
                  · {d.vehicle.year} · {d.vehicle.seats} o‘rin
                </p>
                <p>
                  <span className="plate plate-lg">{d.vehicle.plateFormatted}</span>
                </p>
                <VehicleEditor key={JSON.stringify(d.vehicle)} driver={d} />
              </>
            ) : (
              <p className="muted">Avtomobil ma’lumotlari yo‘q</p>
            )}
          </section>

          <section className="card">
            <h2>Hujjatlar</h2>
            {d.missingDocuments.length > 0 && (
              <div className="alert alert-warn">
                Yuklanmagan: {d.missingDocuments.map((k) => DOCUMENTS[k]).join(', ')}
              </div>
            )}
            {d.documents.length ? (
              <ul className="doc-grid">
                {d.documents.map((doc) => (
                  <DocumentTile
                    key={doc.kind}
                    doc={doc}
                    today={today}
                    onOpen={() => setPreview(doc)}
                  />
                ))}
              </ul>
            ) : (
              <Empty title="Hujjat yuklanmagan" />
            )}
          </section>
        </div>

        <div className="driver-col">
          <section className="card">
            <h2>Ustuvorlik va statistika</h2>
            <div className="score">
              <strong>{d.priority.score}</strong>
              <span className="muted">/ 100</span>
            </div>
            <dl className="facts facts-2">
              <div>
                <dt>Qabul qilish (40%)</dt>
                <dd>{percent(d.priority.acceptance)}</dd>
              </div>
              <div>
                <dt>Ishonchlilik (30%)</dt>
                <dd>{percent(d.priority.reliability)}</dd>
              </div>
              <div>
                <dt>Reyting (30%)</dt>
                <dd>
                  {rating(d.priority.stars)} ★ ({d.stats.ratingCount} baho)
                </dd>
              </div>
              <div>
                <dt>Takliflar</dt>
                <dd>
                  {d.stats.offersAccepted} / {d.stats.offersReceived} qabul
                </dd>
              </div>
              <div>
                <dt>Safarlar</dt>
                <dd>{d.stats.ridesCompleted} yakunlangan</dd>
              </div>
              <div>
                <dt>Tashlab ketgan</dt>
                <dd>{d.stats.ridesCancelled}</dd>
              </div>
              <div>
                <dt>Smena</dt>
                <dd>{d.isOnline ? `liniyada ${ago(d.onlineSince)}` : 'liniyada emas'}</dd>
              </div>
              <div>
                <dt>GPS</dt>
                <dd>{d.location?.at ? ago(d.location.at) : '—'}</dd>
              </div>
            </dl>
          </section>

          <LedgerCard driver={d} />

          <section className="card">
            <h2>Holatlar tarixi</h2>
            {d.history.length ? (
              <ol className="timeline">
                {d.history.map((h, i) => (
                  <li key={`${h.at}-${i}`}>
                    <time dateTime={h.at}>{dateTime(h.at)}</time>
                    <div>
                      <strong>
                        {DRIVER_STATUS[h.from as keyof typeof DRIVER_STATUS] ?? h.from} →{' '}
                        {DRIVER_STATUS[h.to as keyof typeof DRIVER_STATUS] ?? h.to}
                      </strong>
                      <span className="muted small">
                        {' '}
                        · {h.actorId === d.id ? ACTORS.driver : ACTORS.operator}
                      </span>
                      {h.reason && <div className="small">{h.reason}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted small">Hali qaror qabul qilinmagan.</p>
            )}
          </section>
        </div>
      </div>

      {decision && (
        <DecisionDialog driver={d} decision={decision} onClose={() => setDecision(null)} />
      )}
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={preview ? DOCUMENTS[preview.kind] : ''}
        size="lg"
      >
        {preview &&
          (isImageUrl(preview.url) ? (
            <img src={preview.url} alt={DOCUMENTS[preview.kind]} className="doc-full" />
          ) : (
            <p>
              <a href={preview.url} target="_blank" rel="noreferrer noopener">
                Faylni yangi oynada ochish
              </a>
            </p>
          ))}
      </Modal>
    </div>
  );
}
