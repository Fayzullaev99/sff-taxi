import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText, fieldErrors } from '../api/client';
import type { PublicTrip, TripBooking } from '../api/types';
import { bookingPrice, seatChoices } from '../lib/intercity';
import { CLASSES, dateTime, som } from '../lib/format';
import { formatPhone, isUzPhone, normalizePhone } from '../lib/phone';
import { Button, Field, PhoneInput, Toggle } from '../ui/controls';
import { useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

type BookableTrip = Pick<
  PublicTrip,
  'id' | 'number' | 'from' | 'to' | 'departureAt' | 'seats' | 'price' | 'class' | 'meetingPoint'
>;

/**
 * Seats for a caller without the app (POST admin/intercity/trips/:id/bookings): the caller
 * gets an SMS with the car, plate and the driver's phone. Seats are paid in cash.
 */
export function BookDialog({
  trip,
  onClose,
  onBooked,
}: {
  trip: BookableTrip;
  onClose: () => void;
  onBooked?: (booking: TripBooking) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const choices = seatChoices(trip.seats.free);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [seats, setSeats] = useState(1);
  const [front, setFront] = useState(false);
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const normalized = isUzPhone(phone) ? normalizePhone(phone) : null;
  const price = bookingPrice(seats, front, trip.price);

  const book = useMutation({
    mutationFn: () =>
      api<TripBooking>(`/v1/admin/intercity/trips/${trip.id}/bookings`, {
        method: 'POST',
        body: {
          riderPhone: normalized,
          riderName: name.trim() || null,
          seats,
          front,
          pickupNote: note.trim() || null,
        },
      }),
    onSuccess: (booking) => {
      void queryClient.invalidateQueries({ queryKey: ['intercity'] });
      toast(`#${booking.number} bron qilindi: ${formatPhone(booking.riderPhone)} ga SMS boradi`);
      onBooked?.(booking);
      onClose();
    },
  });
  const server = fieldErrors(book.error);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Bron: ${trip.from.nameUz} → ${trip.to.nameUz}`}
      size="sm"
      busy={book.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={book.isPending}>
            Qaytish
          </Button>
          <Button
            variant="primary"
            loading={book.isPending}
            disabled={!choices.length}
            onClick={() => {
              setTouched(true);
              // one click, one booking: the button stays busy until the answer
              if (normalized && !book.isPending) book.mutate();
            }}
          >
            Bron qilish · {som(price)}
          </Button>
        </>
      }
    >
      <p className="small">
        #{trip.number} · {dateTime(trip.departureAt)} · {CLASSES[trip.class]} · uchrashuv joyi:{' '}
        {trip.meetingPoint}
      </p>
      {!choices.length && <div className="alert alert-warn">Bo‘sh joy qolmadi.</div>}
      <div className="grid-2">
        <Field
          label="Mijoz telefoni"
          error={
            (touched && !normalized ? 'O‘zbekiston raqamini kiriting' : null) || server.riderPhone
          }
        >
          {(p) => <PhoneInput {...p} value={phone} onChange={setPhone} autoFocus />}
        </Field>
        <Field label="Ismi (ixtiyoriy)">
          {(p) => (
            <input
              {...p}
              value={name}
              maxLength={100}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Joylar soni" hint={`${trip.seats.free} ta bo‘sh`}>
          {(p) => (
            <select {...p} value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {choices.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="field toggle-field">
          <Toggle
            checked={front}
            disabled={!trip.seats.frontFree}
            onChange={setFront}
            label={trip.seats.frontFree ? 'Old o‘rindiq' : 'Old o‘rindiq band'}
          />
        </div>
      </div>
      <Field label="Qayerdan olib ketish (ixtiyoriy)" hint="Haydovchiga ko‘rinadi">
        {(p) => (
          <input {...p} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        )}
      </Field>
      <p className="muted small">
        Orqa o‘rindiq {som(trip.price.rear)}, old {som(trip.price.front)}. Naqd, haydovchiga.
      </p>
      {book.error && !Object.keys(server).length && (
        <div className="alert alert-error" role="alert">
          {errorText(book.error)}
        </div>
      )}
    </Modal>
  );
}
