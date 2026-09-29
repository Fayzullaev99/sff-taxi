import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Car,
  CircleUserRound,
  ExternalLink,
  HandCoins,
  MapPin,
  RefreshCw,
  UserCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorText } from '../api/client';
import { useCandidates, useReasons, useRide } from '../api/queries';
import type { AdminRide, Candidate, LatLng, ReasonLabels } from '../api/types';
import {
  ACTORS,
  ago,
  CHANNELS,
  CLASSES,
  dateTime,
  DECLINE_REASONS,
  distance,
  duration,
  EVENTS,
  FEE_STATUS,
  FEE_TONE,
  OFFER_STATUS,
  OFFER_TONE,
  rating,
  RIDE_STATUS,
  RIDE_STATUS_TONE,
  som,
  PAYMENT_STATUS,
  reasonText,
  STAGES,
  time,
  timeSec,
} from '../lib/format';
import {
  canAssign,
  canCancel,
  eventDetail,
  needsDriver,
  optionsText,
  placeLine,
} from '../lib/rides';
import { rideTags, seatingText } from '../lib/pool';
import type { MapLayers, MarkerSpec } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { cityLayers } from '../map/places';
import { Badge, Button, PhoneLink } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { CancelRideDialog } from './CancelRideDialog';
import { WaiveFeeDialog } from './WaiveFeeDialog';

type Waivable = { rideId: string; number: number; amount: number };

/**
 * Cancellation fees: this ride's own (a cash ride cancelled with a fee: owed until the rider's
 * next cash ride collects it) and earlier rides' fees this ride collects in cash on top of its
 * fare. An owed fee can be waived with a note.
 */
