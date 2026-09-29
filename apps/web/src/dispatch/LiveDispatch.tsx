import { AlertTriangle, Car, Clock, Crosshair, PhoneCall, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useLive, useRide } from '../api/queries';
import { useStreamState } from '../api/realtime';
import type {
  AdminRideItem,
  LatLng,
  LiveBoard,
  LiveDriver,
  LiveDriverState,
  RideStatus,
} from '../api/types';
import {
  ago,
  CLASSES,
  DRIVER_STATE,
  minutesSince,
  RIDE_STATUS_SHORT,
  RIDE_STATUS_TONE,
  som,
  timeSec,
} from '../lib/format';
import { formatPhone } from '../lib/phone';
import {
  countByState,
  DEFAULT_LIVE_FILTERS,
  filterLive,
  type LiveFilters,
  needsDriver,
  placeLine,
} from '../lib/rides';
import { type CarLoad, carLoad, rideTags } from '../lib/pool';
import type { MapLayers, MarkerKind, MarkerSpec } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { cityLayers } from '../map/places';
import { RideDetail } from '../rides/RideDetail';
import { Badge, Button, PageHeader, Segmented, Toggle } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';
import { Modal } from '../ui/Modal';

const DRIVER_KIND: Record<LiveDriverState, MarkerKind> = {
  free: 'driver-free',
  offered: 'driver-offered',
  busy: 'driver-busy',
};

/** A driver whose last GPS fix is older than this is not offered rides by dispatch. */
const STALE_GPS_MINUTES = 2;

/** Every car and pickup on the board, to fit the map to. */
function boardPoints(board: LiveBoard): LatLng[] {
  return [
    ...board.drivers.flatMap((d) =>
      d.lat !== null && d.lng !== null ? [{ lat: d.lat, lng: d.lng }] : [],
    ),
    ...board.rides.map((r) => r.pickup),
  ];
}

