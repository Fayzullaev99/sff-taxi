import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CircleAlert,
  CircleCheck,
  HandCoins,
  History,
  MapPin,
  PhoneCall,
  RotateCcw,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, apiResponse, errorText } from '../api/client';
import { useAppConfig } from '../api/queries';
import type {
  AdminRide,
  CustomerLookup,
  GeoAddress,
  GeoConfig,
  LatLng,
  OwedFeeLine,
  Place,
  Quote,
  RideBase,
  RideClass,
  RideOption,
} from '../api/types';
import { RIDE_OPTIONS } from '../api/types';
import {
  CLASSES,
  date,
  dateTime,
  distance,
  duration,
  isoToTashkentLocal,
  OPTIONS,
  rating,
  RIDE_STATUS,
  som,
  tashkentLocalToIso,
} from '../lib/format';
import { formatPhone, isUzPhone, normalizePhone } from '../lib/phone';
import {
  knownPlaces,
  placeLine,
  SCHEDULED_PER_RIDER,
  SCHEDULE_MAX_HOURS,
  SCHEDULE_MIN_MINUTES,
  scheduleProblem,
} from '../lib/rides';
import { MAX_PASSENGERS, seatingText } from '../lib/pool';
import type { MapLayers, MarkerSpec } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { AddressSearch, addressLine, cityLayers, useDebounced, useReverse } from '../map/places';
import { WaiveFeeDialog } from '../rides/WaiveFeeDialog';
import { Badge, Button, Field, PageHeader, PhoneInput, Segmented } from '../ui/controls';
import { ErrorBox, Loading, Spinner, useToast } from '../ui/feedback';

type Target = 'pickup' | 'dropoff';

interface PlaceDraft {
  point: LatLng | null;
  address: string;
  landmark: string;
  /** The address was typed or picked by the operator: a reverse lookup does not overwrite it. */
  addressLocked: boolean;
}

const EMPTY_PLACE: PlaceDraft = { point: null, address: '', landmark: '', addressLocked: false };

const TARGET_LABEL: Record<Target, string> = {
  pickup: 'Olib ketish joyi (A)',
  dropoff: 'Borish manzili (B)',
};

/**
 * Who is calling (POST admin/customers/lookup: the phone stays out of URLs and logs): the
 * account, an open ride that blocks a new one, recent rides and places, saved places.
 */
function useCaller(phone: string | null) {
  return useQuery({
    queryKey: ['caller', phone],
    queryFn: () =>
      api<CustomerLookup>('/v1/admin/customers/lookup', { method: 'POST', body: { phone } }),
    enabled: phone !== null,
    staleTime: 30_000,
  });
}

function newRequestId(): string {
  return crypto.randomUUID();
}

const PLACE_KIND: Record<string, string> = { home: 'Uy', work: 'Ish', other: 'Saqlangan' };

/** '5 ta safar, 1 ta bekor qilingan' over the caller's recent rides. */
function callerSummary(rides: readonly RideBase[]): string {
  const done = rides.filter((r) => r.status === 'completed').length;
  const cancelled = rides.filter((r) => r.status === 'cancelled').length;
  return cancelled ? `${done} ta safar, ${cancelled} ta bekor qilingan` : `${done} ta safar`;
}

