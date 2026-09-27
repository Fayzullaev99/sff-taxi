import { useMutation } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { errorText } from '../api/client';
import { Button, Field } from './controls';
import { Modal } from './Modal';

/**
 * A confirmation that needs a written reason or answer (cancelling a trip, answering an
 * appeal): refused locally until long enough, the server's error shown in place, closed on
 * success. Quick picks fill the text.
 */
export function TextDialog({
  title,
  intro,
  label,
  hint,
  confirm,
  danger = false,
  minLength = 3,
  maxLength = 300,
  suggestions = [],
  onSubmit,
  onDone,
  onClose,
}: {
  title: string;
  intro?: ReactNode;
  label: string;
  hint?: string;
  confirm: string;
  danger?: boolean;
  minLength?: number;
  maxLength?: number;
  suggestions?: string[];
  onSubmit: (text: string) => Promise<unknown>;
  onDone?: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const value = text.trim();
  const invalid = value.length < minLength ? `Kamida ${minLength} ta belgi yozing` : null;
  const send = useMutation({
    mutationFn: () => onSubmit(value),
    onSuccess: () => {
      onDone?.();
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      busy={send.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={send.isPending}>
            Qaytish
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={send.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) send.mutate();
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      {intro}
      {suggestions.length > 0 && (
        <div className="chips" role="group" aria-label="Tez tanlash">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip chip-sm${text === s ? ' is-active' : ''}`}
              onClick={() => setText(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <Field
        label={label}
        hint={hint}
        error={(touched && invalid) || (send.error ? errorText(send.error) : null)}
      >
        {(p) => (
          <textarea
            {...p}
            value={text}
            maxLength={maxLength}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        )}
      </Field>
    </Modal>
  );
}