function RideTitle({ rideId }: { rideId: string | null }) {
  const ride = useRide(rideId);
  return <>Buyurtma {ride.data ? `#${ride.data.number}` : ''}</>;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function RideRow({
  ride,
  selected,
  onOpen,
}: {
  ride: AdminRideItem;
  selected: boolean;
  onOpen: () => void;
}) {
  const alert = needsDriver(ride);
  return (
    <li>
      <button
        type="button"
        className={`live-ride${alert ? ' is-alert' : ''}${selected ? ' is-selected' : ''}`}
        onClick={onOpen}
        aria-current={selected || undefined}
      >
        <span className="live-ride-top">
          <strong>#{ride.number}</strong>
          <Badge tone={alert ? 'red' : RIDE_STATUS_TONE[ride.status]}>
            {alert ? 'Haydovchi yo‘q' : RIDE_STATUS_SHORT[ride.status]}
          </Badge>
          {ride.channel === 'phone' && <PhoneCall size={13} aria-label="Telefon buyurtma" />}
          <span className="muted small live-ride-age">
            <Clock size={12} aria-hidden /> {minutesSince(ride.requestedAt)} daq
          </span>
        </span>
        <span className="live-ride-place">{placeLine(ride.pickup)}</span>
        <span className="muted small">
          → {placeLine(ride.dropoff)} · {CLASSES[ride.class]} · {som(ride.fare.quoted)}
          {(ride.passengers ?? 1) > 1 && ` · ${ride.passengers} kishi`}
        </span>
        {rideTags(ride).length > 0 && (
          <span className="live-ride-tags">
            {rideTags(ride).map((t) => (
              <Badge key={t.label} tone={t.tone}>
                {t.label}
              </Badge>
            ))}
          </span>
        )}
        <span className="muted small">
          {ride.riderName ?? 'Yo‘lovchi'} {formatPhone(ride.riderPhone)}
        </span>
      </button>
    </li>
  );
}

function DriverCard({
  driver,
  load,
  onClose,
  onOpenRide,
}: {
  driver: LiveDriver;
  load: CarLoad | null;
  onClose: () => void;
  onOpenRide: (id: string) => void;
}) {
  const stale = driver.locatedAt ? minutesSince(driver.locatedAt) >= STALE_GPS_MINUTES : true;
  const rideId = driver.rideId ?? driver.offeredRideId;
  return (
    <div className="card live-driver-card" aria-live="polite">
      <div className="card-head">
        <h2>
          <Car size={16} aria-hidden /> {driver.name}
        </h2>
        <button type="button" className="icon-btn" aria-label="Yopish" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <p className="small">
        <span className="plate">{driver.plate}</span> · {CLASSES[driver.class]} ·{' '}
        <Badge
          tone={driver.state === 'free' ? 'green' : driver.state === 'offered' ? 'amber' : 'blue'}
        >
          {DRIVER_STATE[driver.state]}
        </Badge>
      </p>
      <p className="muted small">
        Liniyada {ago(driver.onlineSince)} · GPS {driver.locatedAt ? ago(driver.locatedAt) : 'yo‘q'}
        {stale && ' (eskirgan: takliflar bormaydi)'}
      </p>
      {load && load.rides.length > 0 && (
        <p className="small">
          {load.shared && <Badge tone="blue">Hamroh</Badge>} Mashinada {load.rides.length} ta
          buyurtma, {load.passengers} kishi:{' '}
          {load.rides.map((r, i) => (
            <span key={r.id}>
              {i > 0 && ', '}
              <button type="button" className="link-btn" onClick={() => onOpenRide(r.id)}>
                #{r.number}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="row-actions">
        {rideId && (
          <Button size="sm" onClick={() => onOpenRide(rideId)}>
            Buyurtmasi
          </Button>
        )}
        <Link to={`/drivers/${driver.id}`} className="btn btn-sm btn-ghost">
          Profil
        </Link>
      </div>
    </div>
  );
}

/**
 * The dispatcher's live map: online drivers coloured by state, open rides, filters; a ride
 * opens a drawer with its timeline, offers, candidates, manual assignment and cancellation.
 * Positions arrive in the stream's positions batch and offers as events (applied to the board);
 * other changes refetch at once. A slow poll backs the stream up; while it is down, the old
 * 5-second poll takes over.
 */
export default function LiveDispatch() {
  const live = useLive();
  const stream = useStreamState();
  const geo = useGeoConfig();
  const [params, setParams] = useSearchParams();
  const rideId = params.get('ride');
  const [filters, setFilters] = useState<LiveFilters>(DEFAULT_LIVE_FILTERS);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [fit, setFit] = useState<{ key: string; points: LatLng[] } | undefined>();

  const openRide = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ride', id);
    else next.delete('ride');
    setParams(next, { replace: true });
  };

  const board = useMemo(
    () => (live.data ? filterLive(live.data, filters) : null),
    [live.data, filters],
  );
  const counts = live.data ? countByState(live.data) : { free: 0, offered: 0, busy: 0 };
  const waiting = live.data?.rides.filter(needsDriver).length ?? 0;
  const searching = live.data?.rides.filter((r) => r.status === 'searching').length ?? 0;
  const selectedDriver = live.data?.drivers.find((d) => d.id === driverId) ?? null;
  const selectedLoad = selectedDriver && live.data ? carLoad(live.data, selectedDriver.id) : null;
  const noGps = board?.drivers.filter((d) => d.lat === null || d.lng === null).length ?? 0;

  const layers = useMemo<MapLayers>(() => {
    if (!board || !live.data || !geo.data) return {};
    const markers: MarkerSpec[] = [];
    for (const d of board.drivers) {
      if (d.lat === null || d.lng === null) continue;
      const stale = d.locatedAt ? minutesSince(d.locatedAt) >= STALE_GPS_MINUTES : true;
      // a shared car: the number of riders it carries on the marker
      const load = carLoad(live.data, d.id);
      const shared = load.shared
        ? ` · hamroh: ${load.rides.length} buyurtma, ${load.passengers} kishi`
        : '';
      markers.push({
        id: `d-${d.id}`,
        point: { lat: d.lat, lng: d.lng },
        kind: DRIVER_KIND[d.state],
        ...(load.rides.length > 1 ? { text: String(load.rides.length) } : {}),
        title: `${d.name} · ${d.plate} · ${DRIVER_STATE[d.state]}${shared}${stale ? ' · GPS eskirgan' : ''}`,
        selected: d.id === driverId,
        onClick: () => setDriverId(d.id),
      });
    }
    for (const r of board.rides) {
      if (r.status === 'in_progress') continue;
      markers.push({
        id: `r-${r.id}`,
        point: r.pickup,
        kind: needsDriver(r) ? 'ride-alert' : 'ride',
        text: String(r.number).slice(-3),
        title: `#${r.number} · ${RIDE_STATUS_SHORT[r.status]} · ${placeLine(r.pickup)}`,
        selected: r.id === rideId,
        onClick: () => openRide(r.id),
      });
    }
    return { polygons: cityLayers(geo.data), markers };
    // openRide only changes the URL; the layers follow the board and the selection
  }, [board, live.data, geo.data, driverId, rideId]);

  // fit the map to everything once when the board first loads, then only on request
  useEffect(() => {
    if (live.data && !fit) setFit({ key: 'initial', points: boardPoints(live.data) });
  }, [live.data, fit]);

  return (
    <div className="live-page">
      <PageHeader
        title="Jonli xarita"
        subtitle={
          live.dataUpdatedAt
            ? `Yangilandi ${timeSec(new Date(live.dataUpdatedAt).toISOString())} · ${
                stream === 'open'
                  ? 'joylashuvlar jonli (har 5 soniyada)'
                  : 'jonli aloqa yo‘q: har 5 soniyada so‘raladi'
              }`
            : 'Haydovchilar va ochiq buyurtmalar'
        }
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              icon={<Crosshair size={15} />}
              disabled={!live.data}
              onClick={() =>
                live.data && setFit({ key: String(Date.now()), points: boardPoints(live.data) })
              }
            >
              Hammasini ko‘rsatish
            </Button>
            <Link to="/phone-order" className="btn btn-sm btn-primary">
              <PhoneCall size={15} aria-hidden /> Telefon buyurtma
            </Link>
          </>
        }
      />

      <div className="live-stats" role="group" aria-label="Holat">
        <span className="stat">
          <span className="dot dot-free" /> Bo‘sh <strong>{counts.free}</strong>
        </span>
        <span className="stat">
          <span className="dot dot-offered" /> Taklif ko‘rmoqda <strong>{counts.offered}</strong>
        </span>
        <span className="stat">
          <span className="dot dot-busy" /> Buyurtmada <strong>{counts.busy}</strong>
        </span>
        <span className="stat">
          Qidiruvda <strong>{searching}</strong>
        </span>
        <span className={`stat${waiting ? ' is-alert' : ''}`}>
          <AlertTriangle size={14} aria-hidden /> Operator kerak <strong>{waiting}</strong>
        </span>
      </div>

      <div className="live-filters filters" role="group" aria-label="Filtrlar">
        <span className="filter-label">Haydovchilar:</span>
        {(['free', 'offered', 'busy'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`chip chip-sm${filters.driverStates.includes(s) ? ' is-active' : ''}`}
            aria-pressed={filters.driverStates.includes(s)}
            onClick={() => setFilters((f) => ({ ...f, driverStates: toggle(f.driverStates, s) }))}
          >
            <span className={`dot dot-${s}`} /> {DRIVER_STATE[s]}
          </button>
        ))}
        <span className="filter-label">Buyurtmalar:</span>
        {(['searching', 'driver_assigned', 'driver_arrived', 'in_progress'] as RideStatus[]).map(
          (s) => (
            <button
              key={s}
              type="button"
              className={`chip chip-sm${filters.rideStatuses.includes(s) ? ' is-active' : ''}`}
              aria-pressed={filters.rideStatuses.includes(s)}
              onClick={() => setFilters((f) => ({ ...f, rideStatuses: toggle(f.rideStatuses, s) }))}
            >
              {RIDE_STATUS_SHORT[s]}
            </button>
          ),
        )}
        <Segmented
          label="Tarif"
          value={filters.rideClass}
          onChange={(rideClass) => setFilters((f) => ({ ...f, rideClass }))}
          options={[
            { value: 'all', label: 'Hammasi' },
            { value: 'economy', label: 'Ekonom' },
            { value: 'comfort', label: 'Komfort' },
          ]}
        />
        <Toggle
          checked={filters.attentionOnly}
          onChange={(attentionOnly) => setFilters((f) => ({ ...f, attentionOnly }))}
          label="Faqat operator kerak"
        />
      </div>

      {live.error && <ErrorBox error={live.error} onRetry={() => void live.refetch()} />}

      <div className="live-layout">
        <aside className="live-side" aria-label="Ochiq buyurtmalar">
          {selectedDriver && (
            <DriverCard
              driver={selectedDriver}
              load={selectedLoad}
              onClose={() => setDriverId(null)}
              onOpenRide={openRide}
            />
          )}
          <h2 className="live-side-title">
            Ochiq buyurtmalar <span className="muted">({board?.rides.length ?? 0})</span>
          </h2>
          {live.isPending ? (
            <Loading />
          ) : !board?.rides.length ? (
            <Empty title="Ochiq buyurtma yo‘q">
              Filtrlarni o‘zgartiring yoki <Link to="/phone-order">telefon orqali buyurtma</Link>{' '}
              qabul qiling.
            </Empty>
          ) : (
            <ul className="live-rides">
              {board.rides.map((r) => (
                <RideRow
                  key={r.id}
                  ride={r}
                  selected={r.id === rideId}
                  onOpen={() => openRide(r.id)}
                />
              ))}
            </ul>
          )}
        </aside>
        <div className="live-map-wrap">
          {geo.error ? (
            <ErrorBox error={geo.error} onRetry={() => void geo.refetch()} />
          ) : !geo.data ? (
            <Loading text="Xarita yuklanmoqda…" />
          ) : (
            <GeoMap
              config={geo.data}
              layers={layers}
              className="live-map"
              label="Haydovchilar va buyurtmalar xaritasi"
              fit={fit?.points.length ? { ...fit, maxZoom: 14 } : undefined}
            />
          )}
          <ul className="map-legend" aria-label="Belgilar">
            <li>
              <span className="dot dot-free" /> Bo‘sh
            </li>
            <li>
              <span className="dot dot-offered" /> Taklif ko‘rmoqda
            </li>
            <li>
              <span className="dot dot-busy" /> Buyurtmada
            </li>
            <li>
              <span className="dot dot-busy" /> 2 — hamroh: mashinada 2 buyurtma
            </li>
            <li>
              <span className="dot dot-ride" /> Buyurtma (olib ketish joyi)
            </li>
            <li>
              <span className="dot dot-alert" /> Haydovchi topilmagan
            </li>
            {noGps > 0 && <li>{noGps} ta haydovchining joylashuvi noma’lum</li>}
          </ul>
        </div>
      </div>

      <Modal
        open={rideId !== null}
        onClose={() => openRide(null)}
        variant="drawer"
        size="lg"
        title={<RideTitle rideId={rideId} />}
      >
        {rideId && <RideDetail rideId={rideId} />}
      </Modal>
    </div>
  );
}
