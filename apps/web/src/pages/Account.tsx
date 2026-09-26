import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import type { Me } from '../api/types';
import { useSignOut } from '../auth/session';
import { formatPhone } from '../lib/phone';
import { Button, Field, PageHeader } from '../ui/controls';
import { ErrorBox, useToast } from '../ui/feedback';

/** The operator's own name (shown in the panel) and sign-out. */
export default function Account({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const signOut = useSignOut();
  const [name, setName] = useState(me.fullName ?? '');
  const save = useMutation({
    mutationFn: () => api<Me>('/v1/me', { method: 'PATCH', body: { fullName: name.trim() } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['me'], updated);
      toast('Saqlandi');
    },
  });
  return (
    <div className="narrow">
      <PageHeader title="Hisob" subtitle={formatPhone(me.phone)} />
      <section className="card">
        <Field label="Ismingiz" hint="Panelda ko‘rinadi">
          {(p) => (
            <input {...p} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        {save.error && <ErrorBox error={save.error} />}
        <div className="form-actions">
          <Button
            variant="primary"
            disabled={!name.trim() || name.trim() === me.fullName}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            Saqlash
          </Button>
        </div>
      </section>
      <section className="card">
        <p className="muted small">
          Ovoz va brauzer bildirishnomalari yuqoridagi tugmalar bilan yoqiladi. Signal eshitilishi
          uchun panel ochiq tabda turishi kerak.
        </p>
        <Button icon={<LogOut size={16} />} onClick={() => void signOut()}>
          Chiqish
        </Button>
      </section>
    </div>
  );
}
