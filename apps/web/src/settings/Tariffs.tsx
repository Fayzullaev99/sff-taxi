import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { useCities, useTariff } from '../api/queries';
import type { Tariff } from '../api/types';
import { validateTariff } from '../lib/tariff';
import { Button, PageHeader } from '../ui/controls';
import { ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { FareCalculator, TariffEditor } from './TariffEditor';

/**
 * The platform tariff (fixed prices, no surge): distance bands, per-km beyond and outside
 * the city, intercity, night add-on, waiting, options, cancellation fee. A city may have its
 * own (Shaharlar). Changes apply to new quotes only: a ride keeps the price it was ordered at.
 */
export default function Tariffs() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const tariff = useTariff();
  const cities = useCities();
  const [draft, setDraft] = useState<Tariff | null>(null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (tariff.data && !draft) setDraft(tariff.data);
  }, [tariff.data, draft]);

  const save = useMutation({
    mutationFn: (t: Tariff) => api<Tariff>('/v1/admin/settings/tariff', { method: 'PUT', body: t }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'tariff'], saved);
      setDraft(saved);
      setSubmitted(false);
      toast('Tarif saqlandi: yangi narxlar keyingi hisob-kitoblardan amal qiladi');
    },
  });

  if (tariff.isPending || (!draft && !tariff.error)) return <Loading />;
  if (tariff.error) return <ErrorBox error={tariff.error} onRetry={() => void tariff.refetch()} />;
  const t = draft!;
  const problems = validateTariff(t);
  const dirty = JSON.stringify(t) !== JSON.stringify(tariff.data);
  const overriding = (cities.data ?? []).filter((c) => c.tariff !== null);

  const submit = async () => {
    setSubmitted(true);
    if (problems.length) return;
    const ok = await confirm({
      title: 'Tarifni saqlash',
      text: (
        <p>
          Yangi narxlar barcha{overriding.length ? ' (o‘z tarifi bo‘lmagan)' : ''} shaharlarda
          darhol amal qiladi. Buyurtma qilingan safarlar eski narxda qoladi.
        </p>
      ),
      confirm: 'Saqlash',
    });
    if (ok) save.mutate(t);
  };

  return (
    <div>
      <PageHeader
        title="Tariflar"
        subtitle="Qat’iy narx: talabga qarab oshmaydi. Umumiy tarif — o‘z tarifi bo‘lmagan barcha shaharlar uchun."
        actions={
          <>
            <Button
              variant="ghost"
              icon={<RotateCcw size={16} />}
              disabled={!dirty || save.isPending}
              onClick={() => {
                setDraft(tariff.data);
                setSubmitted(false);
              }}
            >
              Bekor qilish
            </Button>
            <Button
              variant="primary"
              icon={<Save size={16} />}
              disabled={!dirty}
              loading={save.isPending}
              onClick={() => void submit()}
            >
              Saqlash
            </Button>
          </>
        }
      />
      {overriding.length > 0 && (
        <div className="alert alert-info">
          O‘z tarifi bor shaharlar: {overriding.map((c) => c.nameUz).join(', ')} —{' '}
          <Link to="/cities">Shaharlar</Link> bo‘limida tahrirlanadi.
        </div>
      )}
      {submitted && problems.length > 0 && (
        <div className="alert alert-error" role="alert">
          {problems.length} ta xato: {problems[0]!.message}
        </div>
      )}
      {save.error && <ErrorBox error={save.error} />}
      <div className="settings-layout">
        <TariffEditor value={t} onChange={setDraft} problems={problems} />
        <FareCalculator tariff={t} valid={problems.length === 0} />
      </div>
    </div>
  );
}
