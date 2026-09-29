import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, Users } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { AdminDriver, Gender, SeatLayout } from '../api/types';
import { ago } from '../lib/format';
import { Badge, Button } from '../ui/controls';
import { ErrorBox, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

export const GENDER: Record<Gender, string> = { female: 'Ayol', male: 'Erkak' };

/** The declared gender and whether an operator checked it in the passport. */
export function GenderBadge({
  driver,
}: {
  driver: Pick<AdminDriver, 'gender' | 'genderVerified'>;
}) {
  if (!driver.gender) return <Badge>Jinsi ko‘rsatilmagan</Badge>;
  return driver.genderVerified ? (
    <Badge tone="green">{GENDER[driver.gender]} · pasport bo‘yicha tasdiqlangan</Badge>
  ) : (
    <Badge tone="amber">{GENDER[driver.gender]} · arizada, tasdiqlanmagan</Badge>
  );
}

function VerifyGenderDialog({ driver, onClose }: { driver: AdminDriver; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [gender, setGender] = useState<Gender | null>(driver.gender ?? null);
  const verify = useMutation({
    mutationFn: (g: Gender) =>
      api<AdminDriver>(`/v1/admin/drivers/${driver.id}/gender`, {
        method: 'POST',
        body: { gender: g },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['driver', driver.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      toast(`${updated.fullName}: jinsi tasdiqlandi (${GENDER[updated.gender ?? gender!]})`);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Jinsni tasdiqlash (pasport bo‘yicha)"
      size="sm"
      busy={verify.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={verify.isPending}>
            Qaytish
          </Button>
          <Button
            variant="primary"
            disabled={!gender}
            loading={verify.isPending}
            onClick={() => gender && verify.mutate(gender)}
          >
            Tasdiqlash
          </Button>
        </>
      }
    >
      <p>
        <strong>{driver.fullName}</strong>: pasportdagi jinsni tanlang. Faqat tasdiqlangan ayol
        haydovchilarga “Ayol haydovchi” buyurtmalari boradi.
      </p>
      <div className="toggles" role="radiogroup" aria-label="Jinsi">
        {(['female', 'male'] as const).map((g) => (
          <label key={g} className="check">
            <input
              type="radio"
              name="gender"
              checked={gender === g}
              onChange={() => setGender(g)}
            />
            {GENDER[g]}
          </label>
        ))}
      </div>
      {gender === 'male' && driver.womenRidersOnly && (
        <div className="alert alert-warn">“Faqat ayol yo‘lovchilar” tanlovi o‘chiriladi.</div>
      )}
      {verify.error && <ErrorBox error={verify.error} />}
    </Modal>
  );
}

/** Seats as boxes: the front one, a gap, the rear ones; taken ones filled. */
function Seats({ seats }: { seats: SeatLayout }) {
  const rearSeats = Math.max(0, seats.capacity - 1);
  return (
    <span
      className="seat-layout"
      role="img"
      aria-label={`Old: ${seats.front}/1, orqa: ${seats.rear}/${rearSeats}`}
    >
      {seats.capacity > 0 && <span className={seats.front ? 'is-taken' : ''} />}
      <span className="seat-gap" />
      {Array.from({ length: rearSeats }, (_, i) => (
        <span key={i} className={i < seats.rear ? 'is-taken' : ''} />
      ))}
    </span>
  );
}

/** Gender (women drivers) and the shared-ride state the driver set in the app. */
export function GenderPoolCard({ driver: d }: { driver: AdminDriver }) {
  const [verifying, setVerifying] = useState(false);
  if (d.gender === undefined && d.pool === undefined) return null;
  const pool = d.pool;
  return (
    <section className="card">
      <h2>
        <Users size={17} aria-hidden /> Jinsi va hamroh bilan
      </h2>
      <p>
        <GenderBadge driver={d} />{' '}
        {d.womenRidersOnly && <Badge tone="brand">Faqat ayol yo‘lovchilar</Badge>}
      </p>
      <p className="muted small">
        Ayol yo‘lovchilar ayol haydovchi so‘rashi mumkin: jins pasport bilan solishtirib
        tasdiqlanadi.
      </p>
      <Button size="sm" icon={<UserCheck size={14} />} onClick={() => setVerifying(true)}>
        Jinsni tasdiqlash (pasport bo‘yicha)
      </Button>
      {pool && (
        <dl className="facts facts-2">
          <div>
            <dt>Hamroh bilan</dt>
            <dd>
              {pool.enabled ? (
                <Badge tone="blue">Boshqa yo‘lovchi oladi</Badge>
              ) : (
                <Badge>O‘chiq</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt>Ilovasiz yo‘lovchilar</dt>
            <dd>{pool.extraPassengers ? `${pool.extraPassengers} kishi` : 'yo‘q'}</dd>
          </div>
          <div>
            <dt>Qayerga ketyapti</dt>
            <dd>
              {pool.destination
                ? (pool.destination.address ??
                  `${pool.destination.lat.toFixed(5)}, ${pool.destination.lng.toFixed(5)}`)
                : 'belgilanmagan'}
              {pool.destination && pool.destinationSetAt && (
                <div className="muted small">{ago(pool.destinationSetAt)} belgilangan</div>
              )}
            </dd>
          </div>
          <div>
            <dt>O‘rindiqlar</dt>
            <dd>
              <Seats seats={pool.seats} /> {pool.seats.occupied}/{pool.seats.capacity} band ·{' '}
              {pool.seats.free} bo‘sh
              <div className="muted small">
                old {pool.seats.front}, orqa {pool.seats.rear} (orqada ko‘pi bilan 2)
              </div>
            </dd>
          </div>
        </dl>
      )}
      {verifying && <VerifyGenderDialog driver={d} onClose={() => setVerifying(false)} />}
    </section>
  );
}
