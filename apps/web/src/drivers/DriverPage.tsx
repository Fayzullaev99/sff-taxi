import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Camera,
  CircleCheck,
  CircleX,
  ClipboardList,
  CreditCard,
  ShieldCheck,
  Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, errorText } from '../api/client';
import { type RideFilters, useDriver, useDriverRides, useLive } from '../api/queries';
import {
  type AdminDriver,
  type DriverDecision,
  type DriverDocument,
  type RideClass,
  VEHICLE_FEATURES,
  type VehicleFeature,
} from '../api/types';
import { LedgerCard } from '../billing/LedgerCard';
import { approvalChecks, approvalProblems, expiryState } from '../lib/drivers';
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
  LICENCE_STATUS,
  LICENCE_TONE,
  percent,
  rating,
  RIDE_STATUS_SHORT,
  som,
  tashkentToday,
} from '../lib/format';
import { RideRows } from '../rides/RideRows';
import { Badge, Button, Field, PageHeader, PhoneLink, Segmented, Toggle } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';
import { DocumentPreview, DocumentTile } from './Documents';
import { LicencePanel } from './LicencePanel';

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
      void queryClient.invalidateQueries({ queryKey: ['appeals'] });
      toast(`${updated.fullName}: ${DRIVER_STATUS[updated.status]}`);
      onClose();
    },
  });
  // 422: the rules the server found unmet (a licence card not verified, a document missing)
  const refused =
    decide.error instanceof ApiError && decide.error.status === 422
      ? approvalProblems(decide.error.body)
      : [];

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
      {failing.length > 0 && refused.length === 0 && (
        <div className="alert alert-warn">
          Talablar bajarilmagan: {failing.map((c) => c.label).join('; ')}. Server tasdiqlashni rad
          etadi.
        </div>
      )}
      {refused.length > 0 && (
        <div className="alert alert-error" role="alert">
          <div>
            <strong>Server tasdiqlamadi:</strong>
            <ul className="problems">
              {refused.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <Field
        label={d.reasonRequired ? 'Sabab' : 'Izoh (ixtiyoriy)'}
        error={
          (touched && invalid) || (decide.error && !refused.length ? errorText(decide.error) : null)
        }
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

function VehicleEditor({ driver }: { driver: AdminDriver }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const v = driver.vehicle!;
  const [rideClass, setRideClass] = useState<RideClass>(v.class);
  const [features, setFeatures] = useState<VehicleFeature[]>(v.features);
  const [cng, setCng] = useState(v.cngInTrunk ?? false);
  const changed =
    rideClass !== v.class ||
    cng !== (v.cngInTrunk ?? false) ||
    features.length !== v.features.length ||
    features.some((f) => !v.features.includes(f));
  const save = useMutation({
    mutationFn: () =>
      api<AdminDriver>(`/v1/admin/drivers/${driver.id}/vehicle`, {
        method: 'PATCH',
        body: { class: rideClass, features, cngInTrunk: cng },
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
      <Toggle
        checked={cng}
        onChange={setCng}
        label="Yukxonada gaz ballon (katta yukli buyurtmalar bormaydi)"
      />
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

/** Card-ride fares the platform holds for the driver, what was paid out and what is due. */
function CardMoneyCard({ driver }: { driver: AdminDriver }) {
  const m = driver.cardMoney!;
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <CreditCard size={17} aria-hidden /> Karta safarlari puli
        </h2>
        <Link to="/payments?tab=payouts" className="small">
          Haydovchilarga to‘lov
        </Link>
      </div>
      <dl className="facts facts-2">
        <div>
          <dt>Tushgan</dt>
          <dd>{som(m.credited)}</dd>
        </div>
        <div>
          <dt>O‘tkazilgan</dt>
          <dd>{som(m.paidOut)}</dd>
        </div>
        <div>
          <dt>Qarzimiz</dt>
          <dd>
            <strong>{som(m.owed)}</strong>
          </dd>
        </div>
        <div>
          <dt>Hozir o‘tkazish mumkin</dt>
          <dd>{som(m.payableNow)}</dd>
        </div>
        <div>
          <dt>Oxirgi o‘tkazma</dt>
          <dd>{m.lastPayoutAt ? dateTime(m.lastPayoutAt) : '—'}</dd>
        </div>
        <div>
          <dt>Karta to‘lovlari</dt>
          <dd>
            <Link to={`/payments?tab=intents&driverId=${driver.id}`}>to‘ldirishlar</Link>
          </dd>
        </div>
      </dl>
      {m.payableNow < m.owed && (
        <p className="muted small">
          Balans {som(driver.balance)}: komissiya, soliq va qarzlar avval ushlanadi.
        </p>
      )}
    </section>
  );
}

type RideTab = Extract<RideFilters['status'], 'all' | 'open' | 'completed' | 'cancelled'>;

/** The driver's rides from the API (GET /admin/drivers/:id/rides), newest first, paged. */
function DriverRides({ driverId }: { driverId: string }) {
  const [status, setStatus] = useState<RideTab>('all');
  const rides = useDriverRides(driverId, { status });
  const rows = useMemo(() => rides.data?.pages.flat() ?? [], [rides.data]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          <ClipboardList size={17} aria-hidden /> Safarlari
        </h2>
        <Link to={`/rides?status=all&driverId=${driverId}`} className="small">
          Safarlar ro‘yxatida filtrlash
        </Link>
      </div>
      <Segmented
        label="Safar holati"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'all', label: 'Hammasi' },
          { value: 'open', label: 'Ochiq' },
          { value: 'completed', label: RIDE_STATUS_SHORT.completed },
          { value: 'cancelled', label: RIDE_STATUS_SHORT.cancelled },
        ]}
      />
      {rides.error ? (
        <ErrorBox error={rides.error} onRetry={() => void rides.refetch()} />
      ) : rides.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Safar yo‘q" />
      ) : (
        <RideRows
          rides={rows}
          showDriver={false}
          hasMore={rides.hasNextPage}
          loadingMore={rides.isFetchingNextPage}
          onMore={() => void rides.fetchNextPage()}
        />
      )}
    </section>
  );
}

/** Everything to verify and manage one driver (market analysis O3). */
export default function DriverPage() {
  const { driverId } = useParams();
  const driver = useDriver(driverId);
  const live = useLive();
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
  const photos = [
    { key: 'face', label: 'Haydovchi surati', url: d.photoUrl ?? null },
    { key: 'car', label: 'Avtomobil surati', url: d.vehicle?.photoUrl ?? null },
  ];

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
            <Badge tone={LICENCE_TONE[d.licenceCard.verification]}>
              {LICENCE_STATUS[d.licenceCard.verification]}
            </Badge>{' '}
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
      {d.licenceCard.verification !== 'valid' && (
        <div
          className={`alert ${d.licenceCard.verification === 'invalid' ? 'alert-error' : 'alert-warn'}`}
        >
          {d.licenceCard.verification === 'invalid'
            ? 'Litsenziya kartochkasi reyestrda tasdiqlanmadi: liniyaga chiqolmaydi.'
            : 'Litsenziya kartochkasi reyestrda tekshirilmagan: tasdiqlash uchun avval tekshiring.'}
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

          <LicencePanel driver={d} />

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
            <h2>
              <Camera size={17} aria-hidden /> Yo‘lovchilar ko‘radigan suratlar
            </h2>
            <ul className="photo-row">
              {photos.map((p) => (
                <li key={p.key}>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer noopener">
                      <img src={p.url} alt={p.label} loading="lazy" />
                    </a>
                  ) : (
                    <span className="photo-missing">Yuklanmagan</span>
                  )}
                  <span className="small muted">{p.label}</span>
                </li>
              ))}
            </ul>
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
                  {rating(d.priority.stars)} ★ ({d.stats.ratingCount} baho){' '}
                  <Link to={`/ratings?subjectId=${d.id}&of=driver`} className="small">
                    baholar
                  </Link>
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

          {d.cardMoney && <CardMoneyCard driver={d} />}

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

      {d.status !== 'pending' && <DriverRides driverId={d.id} />}

      {decision && (
        <DecisionDialog driver={d} decision={decision} onClose={() => setDecision(null)} />
      )}
      <DocumentPreview doc={preview} onClose={() => setPreview(null)} />
    </div>
  );
}