function PlaceFields({
  target,
  draft,
  active,
  config,
  near,
  onChange,
  onPick,
  onActivate,
}: {
  target: Target;
  draft: PlaceDraft;
  active: boolean;
  config: GeoConfig;
  near: LatLng | null;
  onChange: (patch: Partial<PlaceDraft>) => void;
  onPick: (a: GeoAddress) => void;
  onActivate: () => void;
}) {
  return (
    <fieldset className={`place-fields${active ? ' is-active' : ''}`}>
      <legend>
        <span className={`route-dot ${target === 'pickup' ? 'is-a' : 'is-b'}`}>
          {target === 'pickup' ? 'A' : 'B'}
        </span>
        {TARGET_LABEL[target]}
        {draft.point ? (
          <CircleCheck size={15} className="ok-icon" aria-label="belgilangan" />
        ) : (
          <span className="muted small"> — belgilanmagan</span>
        )}
      </legend>
      <AddressSearch
        config={config}
        near={near}
        label={`${TARGET_LABEL[target]}: manzilni qidirish`}
        onPick={onPick}
      />
      <div className="grid-2">
        <Field label="Manzil">
          {(p) => (
            <input
              {...p}
              value={draft.address}
              maxLength={300}
              placeholder="Ko‘cha, uy"
              onChange={(e) => onChange({ address: e.target.value, addressLocked: true })}
            />
          )}
        </Field>
        <Field label="Mo‘ljal" hint="Qishloqlarda eng muhimi: maktab, do‘kon, masjid">
          {(p) => (
            <input
              {...p}
              value={draft.landmark}
              maxLength={200}
              placeholder="Masalan: 5-maktab yonida"
              onChange={(e) => onChange({ landmark: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Button
        size="sm"
        variant={active ? 'primary' : 'outline'}
        icon={<MapPin size={14} />}
        aria-pressed={active}
        onClick={onActivate}
      >
        {active ? 'Xaritani bosing…' : 'Xaritada belgilash'}
      </Button>
    </fieldset>
  );
}

function KnownPlaces({
  places,
  onUse,
}: {
  places: (Place & { tag: string })[];
  onUse: (target: Target, p: Place) => void;
}) {
  if (!places.length) return null;
  return (
    <div className="known-places">
      <h3 className="subhead">
        <History size={14} aria-hidden /> Saqlangan va avvalgi manzillari
      </h3>
      <ul className="plain-list">
        {places.map((p) => (
          <li key={`${p.tag}-${p.lat},${p.lng}`} className="known-place">
            <span className="wrap">
              {placeLine(p)} <span className="muted small">· {p.tag}</span>
            </span>
            <span className="row-actions">
              <Button size="sm" onClick={() => onUse('pickup', p)}>
                A
              </Button>
              <Button size="sm" onClick={() => onUse('dropoff', p)}>
                B
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Cancellation fees the caller owes from cancelled cash rides: this cash order collects them
 * on top of its fare (the driver takes both). An operator may waive one with a note.
 */
function OwedFeeNotice({ owed }: { owed: OwedFeeLine }) {
  const [waiving, setWaiving] = useState<OwedFeeLine['rides'][number] | null>(null);
  return (
    <div className="alert alert-warn owed-fee" role="status">
      <HandCoins size={16} aria-hidden />
      <div>
        <p>
          Bekor qilingan safar(lar) uchun qarzi: <strong>{som(owed.amount)}</strong>. Yangi naqd
          buyurtmada haydovchi narxdan tashqari shu summani ham oladi: mijozga ayting.
        </p>
        <ul className="plain-list">
          {owed.rides.map((r) => (
            <li key={r.rideId} className="fee-row">
              <span>
                <Link to={`/rides/${r.rideId}`}>#{r.number}</Link> · {som(r.amount)}
                {r.cancelledAt && <span className="muted small"> · {dateTime(r.cancelledAt)}</span>}
              </span>
              <Button size="sm" onClick={() => setWaiving(r)}>
                Kechirish
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {waiving && <WaiveFeeDialog ride={waiving} onClose={() => setWaiving(null)} />}
    </div>
  );
}

function Created({
  ride,
  quoted,
  repeated,
  later,
  onNew,
}: {
  ride: AdminRide;
  quoted: number | null;
  /** The API answered 200: this attempt was already ordered (a retried request). */
  repeated: boolean;
  /** The operator ordered it for later. */
  later: boolean;
  onNew: () => void;
}) {
  const owed = ride.fare.owedFee ?? 0;
  return (
    <div className="card created-card" role="status">
      <h2>
        <CircleCheck size={20} aria-hidden /> #{ride.number} buyurtma qabul qilindi
      </h2>
      {repeated && (
        <div className="alert alert-info">
          Bu so‘rov avval yuborilgan edi: yangi buyurtma ochilmadi, mavjud #{ride.number}{' '}
          ko‘rsatildi.
        </div>
      )}
      <p>
        {placeLine(ride.pickup)} → {placeLine(ride.dropoff)}
      </p>
      <p>
        <strong>{som(ride.fare.quoted)}</strong> · {CLASSES[ride.class]} · naqd ·{' '}
        {RIDE_STATUS[ride.status]}
      </p>
      {ride.scheduledFor && (
        <p>
          <CalendarClock size={15} aria-hidden /> Keyinroqqa:{' '}
          <strong>{dateTime(ride.scheduledFor)}</strong> (haydovchi qidiruvi 15 daqiqa oldin
          boshlanadi)
        </p>
      )}
      {later && ride.status !== 'scheduled' && (
        <div className="alert alert-warn">
          Buyurtma keyinroqqa emas, hozirga qabul qilindi: haydovchi darhol qidirilmoqda. Kerak
          bo‘lmasa, bekor qiling.
        </div>
      )}
      {owed > 0 && (
        <div className="alert alert-info">
          Haydovchi narxdan tashqari oldingi bekor qilingan safar(lar) uchun{' '}
          <strong>{som(owed)}</strong> ham oladi: mijozga jami{' '}
          <strong>{som(ride.fare.quoted + owed)}</strong>.
        </div>
      )}
      {quoted !== null && quoted !== ride.fare.quoted && (
        <div className="alert alert-warn">
          Narx hisoblangandan keyin o‘zgardi ({som(quoted)} → {som(ride.fare.quoted)}), masalan
          tungi tarif boshlandi. Mijozga yangi narxni ayting.
        </div>
      )}
      <p className="muted small">
        Haydovchi topilganda mijozga SMS keladi: mashina, raqami va haydovchi telefoni.
      </p>
      <div className="row-actions">
        <Link to={`/dispatch?ride=${ride.id}`} className="btn btn-primary">
          Xaritada kuzatish
        </Link>
        <Button icon={<RotateCcw size={16} />} onClick={onNew}>
          Yangi buyurtma
        </Button>
      </div>
    </div>
  );
}

/**
 * A phone order for a caller without the app (market analysis O1): caller lookup, pickup and
 * destination by search, map or the caller's past places, landmark, class and options, the
 * fixed price read out to the caller, then the order. The API texts the caller the car.
 */
export default function PhoneOrder() {
  const geo = useGeoConfig();
  const appConfig = useAppConfig();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [pickup, setPickup] = useState<PlaceDraft>(EMPTY_PLACE);
  const [dropoff, setDropoff] = useState<PlaceDraft>(EMPTY_PLACE);
  const [target, setTarget] = useState<Target>('pickup');
  const [rideClass, setRideClass] = useState<RideClass>('economy');
  const [options, setOptions] = useState<RideOption[]>([]);
  const [comment, setComment] = useState('');
  // the seating rule: one in front, at most two in the back
  const [passengers, setPassengers] = useState(1);
  const [later, setLater] = useState(false);
  const [laterAt, setLaterAt] = useState('');
  const [view, setView] = useState<{ key: string; center: LatLng; zoom?: number }>();
  const [created, setCreated] = useState<{
    ride: AdminRide;
    quoted: number | null;
    repeated: boolean;
    later: boolean;
  } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // one id per order attempt: a retried request (network error, double click) is the same
  // attempt, and the API answers it with the ride it already created (200 instead of 201)
  const requestId = useRef(newRequestId());
  const phoneRef = useRef<HTMLInputElement>(null);

  // a quote with scheduledFor makes the phone order a ride for later (a config feature flag)
  const canSchedule = appConfig.data?.features.scheduledPhoneOrders === true;
  const normalized = isUzPhone(phone) ? normalizePhone(phone) : null;
  const caller = useCaller(normalized);
  const known = caller.data?.found ? caller.data : null;
  const openRide = known?.openRide ?? null;
  const places = useMemo(() => {
    if (!known) return [];
    const saved = known.savedPlaces.map((p) => ({
      ...p,
      tag: p.label ?? PLACE_KIND[p.kind] ?? 'Saqlangan',
    }));
    const seen = new Set(saved.map((p) => `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`));
    const past = knownPlaces(known.recentRides)
      .filter((p) => !seen.has(`${p.lat.toFixed(3)},${p.lng.toFixed(3)}`))
      .map((p) => ({ ...p, tag: `${p.uses} marta` }));
    return [...saved, ...past].slice(0, 8);
  }, [known]);
  const knownName = known?.user.name ?? null;
  const owedFee = known?.owedFee ?? null;
  // rides for later the caller already has (the recent rides are the newest 10: they are there)
  const scheduled = known?.recentRides.filter((r) => r.status === 'scheduled') ?? [];

  useEffect(() => {
    if (knownName && !nameTouched) setName(knownName);
  }, [knownName, nameTouched]);

  // the address at a point set on the map, unless the operator typed one
  const [lookup, setLookup] = useState<{ target: Target; point: LatLng } | null>(null);
  const reverse = useReverse(geo.data, lookup?.point ?? null);
  useEffect(() => {
    const found = reverse.data?.address;
    if (!found || !lookup) return;
    const set = lookup.target === 'pickup' ? setPickup : setDropoff;
    set((d) =>
      d.addressLocked || d.point !== lookup.point ? d : { ...d, address: addressLine(found) },
    );
  }, [reverse.data, lookup]);

  const setPoint = (t: Target, point: LatLng) => {
    const set = t === 'pickup' ? setPickup : setDropoff;
    set((d) => ({ ...d, point, addressLocked: false, address: '' }));
    setLookup({ target: t, point });
  };
  const onMapClick = (point: LatLng) => {
    setPoint(target, point);
    if (target === 'pickup' && !dropoff.point) setTarget('dropoff');
  };
  const pickAddress = (t: Target, a: GeoAddress) => {
    const set = t === 'pickup' ? setPickup : setDropoff;
    set((d) => ({
      ...d,
      point: { lat: a.lat, lng: a.lng },
      address: addressLine(a),
      addressLocked: true,
    }));
    setView({ key: `${t}-${a.lat},${a.lng}`, center: { lat: a.lat, lng: a.lng }, zoom: 16 });
    if (t === 'pickup' && !dropoff.point) setTarget('dropoff');
  };
  const applyKnown = (t: Target, p: Place) => {
    const set = t === 'pickup' ? setPickup : setDropoff;
    set({
      point: { lat: p.lat, lng: p.lng },
      address: p.address ?? '',
      landmark: p.landmark ?? '',
      addressLocked: true,
    });
    setView({ key: `${t}-${p.lat},${p.lng}`, center: p, zoom: 16 });
    if (t === 'pickup' && !dropoff.point) setTarget('dropoff');
  };

  // for later: priced at that time (the night add-on), so the time is part of the quote
  const laterProblem = later ? scheduleProblem(laterAt) : null;
  const scheduledFor = later && !laterProblem ? tashkentLocalToIso(laterAt) : null;

  // the fixed price for both classes; recomputed when the trip, options or time change
  const trip = useDebounced(
    pickup.point && dropoff.point && (!later || scheduledFor)
      ? {
          pickup: pickup.point,
          dropoff: dropoff.point,
          options: [...options].sort(),
          ...(scheduledFor ? { scheduledFor } : {}),
        }
      : null,
    300,
  );
  const quote = useQuery({
    queryKey: ['quote', trip],
    queryFn: () => api<Quote>('/v1/admin/rides/quote', { method: 'POST', body: trip }),
    enabled: trip !== null,
    retry: false,
    staleTime: 8 * 60_000,
    // a quote lives 10 minutes: refresh before it runs out while the caller is still talking
    refetchInterval: 8 * 60_000,
  });
  const fare = quote.data?.fares[rideClass] ?? null;

  const order = useMutation({
    mutationFn: () =>
      apiResponse<AdminRide>('/v1/admin/rides', {
        method: 'POST',
        body: {
          riderPhone: normalized,
          riderName: name.trim() || null,
          pickup: {
            ...pickup.point!,
            address: pickup.address.trim() || null,
            landmark: pickup.landmark.trim() || null,
          },
          dropoff: {
            ...dropoff.point!,
            address: dropoff.address.trim() || null,
            landmark: dropoff.landmark.trim() || null,
          },
          class: rideClass,
          options,
          comment: comment.trim() || null,
          passengers,
          // the price read out to the caller is the price of the ride
          // a quote priced for later (scheduledFor) makes this a ride for later
          quoteId: quote.data?.quoteId ?? null,
          clientRequestId: requestId.current,
        },
      }),
    onSuccess: ({ status, data: ride }) => {
      const repeated = status === 200;
      setCreated({ ride, quoted: fare?.total ?? null, repeated, later: Boolean(scheduledFor) });
      requestId.current = newRequestId();
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      void queryClient.invalidateQueries({ queryKey: ['rides'] });
      void queryClient.invalidateQueries({ queryKey: ['caller'] });
      toast(
        repeated
          ? `#${ride.number} avval qabul qilingan edi`
          : `#${ride.number} buyurtma qabul qilindi`,
      );
    },
    onError: (error) => {
      // the quote ran out (410) or is gone (404): price again, the operator reads it out anew
      if (error instanceof ApiError && (error.status === 410 || error.status === 404)) {
        void quote.refetch();
      }
    },
  });
  const conflictRideId =
    order.error instanceof ApiError && order.error.status === 409
      ? ((order.error.body as { rideId?: string } | null)?.rideId ?? null)
      : null;
  const quoteExpired =
    order.error instanceof ApiError && (order.error.status === 410 || order.error.status === 404);

  const problems: string[] = [];
  if (!normalized) problems.push('Mijozning telefon raqamini kiriting');
  if (!pickup.point) problems.push('Olib ketish joyini belgilang');
  if (!dropoff.point) problems.push('Borish manzilini belgilang');
  // an unfinished ride blocks a ride now, not one for later (nor the other way round)
  if (openRide && !later) {
    problems.push(`Mijozda tugallanmagan buyurtma bor: #${openRide.number}`);
  }
  if (later && scheduled.length >= SCHEDULED_PER_RIDER) {
    problems.push(`Oldindan ${SCHEDULED_PER_RIDER} tadan ortiq buyurtma berib bo‘lmaydi`);
  }
  // a ride for later is ordered only with a quote priced for that time
  if (later && quote.data && quote.data.scheduledFor === null) {
    problems.push('Narx keyinroqqa hisoblanmadi: qayta hisoblang');
  }
  if (known && known.user.status !== 'active') problems.push('Bu mijoz bloklangan');
  if (later && laterProblem) problems.push(`Keyinroqqa: ${laterProblem.toLowerCase()}`);
  if (quote.error) problems.push(errorText(quote.error));
  const canOrder = problems.length === 0 && Boolean(fare) && !quote.isFetching;

  const submit = () => {
    setSubmitted(true);
    if (canOrder) order.mutate();
  };

  const reset = () => {
    setCreated(null);
    setSubmitted(false);
    setPhone('');
    setName('');
    setNameTouched(false);
    setPickup(EMPTY_PLACE);
    setDropoff(EMPTY_PLACE);
    setTarget('pickup');
    setRideClass('economy');
    setOptions([]);
    setComment('');
    setPassengers(1);
    setLater(false);
    setLaterAt('');
    order.reset();
    requestId.current = newRequestId();
    setTimeout(() => phoneRef.current?.focus(), 0);
  };

  const layers = useMemo<MapLayers>(() => {
    if (!geo.data) return {};
    const markers: MarkerSpec[] = [];
    if (pickup.point) {
      markers.push({
        id: 'pickup',
        point: pickup.point,
        kind: 'pickup',
        text: 'A',
        title: 'Olib ketish joyi (sudrab to‘g‘rilang)',
        draggable: true,
        onDragEnd: (p) => setPoint('pickup', p),
      });
    }
    if (dropoff.point) {
      markers.push({
        id: 'dropoff',
        point: dropoff.point,
        kind: 'dropoff',
        text: 'B',
        title: 'Borish manzili (sudrab to‘g‘rilang)',
        draggable: true,
        onDragEnd: (p) => setPoint('dropoff', p),
      });
    }
    return {
      polygons: cityLayers(geo.data),
      polylines:
        pickup.point && dropoff.point
          ? [{ id: 'route', points: [pickup.point, dropoff.point], style: 'route' }]
          : [],
      markers,
    };
    // setPoint only sets state; the layers follow the two points
  }, [geo.data, pickup.point, dropoff.point]);

  if (created) {
    return (
      <div className="phone-order">
        <PageHeader title="Telefon buyurtma" />
        <Created
          ride={created.ride}
          quoted={created.quoted}
          repeated={created.repeated}
          later={created.later}
          onNew={reset}
        />
      </div>
    );
  }
  if (geo.isPending) return <Loading />;
  if (geo.error) return <ErrorBox error={geo.error} onRetry={() => void geo.refetch()} />;
  const config = geo.data;

  return (
    <div className="phone-order">
      <PageHeader
        title="Telefon buyurtma"
        subtitle="Smartfoni yo‘q mijozlar uchun: narx oldindan aytiladi va o‘zgarmaydi"
        actions={
          <Button variant="ghost" size="sm" icon={<RotateCcw size={15} />} onClick={reset}>
            Tozalash
          </Button>
        }
      />
      <div className="order-layout">
        <div className="order-form">
          <section className="card">
            <h2>
              <PhoneCall size={17} aria-hidden /> Mijoz
            </h2>
            <div className="grid-2">
              <Field
                label="Telefon raqami"
                error={submitted && !normalized ? 'O‘zbekiston raqamini kiriting' : null}
                hint={caller.isFetching ? 'Qidirilmoqda…' : undefined}
              >
                {(p) => (
                  <PhoneInput {...p} ref={phoneRef} value={phone} onChange={setPhone} autoFocus />
                )}
              </Field>
              <Field
                label="Ismi"
                hint={knownName && !nameTouched ? 'Avvalgi buyurtmadan' : undefined}
              >
                {(p) => (
                  <input
                    {...p}
                    value={name}
                    maxLength={100}
                    autoComplete="off"
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameTouched(true);
                    }}
                  />
                )}
              </Field>
            </div>
            {caller.error && (
              <ErrorBox error={caller.error} onRetry={() => void caller.refetch()} />
            )}
            {normalized && caller.data && (
              <div className="caller-summary">
                {openRide ? (
                  <div className={`alert ${later ? 'alert-info' : 'alert-error'}`}>
                    <CircleAlert size={16} aria-hidden />
                    <span>
                      Tugallanmagan buyurtma bor: <strong>#{openRide.number}</strong> (
                      {RIDE_STATUS[openRide.status]}, {dateTime(openRide.requestedAt)}).{' '}
                      {later
                        ? 'Keyinroqqa buyurtma berish mumkin.'
                        : canSchedule
                          ? 'Hozirga yangi buyurtma berib bo‘lmaydi, keyinroqqa mumkin.'
                          : 'Yangi buyurtma berib bo‘lmaydi.'}
                    </span>
                    <Link to={`/dispatch?ride=${openRide.id}`} className="btn btn-sm">
                      Ochish
                    </Link>
                  </div>
                ) : known && known.user.status !== 'active' ? (
                  <div className="alert alert-error">
                    <CircleAlert size={16} aria-hidden />
                    <span>Bu mijoz bloklangan: buyurtma qabul qilinmaydi.</span>
                  </div>
                ) : known ? (
                  <p className="muted small">
                    {known.recentRides.length
                      ? `Doimiy mijoz: ${callerSummary(known.recentRides)}`
                      : 'Ro‘yxatdan o‘tgan, safarlari yo‘q'}
                    {' · '}reyting {rating(known.user.rating)}
                    {known.user.noShows > 0 && ` · ${known.user.noShows} marta chiqmagan`}
                    {' · '}
                    {date(known.user.since)} dan beri
                  </p>
                ) : (
                  <p className="muted small">Yangi mijoz: hisob buyurtma bilan birga ochiladi.</p>
                )}
                {scheduled.length > 0 && (
                  <p className="small">
                    <CalendarClock size={14} aria-hidden /> Keyinroqqa buyurtmalari:{' '}
                    {scheduled.map((r, i) => (
                      <span key={r.id}>
                        {i > 0 && ', '}
                        <Link to={`/rides/${r.id}`}>#{r.number}</Link>{' '}
                        {r.scheduledFor && dateTime(r.scheduledFor)}
                      </span>
                    ))}
                  </p>
                )}
                {owedFee && owedFee.amount > 0 && <OwedFeeNotice owed={owedFee} />}
                <KnownPlaces places={places} onUse={applyKnown} />
              </div>
            )}
          </section>

          <section className="card">
            <h2>Manzillar</h2>
            <PlaceFields
              target="pickup"
              draft={pickup}
              active={target === 'pickup'}
              config={config}
              near={pickup.point}
              onChange={(patch) => setPickup((d) => ({ ...d, ...patch }))}
              onPick={(a) => pickAddress('pickup', a)}
              onActivate={() => setTarget('pickup')}
            />
            <PlaceFields
              target="dropoff"
              draft={dropoff}
              active={target === 'dropoff'}
              config={config}
              near={dropoff.point ?? pickup.point}
              onChange={(patch) => setDropoff((d) => ({ ...d, ...patch }))}
              onPick={(a) => pickAddress('dropoff', a)}
              onActivate={() => setTarget('dropoff')}
            />
          </section>

          <section className="card">
            <h2>Tarif va qo‘shimchalar</h2>
            <Segmented
              label="Tarif"
              value={rideClass}
              onChange={setRideClass}
              options={[
                {
                  value: 'economy',
                  label: `Ekonom${quote.data ? ` · ${som(quote.data.fares.economy.total)}` : ''}`,
                },
                {
                  value: 'comfort',
                  label: `Komfort${quote.data ? ` · ${som(quote.data.fares.comfort.total)}` : ''}`,
                },
              ]}
            />
            <Segmented
              label="Yo‘lovchilar soni"
              value={String(passengers)}
              onChange={(v) => setPassengers(Number(v))}
              options={Array.from({ length: MAX_PASSENGERS }, (_, i) => ({
                value: String(i + 1),
                label: `${i + 1} kishi`,
              }))}
            />
            <p className="muted small">
              {seatingText(passengers)}. Bir mashinada ko‘pi bilan {MAX_PASSENGERS} yo‘lovchi: oldda
              1, orqada 2; ko‘proq bo‘lsa — ikkinchi buyurtma.
            </p>
            <div className="toggles" role="group" aria-label="Qo‘shimchalar">
              {RIDE_OPTIONS.map((o) => (
                <label key={o} className="check">
                  <input
                    type="checkbox"
                    checked={options.includes(o)}
                    onChange={(e) =>
                      setOptions((list) =>
                        e.target.checked ? [...list, o] : list.filter((x) => x !== o),
                      )
                    }
                  />
                  {OPTIONS[o]}
                </label>
              ))}
            </div>
            <Field label="Haydovchiga izoh">
              {(p) => (
                <textarea
                  {...p}
                  value={comment}
                  maxLength={500}
                  placeholder="Masalan: darvoza oldida kutadi, 2 ta chamadon"
                  onChange={(e) => setComment(e.target.value)}
                />
              )}
            </Field>
          </section>

          <section className="card">
            <h2>
              <CalendarClock size={17} aria-hidden /> Vaqti
            </h2>
            <Segmented
              label="Qachon"
              value={later ? 'later' : 'now'}
              onChange={(v) => {
                if (v === 'later' && !canSchedule) return;
                setLater(v === 'later');
                if (v === 'later' && !laterAt) {
                  // a round time about an hour ahead, as callers usually ask
                  const t = Date.now() + 60 * 60_000;
                  setLaterAt(isoToTashkentLocal(Math.ceil(t / 900_000) * 900_000));
                }
              }}
              options={[
                { value: 'now', label: 'Hozir' },
                { value: 'later', label: 'Keyinroqqa' },
              ]}
            />
            {!canSchedule ? (
              <p className="muted small">
                Telefon orqali keyinroqqa buyurtma serverda hali yoqilmagan: mijoz ilovadan buyurtma
                berishi mumkin.
              </p>
            ) : later ? (
              <Field
                label="Qachonga (Toshkent vaqti)"
                hint={`${SCHEDULE_MIN_MINUTES} daqiqadan ${SCHEDULE_MAX_HOURS} soatgacha oldin; narx shu vaqt bo‘yicha, faqat naqd. Qidiruv 15 daqiqa oldin boshlanadi.`}
                error={laterProblem}
              >
                {(p) => (
                  <input
                    {...p}
                    type="datetime-local"
                    value={laterAt}
                    min={isoToTashkentLocal(Date.now() + SCHEDULE_MIN_MINUTES * 60_000)}
                    max={isoToTashkentLocal(Date.now() + SCHEDULE_MAX_HOURS * 3600_000)}
                    onChange={(e) => setLaterAt(e.target.value)}
                  />
                )}
              </Field>
            ) : (
              <p className="muted small">Haydovchi darhol qidiriladi.</p>
            )}
          </section>
        </div>

        <div className="order-side">
          <div className="order-map-card">
            <p className="map-hint" aria-live="polite">
              <MapPin size={14} aria-hidden /> Xaritani bossangiz:{' '}
              <strong>{TARGET_LABEL[target]}</strong>
            </p>
            <GeoMap
              config={config}
              layers={layers}
              onClick={onMapClick}
              view={view}
              className="order-map"
              label="Buyurtma manzillari xaritasi"
              fit={
                pickup.point && dropoff.point
                  ? {
                      key: `${pickup.point.lat},${pickup.point.lng};${dropoff.point.lat},${dropoff.point.lng}`,
                      points: [pickup.point, dropoff.point],
                      maxZoom: 16,
                    }
                  : undefined
              }
            />
          </div>

          <section className="card quote-card" aria-live="polite">
            <h2>Narx</h2>
            {!trip ? (
              <p className="muted">Ikkala manzil belgilangach narx hisoblanadi.</p>
            ) : quote.isPending ? (
              <p className="muted">
                <Spinner size={14} /> Hisoblanmoqda…
              </p>
            ) : quote.error ? (
              <ErrorBox error={quote.error} onRetry={() => void quote.refetch()} />
            ) : (
              <>
                <div className="quote-total">
                  <strong>{som(fare!.total)}</strong>
                  <Badge tone="brand">{CLASSES[rideClass]}</Badge>
                  {quote.data.kind === 'intercity' && <Badge tone="blue">Shaharlararo</Badge>}
                  {quote.isFetching && <Spinner size={14} />}
                </div>
                <dl className="facts">
                  <div>
                    <dt>Masofa</dt>
                    <dd>{distance(quote.data.distanceM)}</dd>
                  </div>
                  <div>
                    <dt>Yo‘lda</dt>
                    <dd>{duration(quote.data.durationS)}</dd>
                  </div>
                  <div>
                    <dt>Shahar</dt>
                    <dd>{quote.data.city.name}</dd>
                  </div>
                  {fare!.outside > 0 && (
                    <div>
                      <dt>Shahar tashqarisi</dt>
                      <dd>{som(fare!.outside)}</dd>
                    </div>
                  )}
                  {fare!.night > 0 && (
                    <div>
                      <dt>Tungi qo‘shimcha</dt>
                      <dd>{som(fare!.night)}</dd>
                    </div>
                  )}
                  {Object.entries(fare!.options).map(([o, v]) => (
                    <div key={o}>
                      <dt>{OPTIONS[o as RideOption]}</dt>
                      <dd>{som(v ?? 0)}</dd>
                    </div>
                  ))}
                  {fare!.seat && (
                    <div>
                      <dt>Bir o‘rindiq (orqa / old)</dt>
                      <dd>
                        {som(fare!.seat.rear)} / {som(fare!.seat.front)}
                      </dd>
                    </div>
                  )}
                </dl>
                {owedFee && owedFee.amount > 0 && (
                  <p className="small owed-line">
                    + oldingi bekor qilingan safar uchun <strong>{som(owedFee.amount)}</strong>{' '}
                    (alohida, naqd): mijozga jami{' '}
                    <strong>{som(fare!.total + owedFee.amount)}</strong>
                  </p>
                )}
                {scheduledFor && (
                  <p className="small">
                    <CalendarClock size={14} aria-hidden /> Narx{' '}
                    <strong>{dateTime(scheduledFor)}</strong> vaqti uchun qat’iy.
                  </p>
                )}
                <p className="muted small">
                  Kutish: {quote.data.waiting.free_minutes} daqiqa bepul, keyin{' '}
                  {som(quote.data.waiting.per_minute)}/daq. Naqd to‘lov.
                </p>
              </>
            )}
            {submitted && problems.length > 0 && (
              <ul className="problems" role="alert">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {order.error && (
              <div className="alert alert-error" role="alert">
                <CircleAlert size={16} aria-hidden />
                <span>
                  {errorText(order.error)}
                  {quoteExpired && '. Narx qayta hisoblandi: mijozga yangi narxni ayting.'}
                </span>
                {conflictRideId && (
                  <Link to={`/dispatch?ride=${conflictRideId}`} className="btn btn-sm">
                    Ochish
                  </Link>
                )}
              </div>
            )}
            <Button
              variant="primary"
              size="lg"
              className="btn-block"
              icon={<Send size={17} />}
              loading={order.isPending}
              disabled={submitted && !canOrder}
              onClick={submit}
            >
              Buyurtma berish{fare ? ` · ${som(fare.total)}` : ''}
            </Button>
            {normalized && (
              <p className="muted small center">
                {formatPhone(normalized)} raqamiga SMS bilan xabar beriladi
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
