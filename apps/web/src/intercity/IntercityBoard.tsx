import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, errorText } from '../api/client';
import { useIntercityPoints, useRoutePrices, useTrips } from '../api/queries';
import {
  type AdminTrip,
  type IntercityFare,
  type IntercityPoint,
  type PublicTrip,
  TRIP_STATUSES,
  type TripStatus,
} from '../api/types';
import {
  CLASSES,
  dateTime,
  distance,
  som,
  tashkentToday,
  TRIP_STATUS,
  TRIP_TONE,
} from '../lib/format';
import { routePriceProblems } from '../lib/intercity';
import { formatPhone } from '../lib/phone';
import { Badge, Button, Field, MoneyInput, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { BookDialog } from './BookDialog';

type Tab = 'trips' | 'book' | 'fares';

/** The busiest route first: Guliston → Tashkent (market analysis §3). */
function defaultRoute(points: IntercityPoint[]): { from: string; to: string } {
  const from = points.find((p) => p.slug === 'guliston') ?? points[0];
  const to =
    points.find((p) => p.slug === 'toshkent' && p !== from) ?? points.find((p) => p !== from);
  return { from: from?.slug ?? '', to: to?.slug ?? '' };
}

function PointSelect({
  id,
  label,
  value,
  points,
  onChange,
  any,
}: {
  id: string;
  label: string;
  value: string;
  points: IntercityPoint[];
  onChange: (slug: string) => void;
  any?: string;
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {any !== undefined && <option value="">{any}</option>}
        {points.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.nameUz}
          </option>
        ))}
      </select>
    </>
  );
}

function Seats({ trip }: { trip: Pick<PublicTrip, 'seats'> }) {
  const { total, free, frontOffered, frontFree } = trip.seats;
  return (
    <>
      <strong>{free}</strong> / {total} bo‘sh
      {frontOffered && (
        <div className="muted small">old o‘rindiq {frontFree ? 'bo‘sh' : 'band'}</div>
      )}
    </>
  );
}

