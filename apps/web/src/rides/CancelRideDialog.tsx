import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, errorText } from '../api/client';
import type { AdminRide, RideBase } from '../api/types';
import { CANCEL_REASONS } from '../lib/rides';
import { Button, Field } from '../ui/controls';
import { useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

/** Operator cancellation: a reason is required and kept in the ride's history. */
export function CancelRideDialog({
  ride,
  onClose,
}: {
  ride: Pick<RideBase, 'id' | 'number' | 'status'>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const text = reason.trim();
  const invalid = text.length < 3 ? 'Sababni yozing (kamida 3 ta belgi)' : null;

  const cancel = useMutation({
    mutationFn: () =>
      api<AdminRide>(`/v1/admin/rides/${ride.id}/cancel`, {
        method: 'POST',
        body: { reason: text },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['ride', ride.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      void queryClient.invalidateQueries({ queryKey: ['rides'] });
      toast(`#${ride.number} bekor qilindi`);
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`#${ride.number} buyurtmani bekor qilish`}
      size="sm"
      busy={cancel.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Qaytish
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) cancel.mutate();
            }}
          >
            Bekor qilish
          </Button>
        </>
      }
    >
      {ride.status === 'in_progress' && (
        <div className="alert alert-warn">
          Safar boshlangan: bekor qilish yo‘lovchi mashinada ekanligida ham amal qiladi.
        </div>
      )}
      <div className="chips" role="group" aria-label="Tez-tez uchraydigan sabablar">
        {CANCEL_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className={`chip${reason === r ? ' is-active' : ''}`}
            aria-pressed={reason === r}
            onClick={() => setReason(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <Field
        label="Sabab"
        error={(touched && invalid) || (cancel.error ? errorText(cancel.error) : null)}
      >
        {(p) => (
          <textarea
            {...p}
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nega bekor qilinmoqda"
          />
        )}
      </Field>
    </Modal>
  );
}
