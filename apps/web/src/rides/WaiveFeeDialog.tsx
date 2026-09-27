import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { AdminRide } from '../api/types';
import { som } from '../lib/format';
import { useToast } from '../ui/feedback';
import { TextDialog } from '../ui/TextDialog';

/** Reasons operators give most for letting a rider off a cancellation fee. */
export const WAIVE_REASONS = [
  'Haydovchi kechikdi',
  'Mijoz uzrli sabab bilan bekor qildi',
  'Texnik xato',
  'Mijozga imtiyoz (birinchi marta)',
];

/**
 * Lets the rider off one cancelled ride's owed fee (POST admin/rides/:id/fee/waive): a note is
 * required, and a ride already carrying the fee collects that much less. A fee collected by a
 * completed ride cannot be waived any more (409, shown in the dialog).
 */
export function WaiveFeeDialog({
  ride,
  onClose,
}: {
  ride: { rideId: string; number: number; amount: number };
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return (
    <TextDialog
      title={`#${ride.number}: bekor qilish to‘lovini kechirish`}
      intro={
        <p>
          Mijoz <strong>{som(ride.amount)}</strong> to‘lamaydi: keyingi naqd safarida olinmaydi, bu
          summani yig‘ayotgan safar shuncha kam oladi. Amal qaytarilmaydi.
        </p>
      }
      label="Sabab (tarixda saqlanadi)"
      confirm="Kechirish"
      danger
      suggestions={WAIVE_REASONS}
      onSubmit={(note) =>
        api<AdminRide>(`/v1/admin/rides/${ride.rideId}/fee/waive`, {
          method: 'POST',
          body: { note },
        }).then((updated) => {
          queryClient.setQueryData(['ride', ride.rideId], updated);
          // the collecting ride and the caller's owed line change too
          void queryClient.invalidateQueries({ queryKey: ['ride'] });
          void queryClient.invalidateQueries({ queryKey: ['caller'] });
          void queryClient.invalidateQueries({ queryKey: ['rides'] });
          toast(`#${ride.number}: ${som(ride.amount)} kechirildi`);
        })
      }
      onClose={onClose}
    />
  );
}
