import { ArrowLeft, Ban, TicketPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useTrip } from '../api/queries';
import type { AdminTrip, TripBooking } from '../api/types';
import {
  BOOKING_STATUS,
  BOOKING_TONE,
  CHANNELS,
  CLASSES,
  dateTime,
  distance,
  rating,
  som,
  TRIP_STATUS,
  TRIP_TONE,
} from '../lib/format';
import {
  BOOKING_CANCELLED_BY,
  bookingMoney,
  canCancelBooking,
  holdsSeats,
  isLiveBooking,
  isOpenTrip,
} from '../lib/intercity';
import { Badge, Button, PageHeader, PhoneLink } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { TextDialog } from '../ui/TextDialog';
import { BookDialog } from './BookDialog';

const TRIP_CANCEL_REASONS = [
  'Haydovchi qatnovni bekor qildi',
  'Mashina buzildi',
  'Yo‘lovchilar yetarli emas',
  'Ob-havo sababli',
];
const BOOKING_CANCEL_REASONS = [
  'Mijoz qo‘ng‘iroq qilib bekor qildi',
  'Takroriy bron',
  'Mijoz bilan bog‘lanib bo‘lmadi',
];

/** One departure: the car, the seats, every booking; book for a caller, cancel. */
export default function TripPage() {
  const { tripId } = useParams();
  const trip = useTrip(tripId);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [booking, setBooking] = useState(false);
  const [cancelTrip, setCancelTrip] = useState(false);
  const [cancelBooking, setCancelBooking] = useState<TripBooking | null>(null);

  if (trip.isPending) return <Loading />;
  if (trip.error) return <ErrorBox error={trip.error} onRetry={() => void trip.refetch()} />;
  const t = trip.data;
  const open = isOpenTrip(t.status);
  const departed = Date.parse(t.departureAt) <= Date.now();
  const live = t.bookings.filter((b) => isLiveBooking(b.status));
  const cash = live.reduce((sum, b) => sum + bookingMoney(b).cash, 0);
  const deposits = live.reduce((sum, b) => sum + bookingMoney(b).deposit, 0);
  const awaiting = t.bookings.filter((b) => b.status === 'awaiting_payment').length;
  const refresh = (updated?: AdminTrip) => {
    if (updated) queryClient.setQueryData(['intercity', 'trip', t.id], updated);
    void queryClient.invalidateQueries({ queryKey: ['intercity'] });
  };

  return (
    <div className="trip-page">
      <Link to="/intercity" className="back-link">
        <ArrowLeft size={16} aria-hidden /> Shaharlararo
      </Link>
      <PageHeader
        title={`#${t.number}: ${t.from.nameUz} → ${t.to.nameUz}`}
        subtitle={
          <>
            <Badge tone={TRIP_TONE[t.status]}>{TRIP_STATUS[t.status]}</Badge>{' '}
            <strong>{dateTime(t.departureAt)}</strong> · {CLASSES[t.class]} ·{' '}
            {distance(t.distanceM)}
          </>
        }
        actions={
          open && (
            <>
              <Button
                variant="primary"
                icon={<TicketPlus size={16} />}
                disabled={t.seats.free === 0 || departed}
                title={
                  t.seats.free === 0
                    ? 'Bo‘sh joy yo‘q'
                    : departed
                      ? 'Jo‘nash vaqti o‘tgan'
                      : undefined
                }
                onClick={() => setBooking(true)}
              >
                Mijoz uchun bron
              </Button>
              <Button variant="danger" icon={<Ban size={16} />} onClick={() => setCancelTrip(true)}>
                Qatnovni bekor qilish
              </Button>
            </>
          )
        }
      />
      {t.cancelReason && (
        <div className="alert alert-error">
          Bekor qilgan: {t.cancelledBy === 'driver' ? 'haydovchi' : 'operator'} — {t.cancelReason}
        </div>
      )}

      <div className="detail-grid">
        <section className="card">
          <h2>Haydovchi va mashina</h2>
          <p>
            <Link to={`/drivers/${t.driver.id}`}>
              <strong>{t.driver.name}</strong>
            </Link>{' '}
            <PhoneLink phone={t.driver.phone} />
          </p>
          <p className="small">
            {t.vehicle.colour} {t.vehicle.make} {t.vehicle.model} ·{' '}
            <span className="plate">{t.vehicle.plateFormatted}</span>
          </p>
          <p className="muted small">
            Reyting {rating(t.driver.rating)} · {t.driver.ridesCompleted} safar
          </p>
          <p className="small">
            Uchrashuv joyi: <strong>{t.meetingPoint}</strong>
          </p>
          {t.comment && <p className="small">Izoh: “{t.comment}”</p>}
        </section>
        <section className="card">
          <h2>Joylar va narx</h2>
          <dl className="facts facts-2">
            <div>
              <dt>Bo‘sh joy</dt>
              <dd>
                {t.seats.free} / {t.seats.total}
              </dd>
            </div>
            <div>
              <dt>Old o‘rindiq</dt>
              <dd>
                {!t.seats.frontOffered ? 'taklif qilinmagan' : t.seats.frontFree ? 'bo‘sh' : 'band'}
              </dd>
            </div>
            <div>
              <dt>Orqa / old</dt>
              <dd>
                {som(t.price.rear)} / {som(t.price.front)}
              </dd>
            </div>
            {t.referenceRear !== null && (
              <div>
                <dt>Tavsiya narxi (orqa)</dt>
                <dd>{som(t.referenceRear)}</dd>
              </div>
            )}
            <div>
              <dt>Faol bronlar summasi</dt>
              <dd>
                {som(cash)} naqd
                {deposits > 0 && (
                  <div className="muted small">+ {som(deposits)} depozit (karta)</div>
                )}
              </dd>
            </div>
            {awaiting > 0 && (
              <div>
                <dt>Depozit kutilmoqda</dt>
                <dd>{awaiting} ta bron (joylar ushlab turiladi)</dd>
              </div>
            )}
            {t.boardingAt && (
              <div>
                <dt>Chiqish boshlandi</dt>
                <dd>{dateTime(t.boardingAt)}</dd>
              </div>
            )}
            {t.departedAt && (
              <div>
                <dt>Jo‘nadi</dt>
                <dd>{dateTime(t.departedAt)}</dd>
              </div>
            )}
            {t.arrivedAt && (
              <div>
                <dt>Yetib keldi</dt>
                <dd>{dateTime(t.arrivedAt)}</dd>
              </div>
            )}
          </dl>
        </section>
      </div>

      <section className="card table-card">
        <div className="card-head table-head">
          <h2>Bronlar ({t.bookings.length})</h2>
        </div>
        {!t.bookings.length ? (
          <Empty title="Bron yo‘q">Yo‘lovchilar ilovadan yoki operator orqali bron qiladi.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Yo‘lovchi</th>
                <th>Joy</th>
                <th>Olib ketish</th>
                <th className="num">Narx</th>
                <th>Holat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.bookings.map((b) => (
                <tr key={b.id}>
                  <td>
                    #{b.number}
                    <div className="muted small">{CHANNELS[b.channel]}</div>
                  </td>
                  <td>
                    {b.riderName ?? 'Ismi yo‘q'}
                    <div>
                      <PhoneLink phone={b.riderPhone} />
                    </div>
                  </td>
                  <td>
                    {b.seats}
                    {b.front && <div className="muted small">old o‘rindiq bilan</div>}
                  </td>
                  <td className="cell-text">
                    {b.alongTheWay && b.pickup && b.dropoff && (
                      <div>
                        <Badge tone="blue">Yo‘l ustida</Badge> {b.pickup.nameUz} →{' '}
                        {b.dropoff.nameUz}
                      </div>
                    )}
                    {b.pickupNote ?? (!b.alongTheWay && <span className="muted">—</span>)}
                  </td>
                  <td className="num">
                    {som(b.price)}
                    {bookingMoney(b).deposit > 0 && (
                      <div className="muted small">
                        depozit {som(bookingMoney(b).deposit)} · naqd {som(bookingMoney(b).cash)}
                      </div>
                    )}
                    {b.cancellationFee > 0 && (
                      <div className="muted small">jarima {som(b.cancellationFee)}</div>
                    )}
                  </td>
                  <td>
                    <Badge tone={BOOKING_TONE[b.status]}>{BOOKING_STATUS[b.status]}</Badge>
                    {b.status === 'cancelled' && b.cancelledBy && (
                      <div className="muted small">
                        {BOOKING_CANCELLED_BY[b.cancelledBy] ?? b.cancelledBy}
                      </div>
                    )}
                    {b.cancelReason && <div className="muted small clamp-2">{b.cancelReason}</div>}
                  </td>
                  <td className="actions">
                    {open && canCancelBooking(b.status) && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelBooking(b)}>
                        Bekor qilish
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {booking && <BookDialog trip={t} onClose={() => setBooking(false)} />}
      {cancelTrip && (
        <TextDialog
          title={`#${t.number} qatnovini bekor qilish`}
          intro={
            <p>
              {t.bookings.some((b) => holdsSeats(b.status))
                ? `${t.bookings.filter((b) => holdsSeats(b.status)).length} ta bron bekor bo‘ladi, yo‘lovchilarga xabar boradi; to‘langan depozitlar qaytarishga navbatga qo‘yiladi.`
                : 'Bronlar yo‘q.'}
            </p>
          }
          label="Sabab (haydovchi va yo‘lovchilar ko‘radi)"
          confirm="Qatnovni bekor qilish"
          danger
          suggestions={TRIP_CANCEL_REASONS}
          onSubmit={(reason) =>
            api<AdminTrip>(`/v1/admin/intercity/trips/${t.id}/cancel`, {
              method: 'POST',
              body: { reason },
            }).then((updated) => {
              refresh(updated);
              toast(`#${t.number} qatnov bekor qilindi`);
            })
          }
          onClose={() => setCancelTrip(false)}
        />
      )}
      {cancelBooking && (
        <TextDialog
          title={`#${cancelBooking.number} bronni bekor qilish`}
          intro={
            <p>
              {cancelBooking.riderName ?? 'Yo‘lovchi'}, {cancelBooking.seats} ta joy. Operator bekor
              qilganda jarima yozilmaydi.
            </p>
          }
          label="Sabab"
          confirm="Bronni bekor qilish"
          danger
          suggestions={BOOKING_CANCEL_REASONS}
          onSubmit={(reason) =>
            api(`/v1/admin/intercity/bookings/${cancelBooking.id}/cancel`, {
              method: 'POST',
              body: { reason },
            }).then(() => {
              refresh();
              toast(`#${cancelBooking.number} bron bekor qilindi`);
            })
          }
          onClose={() => setCancelBooking(null)}
        />
      )}
    </div>
  );
}