/** The departures board for operators: every trip by status, day and route. */
function TripsTab({ points }: { points: IntercityPoint[] }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as TripStatus | '';
  const date = params.get('date') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const trips = useTrips({ status, date, from, to });
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  return (
    <>
      <div className="filters">
        <label className="sr-only" htmlFor="trip-status">
          Holat
        </label>
        <select id="trip-status" value={status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Barcha holatlar</option>
          {TRIP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TRIP_STATUS[s]}
            </option>
          ))}
        </select>
        <label className="date-filter">
          kuni
          <input type="date" value={date} onChange={(e) => set('date', e.target.value)} />
        </label>
        <PointSelect
          id="trip-from"
          label="Qayerdan"
          value={from}
          points={points}
          onChange={(v) => set('from', v)}
          any="Qayerdan: hammasi"
        />
        <PointSelect
          id="trip-to"
          label="Qayerga"
          value={to}
          points={points}
          onChange={(v) => set('to', v)}
          any="Qayerga: hammasi"
        />
      </div>
      {trips.error ? (
        <ErrorBox error={trips.error} onRetry={() => void trips.refetch()} />
      ) : trips.isPending ? (
        <Loading />
      ) : !trips.data.length ? (
        <Empty title="Qatnov topilmadi">
          Haydovchilar ilovadan qatnov e’lon qiladi. Filtrlarni o‘zgartiring.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Jo‘nash</th>
                <th>Yo‘nalish</th>
                <th>Haydovchi</th>
                <th>Joylar</th>
                <th className="num">Narx (orqa / old)</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {trips.data.map((t: AdminTrip) => (
                <tr key={t.id} className="row-link" onClick={() => navigate(`/intercity/${t.id}`)}>
                  <td>
                    <Link to={`/intercity/${t.id}`} onClick={(e) => e.stopPropagation()}>
                      #{t.number}
                    </Link>
                  </td>
                  <td className="nowrap">{dateTime(t.departureAt)}</td>
                  <td>
                    {t.from.nameUz} → {t.to.nameUz}
                    <div className="muted small">
                      {CLASSES[t.class]} · {distance(t.distanceM)}
                    </div>
                  </td>
                  <td>
                    {t.driver.name}
                    <div className="muted small">
                      {formatPhone(t.driver.phone)} ·{' '}
                      <span className="plate-inline">{t.vehicle.plateFormatted}</span>
                    </div>
                  </td>
                  <td>
                    <Seats trip={t} />
                  </td>
                  <td className="num">
                    {som(t.price.rear)} / {som(t.price.front)}
                  </td>
                  <td>
                    <Badge tone={TRIP_TONE[t.status]}>{TRIP_STATUS[t.status]}</Badge>
                    {t.bookings.length > 0 && (
                      <div className="muted small">{t.bookings.length} ta bron</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {trips.data.length >= 200 && (
            <p className="table-note muted small">
              Eng yangi 200 ta: aniqroq ko‘rish uchun kun yoki yo‘nalishni tanlang.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** A caller asks for a seat: open departures of a route on a day, then book. */
function BookTab({ points }: { points: IntercityPoint[] }) {
  const [from, setFrom] = useState(() => defaultRoute(points).from);
  const [to, setTo] = useState(() => defaultRoute(points).to);
  const [date, setDate] = useState(tashkentToday());
  const [seats, setSeats] = useState(1);
  const [booking, setBooking] = useState<PublicTrip | null>(null);
  const same = from !== '' && from === to;
  const search = useQuery({
    queryKey: ['intercity', 'search', from, to, date, seats],
    queryFn: () =>
      api<PublicTrip[]>(
        `/v1/admin/intercity/search?${new URLSearchParams({ from, to, date, seats: String(seats) })}`,
      ),
    enabled: Boolean(from && to && date) && !same,
  });
  return (
    <>
      <div className="filters">
        <PointSelect
          id="book-from"
          label="Qayerdan"
          value={from}
          points={points}
          onChange={setFrom}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<ArrowRightLeft size={15} />}
          aria-label="Yo‘nalishni almashtirish"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        />
        <PointSelect id="book-to" label="Qayerga" value={to} points={points} onChange={setTo} />
        <label className="date-filter">
          kuni
          <input
            type="date"
            value={date}
            min={tashkentToday()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="date-filter">
          joy
          <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {same ? (
        <div className="alert alert-warn">Jo‘nash va borish shahri bir xil.</div>
      ) : search.error ? (
        <ErrorBox error={search.error} onRetry={() => void search.refetch()} />
      ) : search.isPending ? (
        <Loading />
      ) : !search.data.length ? (
        <Empty title="Bo‘sh joyli qatnov yo‘q" icon={<Search size={32} aria-hidden />}>
          Boshqa kun yoki kamroq joy tanlang.
        </Empty>
      ) : (
        <ul className="trip-cards">
          {search.data.map((t) => (
            <li key={t.id} className="card trip-card">
              <div className="trip-card-main">
                <strong className="trip-time">{dateTime(t.departureAt)}</strong>
                <span>
                  {t.vehicle.colour} {t.vehicle.make} {t.vehicle.model} · {CLASSES[t.class]}
                </span>
                <span className="muted small">
                  {t.driver.name} · {t.driver.rating.toFixed(1).replace('.', ',')} ★ ·{' '}
                  {t.driver.ridesCompleted} safar
                </span>
                <span className="muted small">Uchrashuv: {t.meetingPoint}</span>
                {t.comment && <span className="small">“{t.comment}”</span>}
              </div>
              <div className="trip-card-side">
                <span>
                  <Seats trip={t} />
                </span>
                <span className="small">
                  {som(t.price.rear)}
                  {t.seats.frontFree && ` · old ${som(t.price.front)}`}
                </span>
                <Button size="sm" variant="primary" onClick={() => setBooking(t)}>
                  Bron qilish
                </Button>
                <Link to={`/intercity/${t.id}`} className="small">
                  #{t.number} batafsil
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
      {booking && <BookDialog trip={booking} onClose={() => setBooking(null)} />}
    </>
  );
}

/** Operators' fixed seat prices per route; without one, the tariff's share applies. */
function FaresTab({ points }: { points: IntercityPoint[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const prices = useRoutePrices();
  const [from, setFrom] = useState(() => defaultRoute(points).from);
  const [to, setTo] = useState(() => defaultRoute(points).to);
  const [rear, setRear] = useState<number | null>(null);
  const [front, setFront] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const name = useMemo(() => {
    const m = new Map(points.map((p) => [p.slug, p.nameUz]));
    return (slug: string) => m.get(slug) ?? slug;
  }, [points]);
  const same = from === to;
  const reference = useQuery({
    queryKey: ['intercity', 'fare', from, to],
    queryFn: () =>
      api<IntercityFare>(
        `/v1/intercity/fares?${new URLSearchParams({ from, to, class: 'economy' })}`,
      ),
    enabled: Boolean(from && to) && !same,
  });
  const problems = routePriceProblems(rear, front);

  const save = useMutation({
    mutationFn: (body: { from: string; to: string; rear: number | null; front: number | null }) =>
      api<IntercityFare>('/v1/admin/intercity/fares', { method: 'PUT', body }),
    onSuccess: (fare, body) => {
      void queryClient.invalidateQueries({ queryKey: ['intercity', 'fares'] });
      void queryClient.invalidateQueries({ queryKey: ['intercity', 'fare'] });
      toast(
        body.rear === null
          ? `${fare.from.nameUz} → ${fare.to.nameUz}: tarif narxi qaytdi`
          : `${fare.from.nameUz} → ${fare.to.nameUz}: ${som(fare.reference.rear)} / ${som(fare.reference.front)}`,
      );
      setTouched(false);
    },
  });

  const edit = (f: { from: string; to: string; rear: number; front: number }) => {
    setFrom(f.from);
    setTo(f.to);
    setRear(f.rear);
    setFront(f.front);
    save.reset();
  };

  return (
    <div className="fares-layout">
      <section className="card">
        <h2>Yo‘nalish narxi</h2>
        <p className="muted small">
          Yangi qatnovlar shu narxdan boshlanadi; haydovchi belgilangan oraliqda o‘zgartira oladi.
          Komfort mashinalar tarif nisbatida qimmatroq. E’lon qilingan qatnovlar narxi o‘zgarmaydi.
        </p>
        <div className="grid-2">
          <Field label="Qayerdan">
            {(p) => (
              <select {...p} value={from} onChange={(e) => setFrom(e.target.value)}>
                {points.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.nameUz}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Qayerga" error={same ? 'Boshqa shaharni tanlang' : null}>
            {(p) => (
              <select {...p} value={to} onChange={(e) => setTo(e.target.value)}>
                {points.map((x) => (
                  <option key={x.slug} value={x.slug}>
                    {x.nameUz}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Orqa o‘rindiq" error={touched ? problems.rear : undefined}>
            {(p) => <MoneyInput {...p} value={rear} onChange={setRear} />}
          </Field>
          <Field label="Old o‘rindiq" error={touched ? problems.front : undefined}>
            {(p) => <MoneyInput {...p} value={front} onChange={setFront} />}
          </Field>
        </div>
        {!same && (
          <p className="muted small" aria-live="polite">
            {reference.isPending
              ? 'Hozirgi narx hisoblanmoqda…'
              : reference.data
                ? `Hozir (${reference.data.source === 'route' ? 'yo‘nalish narxi' : 'tarif bo‘yicha'}): ${som(reference.data.reference.rear)} / ${som(reference.data.reference.front)} · ${distance(reference.data.distanceM)} · haydovchi oralig‘i ${som(reference.data.band.min)}–${som(reference.data.band.max)}`
                : reference.error
                  ? errorText(reference.error)
                  : ''}
          </p>
        )}
        {save.error && <ErrorBox error={save.error} />}
        <div className="form-actions">
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            loading={save.isPending}
            disabled={same}
            onClick={() => {
              setTouched(true);
              if (problems.rear || problems.front || same) return;
              void confirm({
                title: 'Yo‘nalish narxini saqlash',
                text: `${name(from)} → ${name(to)}: orqa ${som(rear!)}, old ${som(front!)}. Yangi qatnovlarga amal qiladi.`,
                confirm: 'Saqlash',
              }).then((ok) => ok && save.mutate({ from, to, rear, front }));
            }}
          >
            Saqlash
          </Button>
        </div>
      </section>

      <section className="card table-card">
        {prices.error ? (
          <ErrorBox error={prices.error} onRetry={() => void prices.refetch()} />
        ) : prices.isPending ? (
          <Loading />
        ) : !prices.data.length ? (
          <Empty title="Belgilangan narx yo‘q">Hamma yo‘nalishlar tarif bo‘yicha.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Yo‘nalish</th>
                <th className="num">Orqa</th>
                <th className="num">Old</th>
                <th>Yangilangan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {prices.data.map((f) => (
                <tr key={`${f.from}-${f.to}`}>
                  <td>
                    {name(f.from)} → {name(f.to)}
                  </td>
                  <td className="num">{som(f.rear)}</td>
                  <td className="num">{som(f.front)}</td>
                  <td className="nowrap">{dateTime(f.updatedAt)}</td>
                  <td className="actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={14} />}
                      aria-label={`${name(f.from)} → ${name(f.to)}: tahrirlash`}
                      onClick={() => edit(f)}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      aria-label={`${name(f.from)} → ${name(f.to)}: o‘chirish`}
                      onClick={() =>
                        void confirm({
                          title: 'Yo‘nalish narxini o‘chirish',
                          text: `${name(f.from)} → ${name(f.to)}: yangi qatnovlar tarif bo‘yicha narxlanadi.`,
                          confirm: 'O‘chirish',
                          danger: true,
                        }).then(
                          (ok) =>
                            ok && save.mutate({ from: f.from, to: f.to, rear: null, front: null }),
                        )
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/**
 * The intercity trip board (drivers publish departures between the Sirdaryo towns and
 * Tashkent, riders book seats): the operators' view of every trip, seats for callers, and
 * the route prices.
 */
export default function IntercityBoard() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'trips';
  const points = useIntercityPoints();
  return (
    <div>
      <PageHeader
        title="Shaharlararo"
        subtitle="Qatnovlar, qo‘ng‘iroq qilganlar uchun bron va yo‘nalish narxlari"
      />
      <div className="filters">
        <Segmented
          label="Bo‘lim"
          value={tab}
          onChange={(v) => setParams({ tab: v }, { replace: true })}
          options={[
            { value: 'trips', label: 'Qatnovlar' },
            { value: 'book', label: 'Mijoz uchun bron' },
            { value: 'fares', label: 'Yo‘nalish narxlari' },
          ]}
        />
      </div>
      {points.error ? (
        <ErrorBox error={points.error} onRetry={() => void points.refetch()} />
      ) : points.isPending ? (
        <Loading />
      ) : tab === 'book' ? (
        <BookTab points={points.data} />
      ) : tab === 'fares' ? (
        <FaresTab points={points.data} />
      ) : (
        <TripsTab points={points.data} />
      )}
    </div>
  );
}
