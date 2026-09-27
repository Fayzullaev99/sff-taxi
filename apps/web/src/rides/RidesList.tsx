import { PhoneCall, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type RideFilters, useDrivers, useRides } from '../api/queries';
import { RIDE_CLASSES, RIDE_STATUSES, type RideClass } from '../api/types';
import { CLASSES, RIDE_STATUS_SHORT } from '../lib/format';
import { useDebounced } from '../map/places';
import { Button, PageHeader } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';
import { RideRows } from './RideRows';

type StatusFilter = RideFilters['status'];
const STATUS_OPTIONS: StatusFilter[] = ['open', 'all', ...RIDE_STATUSES];

const statusLabel = (s: StatusFilter) =>
  s === 'open' ? 'Barcha ochiqlar' : s === 'all' ? 'Barcha holatlar' : RIDE_STATUS_SHORT[s];

/**
 * Rides by status, rider phone or ride number, driver, class and Tashkent days, all filtered
 * by the API; the newest 200 first, "Ko‘proq yuklash" loads the next page. The filters live
 * in the URL, so a filtered list can be shared and survives a reload.
 */
export default function RidesList() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusFilter | null) ?? 'open';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const driverId = params.get('driverId') ?? '';
  const rideClass = (params.get('class') as RideClass | null) ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const query = useDebounced(q.replace(/[\s\-()+]/g, ''), 350);
  const rangeError = from && to && from > to ? '“dan” sanasi “gacha” sanasidan keyin' : null;
  const rides = useRides({
    status,
    q: query,
    driverId,
    class: rideClass,
    // a reversed range would ask for nothing: wait until it is fixed
    from: rangeError ? '' : from,
    to: rangeError ? '' : to,
  });
  const drivers = useDrivers('all');

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const rows = useMemo(() => rides.data?.pages.flat() ?? [], [rides.data]);
  const driverName = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of drivers.data ?? []) m.set(d.id, d.fullName);
    return m;
  }, [drivers.data]);
  const filtered = Boolean(from || to || driverId || rideClass || query);

  return (
    <div>
      <PageHeader
        title="Safarlar"
        subtitle="Holat, telefon yoki raqam, haydovchi, tarif va sana bo‘yicha (Toshkent vaqti)"
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
        <select id="ride-status" value={status} onChange={(e) => set('status', e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
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
          <input type="date" value={from} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="date-filter">
          gacha
          <input type="date" value={to} onChange={(e) => set('to', e.target.value)} />
        </label>
        <label className="sr-only" htmlFor="ride-class">
          Tarif
        </label>
        <select id="ride-class" value={rideClass} onChange={(e) => set('class', e.target.value)}>
          <option value="">Barcha tariflar</option>
          {RIDE_CLASSES.map((c) => (
            <option key={c} value={c}>
              {CLASSES[c]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="ride-driver">
          Haydovchi
        </label>
        <select id="ride-driver" value={driverId} onChange={(e) => set('driverId', e.target.value)}>
          <option value="">Barcha haydovchilar</option>
          {(drivers.data ?? [])
            .filter((d) => d.status === 'active' || d.status === 'blocked' || d.id === driverId)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.plateFormatted ? ` · ${d.plateFormatted}` : ''}
              </option>
            ))}
        </select>
        {filtered && (
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={() => {
              setQ('');
              setParams({ status }, { replace: true });
            }}
          >
            Tozalash
          </Button>
        )}
      </div>
      {rangeError && <div className="alert alert-warn">{rangeError}</div>}

      {rides.error ? (
        <ErrorBox error={rides.error} onRetry={() => void rides.refetch()} />
      ) : rides.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Safar topilmadi">
          {filtered ? 'Filtrlarni o‘zgartiring.' : 'Bu holatda hozircha safar yo‘q.'}
        </Empty>
      ) : (
        <RideRows
          rides={rows}
          driverName={(id) => driverName.get(id) ?? null}
          hasMore={rides.hasNextPage}
          loadingMore={rides.isFetchingNextPage}
          onMore={() => void rides.fetchNextPage()}
        />
      )}
    </div>
  );
}