function OwedFeesSection({ ride }: { ride: AdminRide }) {
  const [waiving, setWaiving] = useState<Waivable | null>(null);
  const own = ride.owedFees?.own ?? null;
  const collects = ride.owedFees?.collects ?? [];
  if (!own && !collects.length) return null;
  const collecting = ride.fare.owedFee ?? 0;
  return (
    <section className="detail-section">
      <h3>
        <HandCoins size={16} aria-hidden /> Bekor qilish to‘lovlari
      </h3>
      {own && (
        <div className="fee-row">
          <span>
            Shu safar uchun: <strong>{som(own.amount)}</strong>{' '}
            <Badge tone={FEE_TONE[own.status]}>{FEE_STATUS[own.status]}</Badge>
            {own.collectingRideId && own.status !== 'waived' && (
              <>
                {' '}
                <Link to={`/rides/${own.collectingRideId}`} className="small">
                  yig‘uvchi safar
                </Link>
              </>
            )}
            {own.waiveNote && <span className="muted small"> · {own.waiveNote}</span>}
          </span>
          {own.status === 'owed' && (
            <Button
              size="sm"
              onClick={() =>
                setWaiving({ rideId: ride.id, number: ride.number, amount: own.amount })
              }
            >
              Kechirish
            </Button>
          )}
        </div>
      )}
      {collects.length > 0 && (
        <>
          <p className="small">
            Bu safar oldingi safarlar qarzini ham oladi (naqd, narxdan tashqari):{' '}
            <strong>{som(collecting)}</strong>
          </p>
          <ul className="plain-list">
            {collects.map((c) => (
              <li key={c.rideId} className="fee-row">
                <span>
                  <Link to={`/rides/${c.rideId}`}>#{c.number}</Link> · {som(c.amount)}{' '}
                  {c.status && <Badge tone={FEE_TONE[c.status]}>{FEE_STATUS[c.status]}</Badge>}
                </span>
                {c.status === 'owed' && ride.status !== 'completed' && (
                  <Button size="sm" onClick={() => setWaiving(c)}>
                    Kechirish
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {waiving && <WaiveFeeDialog ride={waiving} onClose={() => setWaiving(null)} />}
    </section>
  );
}

function RideMap({ ride, candidates }: { ride: AdminRide; candidates: Candidate[] }) {
  const geo = useGeoConfig();
  const driverAt: LatLng | null = ride.driver?.location ?? null;
  const layers = useMemo<MapLayers>(() => {
    const markers: MarkerSpec[] = [
      { id: 'a', point: ride.pickup, kind: 'pickup', text: 'A', title: placeLine(ride.pickup) },
      { id: 'b', point: ride.dropoff, kind: 'dropoff', text: 'B', title: placeLine(ride.dropoff) },
      ...candidates.map((c) => ({
        id: `c-${c.driverId}`,
        point: c.position,
        kind: 'candidate' as const,
        title: `${c.name}: ${duration(c.etaS)}`,
      })),
    ];
    if (driverAt && ride.driver) {
      markers.push({
        id: 'driver',
        point: driverAt,
        kind: 'driver-busy',
        title: ride.driver.name,
        selected: true,
      });
    }
    return {
      polygons: geo.data ? cityLayers(geo.data) : [],
      polylines: [
        { id: 'route', points: [ride.pickup, ride.dropoff], style: 'route' },
        ...(driverAt && ride.status === 'driver_assigned'
          ? [{ id: 'approach', points: [driverAt, ride.pickup], style: 'approach' as const }]
          : []),
      ],
      markers,
    };
  }, [geo.data, ride, candidates, driverAt]);
  if (!geo.data) return null;
  const points = [ride.pickup, ride.dropoff, ...(driverAt ? [driverAt] : [])];
  return (
    <GeoMap
      config={geo.data}
      layers={layers}
      className="ride-map"
      label={`#${ride.number} safar xaritasi`}
      fit={{ key: ride.id, points, maxZoom: 15 }}
    />
  );
}

function Candidates({ ride }: { ride: AdminRide }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const candidates = useCandidates(ride.id, true);
  const assign = useMutation({
    mutationFn: (driverId: string) =>
      api<AdminRide>(`/v1/admin/rides/${ride.id}/assign`, {
        method: 'POST',
        body: { driverId },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ride', ride.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      void queryClient.invalidateQueries({ queryKey: ['rides'] });
      void queryClient.invalidateQueries({ queryKey: ['candidates', ride.id] });
      toast(`#${ride.number}: ${updated.driver?.name ?? 'haydovchi'} tayinlandi`);
    },
    onError: (e) => toast(errorText(e), 'error'),
  });

  const onAssign = async (c: Candidate) => {
    const ok = await confirm({
      title: ride.driver ? 'Boshqa haydovchiga berish' : 'Haydovchini tayinlash',
      text: (
        <>
          <p>
            #{ride.number} buyurtma <strong>{c.name}</strong>ga beriladi (yetib kelish ~
            {duration(c.etaS)}, {distance(c.distanceM)}).
          </p>
          {ride.driver && (
            <p>
              Hozirgi haydovchi <strong>{ride.driver.name}</strong> buyurtmadan chiqariladi.
            </p>
          )}
        </>
      ),
      confirm: 'Tayinlash',
    });
    if (ok) assign.mutate(c.driverId);
  };

  return (
    <section className="detail-section">
      <div className="section-head">
        <h3>Bo‘sh haydovchilar (yetib kelish vaqti bo‘yicha)</h3>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} />}
          loading={candidates.isFetching}
          onClick={() => void candidates.refetch()}
        >
          Yangilash
        </Button>
      </div>
      {candidates.error ? (
        <ErrorBox error={candidates.error} onRetry={() => void candidates.refetch()} />
      ) : candidates.isPending ? (
        <Loading text="Haydovchilar qidirilmoqda…" />
      ) : !candidates.data.length ? (
        <p className="muted small">
          20 km ichida buyurtmani ola oladigan bo‘sh haydovchi yo‘q (onlayn, GPS yangi, balansi
          yetarli, mos avtomobil). Haydovchilarga qo‘ng‘iroq qilib ko‘ring.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table compact">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th className="num">Yetib kelish</th>
                <th className="num">Masofa</th>
                <th className="num">Ball</th>
                <th>
                  <span className="sr-only">Amal</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {candidates.data.map((c, i) => (
                <tr key={c.driverId}>
                  <td>
                    <Link to={`/drivers/${c.driverId}`}>{c.name}</Link>
                    {i === 0 && (
                      <>
                        {' '}
                        <Badge tone="green">eng yaqin</Badge>
                      </>
                    )}
                  </td>
                  <td className="num">{duration(c.etaS)}</td>
                  <td className="num">{distance(c.distanceM)}</td>
                  <td className="num">{c.score}</td>
                  <td className="actions">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<UserCheck size={14} />}
                      disabled={assign.isPending}
                      onClick={() => void onAssign(c)}
                    >
                      Tayinlash
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Everything about one ride for an operator, with manual assignment and cancellation. */
export function RideDetail({
  rideId,
  standalone = false,
}: {
  rideId: string;
  standalone?: boolean;
}) {
  const ride = useRide(rideId);
  const reasons = useReasons();
  const [cancelling, setCancelling] = useState(false);
  const candidatesForMap = useCandidates(rideId, Boolean(ride.data && canAssign(ride.data.status)));

  if (ride.isPending) return <Loading />;
  if (ride.error) return <ErrorBox error={ride.error} onRetry={() => void ride.refetch()} />;
  const r = ride.data;
  const names = new Map<string, string>();
  for (const o of r.offers) names.set(o.driverId, o.driverName);
  for (const c of candidatesForMap.data ?? []) names.set(c.driverId, c.name);
  if (r.driver) names.set(r.driver.id, r.driver.name);
  const waiting = needsDriver({ status: r.status, attentionAt: r.dispatch.attentionAt });
  // the ride carries the labels; the reasons table covers older rides and free text
  const labels: Partial<ReasonLabels> | undefined = r.reasonLabels ?? reasons.data;

  return (
    <div className="ride-detail">
      <div className="ride-head">
        <div className="ride-head-main">
          <Badge tone={RIDE_STATUS_TONE[r.status]}>{RIDE_STATUS[r.status]}</Badge>
          {waiting && <Badge tone="red">Operator kerak</Badge>}
          <Badge>{CLASSES[r.class]}</Badge>
          <Badge tone={r.channel === 'phone' ? 'brand' : 'neutral'}>{CHANNELS[r.channel]}</Badge>
          {r.kind === 'intercity' && <Badge tone="blue">Shaharlararo</Badge>}
          {rideTags(r).map((t) => (
            <Badge key={t.label} tone={t.tone}>
              {t.label}
            </Badge>
          ))}
        </div>
        <span className="muted small">
          {dateTime(r.requestedAt)} · {ago(r.requestedAt)}
        </span>
      </div>

      {r.scheduledFor && (
        <div className="alert alert-info">
          Keyinroqqa buyurtma: <strong>{dateTime(r.scheduledFor)}</strong> ga. Haydovchi qidiruvi 15
          daqiqa oldin boshlanadi.
        </div>
      )}
      {r.paymentMethod === 'card' && (
        <p className="muted small">
          Karta orqali oldindan to‘lov:{' '}
          <strong>{PAYMENT_STATUS[r.paymentStatus] ?? r.paymentStatus}</strong>
        </p>
      )}

      {canCancel(r.status) && (
        <div className="ride-actions">
          <Button variant="danger" icon={<Ban size={16} />} onClick={() => setCancelling(true)}>
            Bekor qilish
          </Button>
          {r.status === 'searching' && (
            <span className="muted small">Bosqich: {STAGES[r.dispatch.stage]}</span>
          )}
        </div>
      )}

      <RideMap ride={r} candidates={candidatesForMap.data ?? []} />

      <div className="detail-grid">
        <section className="detail-section">
          <h3>
            <CircleUserRound size={16} aria-hidden /> Yo‘lovchi
          </h3>
          <p>
            <strong>{r.rider.name ?? 'Ismi yo‘q'}</strong> <PhoneLink phone={r.rider.phone} />
          </p>
          <p className="muted small">
            Reyting {rating(r.rider.rating)} · kelmay qolgan: {r.rider.noShows} marta
          </p>
        </section>
        <section className="detail-section">
          <h3>
            <Car size={16} aria-hidden /> Haydovchi
          </h3>
          {r.driver ? (
            <>
              <p>
                <Link to={`/drivers/${r.driver.id}`}>
                  <strong>{r.driver.name}</strong>
                </Link>{' '}
                <PhoneLink phone={r.driver.phone} />
              </p>
              {r.vehicle && (
                <p className="small">
                  {r.vehicle.colour} {r.vehicle.make} {r.vehicle.model} ·{' '}
                  <span className="plate">{r.vehicle.plateFormatted}</span>
                </p>
              )}
              <p className="muted small">
                Reyting {rating(r.driver.rating)} · {r.driver.ridesCompleted} safar
                {r.driver.location?.at && ` · GPS ${ago(r.driver.location.at)}`}
              </p>
            </>
          ) : (
            <p className="muted">Hali tayinlanmagan</p>
          )}
        </section>
      </div>

      <section className="detail-section">
        <h3>
          <MapPin size={16} aria-hidden /> Yo‘nalish
        </h3>
        <ol className="route-list">
          <li>
            <span className="route-dot is-a">A</span>
            {placeLine(r.pickup)}
          </li>
          <li>
            <span className="route-dot is-b">B</span>
            {placeLine(r.dropoff)}
          </li>
        </ol>
        <dl className="facts">
          <div>
            <dt>Masofa</dt>
            <dd>{distance(r.distanceM)}</dd>
          </div>
          <div>
            <dt>Yo‘lda</dt>
            <dd>{duration(r.durationS)}</dd>
          </div>
          {r.passengers !== undefined && (
            <div>
              <dt>Yo‘lovchilar</dt>
              <dd>{seatingText(r.passengers)}</dd>
            </div>
          )}
          <div>
            <dt>{r.fareMode === 'seat' ? 'Narx (o‘rindiq, yo‘nalish narxi)' : 'Narx (qat’iy)'}</dt>
            <dd>{som(r.fare.quoted)}</dd>
          </div>
          {(r.fare.poolDiscount ?? 0) > 0 && (
            <div>
              <dt>Hamroh chegirmasi</dt>
              <dd>−{som(r.fare.poolDiscount!)}</dd>
            </div>
          )}
          {r.fare.pays !== undefined && r.fare.pays !== r.fare.quoted && (
            <div>
              <dt>Yo‘lovchi to‘laydi</dt>
              <dd>
                <strong>{som(r.fare.pays)}</strong>
              </dd>
            </div>
          )}
          {(r.fare.deposit ?? 0) > 0 && (
            <div>
              <dt>Depozit (kartadan oldindan)</dt>
              <dd>
                {som(r.fare.deposit!)}
                <div className="muted small">
                  naqd qoladi {som(Math.max(0, (r.fare.pays ?? r.fare.quoted) - r.fare.deposit!))}
                </div>
              </dd>
            </div>
          )}
          {r.pool && (
            <div>
              <dt>Umumiy mashina</dt>
              <dd>birga {distance(r.pool.sharedM)}</dd>
            </div>
          )}
          {r.hasStartPin !== undefined && (
            <div>
              <dt>Boshlash kodi</dt>
              <dd>
                {r.hasStartPin ? 'Bor' : 'Yo‘q'}
                {r.hasStartPin && <div className="muted small">kodni faqat yo‘lovchi ko‘radi</div>}
              </dd>
            </div>
          )}
          {r.fare.waiting > 0 && (
            <div>
              <dt>Pullik kutish</dt>
              <dd>{som(r.fare.waiting)}</dd>
            </div>
          )}
          {r.fare.total !== null && (
            <div>
              <dt>Jami</dt>
              <dd>
                <strong>{som(r.fare.total)}</strong>
              </dd>
            </div>
          )}
          {r.fare.owedFee !== undefined && r.fare.owedFee > 0 && (
            <div>
              <dt>Oldingi safarlar qarzi (naqd)</dt>
              <dd>{som(r.fare.owedFee)}</dd>
            </div>
          )}
          {r.fare.cancellationFee > 0 && (
            <div>
              <dt>Bekor qilish jarimasi</dt>
              <dd>
                {som(r.fare.cancellationFee)}
                {r.fare.cancellationFeeStatus && (
                  <div className="muted small">{FEE_STATUS[r.fare.cancellationFeeStatus]}</div>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt>To‘lov</dt>
            <dd>{r.paymentMethod === 'cash' ? 'Naqd' : 'Karta'}</dd>
          </div>
        </dl>
        {r.options.length > 0 && <p className="small">Qo‘shimcha: {optionsText(r.options)}</p>}
        {r.comment && <p className="small comment">“{r.comment}”</p>}
        {r.cancelReason && (
          <p className="small">
            Bekor qilish sababi ({r.cancelledBy ? ACTORS[r.cancelledBy] : '—'}): {r.cancelReason}
          </p>
        )}
        {r.earnings && (
          <p className="small muted">
            Komissiya {som(r.earnings.commission)}
            {r.earnings.commissionNote && ` (${r.earnings.commissionNote})`} · soliq{' '}
            {som(r.earnings.tax)} · haydovchiga {som(r.earnings.net)}
          </p>
        )}
      </section>

      <OwedFeesSection ride={r} />

      {canAssign(r.status) && <Candidates ride={r} />}

      <section className="detail-section">
        <h3>Takliflar ({r.offers.length})</h3>
        {r.offers.length === 0 ? (
          <p className="muted small">Hali hech kimga taklif yuborilmagan.</p>
        ) : (
          <div className="table-scroll">
            <table className="table compact">
              <thead>
                <tr>
                  <th>Haydovchi</th>
                  <th>Tur</th>
                  <th>Javob</th>
                  <th className="num">Yetib kelish</th>
                  <th className="num">Yuborildi</th>
                </tr>
              </thead>
              <tbody>
                {r.offers.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link to={`/drivers/${o.driverId}`}>{o.driverName}</Link>
                    </td>
                    <td>{o.kind === 'broadcast' ? 'E’lon' : 'To‘g‘ridan'}</td>
                    <td>
                      <Badge tone={OFFER_TONE[o.status]}>{OFFER_STATUS[o.status]}</Badge>
                      {o.declineReason && (
                        <div className="muted small">
                          {o.declineReasonLabel ??
                            reasonText(labels?.decline ?? DECLINE_REASONS, o.declineReason)}
                        </div>
                      )}
                    </td>
                    <td className="num">{duration(o.etaS)}</td>
                    <td className="num">{timeSec(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="detail-section">
        <h3>Tarix</h3>
        {r.events.length === 0 ? (
          <Empty title="Hodisalar yo‘q" />
        ) : (
          <ol className="timeline">
            {r.events.map((e) => {
              const detail = eventDetail(e, (id) => names.get(id) ?? null, labels);
              return (
                <li key={e.id} className={`tl-${e.type}`}>
                  <time dateTime={e.at}>{time(e.at)}</time>
                  <div>
                    <strong>{EVENTS[e.type] ?? e.type}</strong>
                    <span className="muted small"> · {ACTORS[e.actor] ?? e.actor}</span>
                    {detail && <div className="small">{detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {!standalone && (
        <p className="small">
          <Link to={`/rides/${r.id}`}>
            <ExternalLink size={13} aria-hidden /> Alohida sahifada ochish
          </Link>
        </p>
      )}

      {cancelling && <CancelRideDialog ride={r} onClose={() => setCancelling(false)} />}
    </div>
  );
}
