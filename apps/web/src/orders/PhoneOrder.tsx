import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleAlert,
  CircleCheck,
  History,
  MapPin,
  PhoneCall,
  RotateCcw,
  Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, errorText } from '../api/client';
import type {
  AdminRide,
  AdminRideItem,
  GeoAddress,
  GeoConfig,
  LatLng,
  Quote,
  RideClass,
  RideOption,
} from '../api/types';
import { RIDE_OPTIONS } from '../api/types';
import { CLASSES, dateTime, distance, duration, OPTIONS, RIDE_STATUS, som } from '../lib/format';
import { formatPhone, isUzPhone, normalizePhone } from '../lib/phone';
import { knownPlaces, type KnownPlace, placeLine } from '../lib/rides';
import type { MapLayers, MarkerSpec } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { AddressSearch, addressLine, cityLayers, useDebounced, useReverse } from '../map/places';
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

/** The caller's history: an open ride blocks a new one; past places are offered as shortcuts. */
function useCaller(phone: string | null) {
  return useQuery({
    queryKey: ['caller', phone],
    queryFn: async () => {
      const get = (status: string) =>
        api<AdminRideItem[]>(`/v1/admin/rides?status=${status}&q=${encodeURIComponent(phone!)}`);
      const [open, completed, cancelled] = await Promise.all([
        get('open'),
        get('completed'),
        get('cancelled'),
      ]);
      // the API matches phones by substring: keep this caller's rides only
      const mine = (list: AdminRideItem[]) => list.filter((r) => r.riderPhone === phone);
      return { open: mine(open), completed: mine(completed), cancelled: mine(cancelled) };
    },
    enabled: phone !== null,
    staleTime: 30_000,
  });
}

function newRequestId(): string {
  return crypto.randomUUID();
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
  places: KnownPlace[];
  onUse: (target: Target, p: KnownPlace) => void;
}) {
  if (!places.length) return null;
  return (
    <div className="known-places">
      <h3 className="subhead">
        <History size={14} aria-hidden /> Avvalgi manzillari
      </h3>
      <ul className="plain-list">
        {places.map((p) => (
          <li key={`${p.lat},${p.lng}`} className="known-place">
            <span className="wrap">
              {placeLine(p)} <span className="muted small">· {p.uses} marta</span>
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

function Created({
  ride,
  quoted,
  onNew,
}: {
  ride: AdminRide;
  quoted: number | null;
  onNew: () => void;
}) {
  return (
    <div className="card created-card" role="status">
      <h2>
        <CircleCheck size={20} aria-hidden /> #{ride.number} buyurtma qabul qilindi
      </h2>
      <p>
        {placeLine(ride.pickup)} → {placeLine(ride.dropoff)}
      </p>
      <p>
        <strong>{som(ride.fare.quoted)}</strong> · {CLASSES[ride.class]} · naqd ·{' '}
        {RIDE_STATUS[ride.status]}
      </p>
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
  const [view, setView] = useState<{ key: string; center: LatLng; zoom?: number }>();
  const [created, setCreated] = useState<{ ride: AdminRide; quoted: number | null } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  // one id per order attempt: a retried request after a network error is the same attempt
  const requestId = useRef(newRequestId());
  const phoneRef = useRef<HTMLInputElement>(null);

  const normalized = isUzPhone(phone) ? normalizePhone(phone) : null;
  const caller = useCaller(normalized);
  const openRide = caller.data?.open[0] ?? null;
  const history = useMemo(
    () => (caller.data ? [...caller.data.completed, ...caller.data.cancelled] : []),
    [caller.data],
  );
  const places = useMemo(() => knownPlaces(history), [history]);
  const knownName = history.find((r) => r.riderName)?.riderName ?? openRide?.riderName ?? null;

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
  const applyKnown = (t: Target, p: KnownPlace) => {
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

  // the fixed price for both classes; recomputed when the trip or options change
  const trip = useDebounced(
    pickup.point && dropoff.point
      ? { pickup: pickup.point, dropoff: dropoff.point, options: [...options].sort() }
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
      api<AdminRide>('/v1/admin/rides', {
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
          // not read by the API yet (it refuses a second open ride per caller instead);
          // sent so a retried attempt can be recognised once it is
          clientRequestId: requestId.current,
        },
      }),
    onSuccess: (ride) => {
      setCreated({ ride, quoted: fare?.total ?? null });
      requestId.current = newRequestId();
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      void queryClient.invalidateQueries({ queryKey: ['rides'] });
      void queryClient.invalidateQueries({ queryKey: ['caller'] });
      toast(`#${ride.number} buyurtma qabul qilindi`);
    },
  });
  const conflictRideId =
    order.error instanceof ApiError && order.error.status === 409
      ? ((order.error.body as { rideId?: string } | null)?.rideId ?? null)
      : null;

  const problems: string[] = [];
  if (!normalized) problems.push('Mijozning telefon raqamini kiriting');
  if (!pickup.point) problems.push('Olib ketish joyini belgilang');
  if (!dropoff.point) problems.push('Borish manzilini belgilang');
  if (openRide) problems.push(`Mijozda tugallanmagan buyurtma bor: #${openRide.number}`);
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
        <Created ride={created.ride} quoted={created.quoted} onNew={reset} />
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
                  <div className="alert alert-error">
                    <CircleAlert size={16} aria-hidden />
                    <span>
                      Tugallanmagan buyurtma bor: <strong>#{openRide.number}</strong> (
                      {RIDE_STATUS[openRide.status]}, {dateTime(openRide.requestedAt)}). Yangi
                      buyurtma berib bo‘lmaydi.
                    </span>
                    <Link to={`/dispatch?ride=${openRide.id}`} className="btn btn-sm">
                      Ochish
                    </Link>
                  </div>
                ) : history.length ? (
                  <p className="muted small">
                    Doimiy mijoz: {caller.data.completed.length} ta safar
                    {caller.data.cancelled.length > 0 &&
                      `, ${caller.data.cancelled.length} ta bekor qilingan`}
                    .
                  </p>
                ) : (
                  <p className="muted small">Yangi mijoz: hisob buyurtma bilan birga ochiladi.</p>
                )}
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
                <span>{errorText(order.error)}</span>
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
