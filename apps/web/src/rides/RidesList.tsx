import { PhoneCall, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDrivers, useRides } from '../api/queries';
import { RIDE_STATUSES, type RideStatus } from '../api/types';
import { CLASSES, dateTime, RIDE_STATUS_SHORT, RIDE_STATUS_TONE, som } from '../lib/format';
import { formatPhone } from '../lib/phone';
import { filterRides, needsDriver, placeLine } from '../lib/rides';
import { useDebounced } from '../map/places';
import { Badge, PageHeader } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';

type StatusFilter = RideStatus | 'open';
const STATUS_OPTIONS: StatusFilter[] = ['open', ...RIDE_STATUSES];

/**
 * Rides by status, rider phone or ride number (server side); date and driver narrow the
 * result here, because the API has no such filters (it returns the newest 200).
 */
export default function RidesList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusFilter | null) ?? 'open';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [driverId, setDriverId] = useState('');
  const query = useDebounced(q.replace(/[\s\-()+]/g, ''), 350);
  const rides = useRides(status, query);
  const drivers = useDrivers('all');

  const shown = useMemo(
    () => (rides.data ? filterRides(rides.data, { from, to, driverId }) : []),
    [rides.data, from, to, driverId],
  );
  const driverName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers.data ?? []) m.set(d.id, d.fullName);
    return m;
  }, [drivers.data]);

  const setStatus = (s: StatusFilter) => {
    const next = new URLSearchParams(params);
    next.set('status', s);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Safarlar"
        subtitle="Holat, telefon yoki raqam bo‘yicha qidiruv; sana va haydovchi — ro‘yxat ichida"
        actions={
          <Link to="/phone-order" className="btn btn-primary btn-sm">
            <PhoneCall size={15} aria-hidden /> Telefon buyurtma
          </Link>
        }
      />
      <div className="filters">
        <label className="sr-only" htmlFor="ride-status">
          Holat
        </label>
        <select
          id="ride-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'open' ? 'Barcha ochiqlar' : RIDE_STATUS_SHORT[s]}
            </option>
          ))}
        </select>
        <div className="search search-sm">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Telefon yoki buyurtma raqami"
            placeholder="Telefon yoki №"
            value={q}
            maxLength={20}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="date-filter">
          dan
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="date-filter">
          gacha
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="sr-only" htmlFor="ride-driver">
          Haydovchi
        </label>
        <select id="ride-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Barcha haydovchilar</option>
          {(drivers.data ?? [])
            .filter((d) => d.status === 'active' || d.status === 'blocked')
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.plateFormatted ? ` · ${d.plateFormatted}` : ''}
              </option>
            ))}
        </select>
      </div>

      {rides.error ? (
        <ErrorBox error={rides.error} onRetry={() => void rides.refetch()} />
      ) : rides.isPending ? (
        <Loading />
      ) : !shown.length ? (
        <Empty title="Safar topilmadi">Filtrlarni o‘zgartiring.</Empty>
      ) : (
        <div className="card table-card">
          {rides.data.length >= 200 && (
            <p className="table-note muted small">
              Eng yangi 200 ta ko‘rsatildi: aniqroq qidirish uchun telefon yoki raqamni kiriting.
            </p>
          )}
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Vaqt</th>
                <th>Holat</th>
                <th>Yo‘lovchi</th>
                <th>Yo‘nalish</th>
                <th>Haydovchi</th>
                <th className="num">Narx</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="row-link" onClick={() => navigate(`/rides/${r.id}`)}>
                  <td>
                    <Link to={`/rides/${r.id}`} onClick={(e) => e.stopPropagation()}>
                      #{r.number}
                    </Link>
                    {r.channel === 'phone' && (
                      <PhoneCall size={12} className="muted" aria-label=" telefon" />
                    )}
                  </td>
                  <td className="nowrap">{dateTime(r.requestedAt)}</td>
                  <td>
                    <Badge tone={needsDriver(r) ? 'red' : RIDE_STATUS_TONE[r.status]}>
                      {needsDriver(r) ? 'Haydovchi yo‘q' : RIDE_STATUS_SHORT[r.status]}
                    </Badge>
                  </td>
                  <td>
                    {r.riderName && <div>{r.riderName}</div>}
                    <span className="muted small">{formatPhone(r.riderPhone)}</span>
                  </td>
                  <td className="cell-text">
                    <div className="clamp-2">
                      {placeLine(r.pickup)} → {placeLine(r.dropoff)}
                    </div>
                    <span className="muted small">{CLASSES[r.class]}</span>
                  </td>
                  <td>
                    {r.driverId ? (driverName.get(r.driverId) ?? 'Haydovchi') : '—'}
                    {r.vehicle && (
                      <div className="muted small plate-inline">{r.vehicle.plateFormatted}</div>
                    )}
                  </td>
                  <td className="num">{som(r.fare.total ?? r.fare.quoted)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
