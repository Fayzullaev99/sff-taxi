import { CalendarClock, PhoneCall } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { AdminRideItem } from '../api/types';
import { CLASSES, dateTime, RIDE_STATUS_SHORT, RIDE_STATUS_TONE, som } from '../lib/format';
import { formatPhone } from '../lib/phone';
import { needsDriver, placeLine } from '../lib/rides';
import { Badge } from '../ui/controls';
import { LoadMore } from '../ui/LoadMore';

/** One ride as a table row: number, time (and the time it is ordered for), status, route. */
function RideRow({
  ride: r,
  driverName,
  showDriver,
}: {
  ride: AdminRideItem;
  driverName: (id: string) => string | null;
  showDriver: boolean;
}) {
  const navigate = useNavigate();
  const alert = needsDriver(r);
  return (
    <tr className="row-link" onClick={() => navigate(`/rides/${r.id}`)}>
      <td>
        <Link to={`/rides/${r.id}`} onClick={(e) => e.stopPropagation()}>
          #{r.number}
        </Link>
        {r.channel === 'phone' && <PhoneCall size={12} className="muted" aria-label=" telefon" />}
      </td>
      <td className="nowrap">
        {dateTime(r.requestedAt)}
        {r.scheduledFor && (
          <div className="small">
            <CalendarClock size={12} aria-hidden /> {dateTime(r.scheduledFor)} ga
          </div>
        )}
      </td>
      <td>
        <Badge tone={alert ? 'red' : RIDE_STATUS_TONE[r.status]}>
          {alert ? 'Haydovchi yo‘q' : RIDE_STATUS_SHORT[r.status]}
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
        <span className="muted small">
          {CLASSES[r.class]}
          {r.kind === 'intercity' && ' · shaharlararo'}
        </span>
      </td>
      {showDriver && (
        <td>
          {r.driverId ? (driverName(r.driverId) ?? 'Haydovchi') : '—'}
          {r.vehicle && <div className="muted small plate-inline">{r.vehicle.plateFormatted}</div>}
        </td>
      )}
      <td className="num">{som(r.fare.total ?? r.fare.quoted)}</td>
    </tr>
  );
}

/** A table of rides with "Ko‘proq" for the next page. */
export function RideRows({
  rides,
  driverName = () => null,
  showDriver = true,
  hasMore,
  loadingMore,
  onMore,
}: {
  rides: AdminRideItem[];
  driverName?: (id: string) => string | null;
  showDriver?: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  return (
    <div className="card table-card">
      <table className="table">
        <thead>
          <tr>
            <th>№</th>
            <th>Vaqt</th>
            <th>Holat</th>
            <th>Yo‘lovchi</th>
            <th>Yo‘nalish</th>
            {showDriver && <th>Haydovchi</th>}
            <th className="num">Narx</th>
          </tr>
        </thead>
        <tbody>
          {rides.map((r) => (
            <RideRow key={r.id} ride={r} driverName={driverName} showDriver={showDriver} />
          ))}
        </tbody>
      </table>
      <LoadMore shown={rides.length} hasMore={hasMore} loading={loadingMore} onMore={onMore} />
    </div>
  );
}
