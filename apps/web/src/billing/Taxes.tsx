import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Landmark } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, errorText } from '../api/client';
import { useTaxReport } from '../api/queries';
import { digits, som, tashkentMonth } from '../lib/format';
import { taxCsv } from '../lib/taxes';
import { Badge, Button, Field, PageHeader } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The 1% turnover tax the platform withholds from self-employed drivers (PP-247), per
 * Tashkent month, and the record that the period was paid to the budget (by the 15th).
 */
export default function Taxes() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  // last month by default: that is the one to remit
  const [period, setPeriod] = useState(() => tashkentMonth(Date.now(), -1));
  const [reference, setReference] = useState('');
  const [touched, setTouched] = useState(false);
  const report = useTaxReport(period);
  const unpaid = report.data?.drivers.filter((d) => !d.remitted) ?? [];
  const refError = reference.trim().length < 3 ? 'To‘lov hujjati raqamini kiriting' : null;

  const remit = useMutation({
    mutationFn: () =>
      api<{ period: string; rows: number }>('/v1/admin/billing/taxes/remit', {
        method: 'POST',
        body: { period, reference: reference.trim() },
      }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['taxes', period] });
      setReference('');
      setTouched(false);
      toast(`${res.period}: ${res.rows} ta yozuv to‘langan deb belgilandi`);
    },
  });

  const submit = async () => {
    setTouched(true);
    if (refError || !report.data) return;
    const amount = unpaid.reduce((s, d) => s + d.amount, 0);
    const ok = await confirm({
      title: `${period} soliqni to‘langan deb belgilash`,
      text: (
        <p>
          {unpaid.length} ta haydovchi bo‘yicha <strong>{som(amount)}</strong> byudjetga o‘tkazildi,
          hujjat: <strong>{reference.trim()}</strong>. Bu amalni bekor qilib bo‘lmaydi.
        </p>
      ),
      confirm: 'Belgilash',
    });
    if (ok) remit.mutate();
  };

  return (
    <div>
      <PageHeader
        title="Soliq hisoboti"
        subtitle="O‘zini o‘zi band qilganlar uchun 1% aylanma solig‘i: platforma soliq agenti sifatida ushlab qoladi va keyingi oyning 15-sanasigacha to‘laydi"
        actions={
          <Button
            size="sm"
            icon={<Download size={15} />}
            disabled={!report.data?.drivers.length}
            onClick={() => report.data && download(`soliq-${period}.csv`, taxCsv(report.data))}
          >
            CSV yuklab olish
          </Button>
        }
      />
      <div className="filters">
        <label className="date-filter">
          Oy
          <input
            type="month"
            value={period}
            max={tashkentMonth()}
            onChange={(e) => setPeriod(e.target.value)}
          />
        </label>
      </div>
      {report.error ? (
        <ErrorBox error={report.error} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <Loading />
      ) : !report.data.drivers.length ? (
        <Empty title={`${period} oyida soliq ushlanmagan`}>Bu oyda yakunlangan safar yo‘q.</Empty>
      ) : (
        <>
          <div className="tiles">
            <div className="tile">
              <span>Safarlar</span>
              <strong>{digits(report.data.totals.rides)}</strong>
            </div>
            <div className="tile">
              <span>Aylanma</span>
              <strong>{som(report.data.totals.base)}</strong>
            </div>
            <div className="tile">
              <span>Ushlangan soliq</span>
              <strong>{som(report.data.totals.amount)}</strong>
            </div>
            <div className="tile">
              <span>To‘lanmagan</span>
              <strong>{som(unpaid.reduce((s, d) => s + d.amount, 0))}</strong>
            </div>
          </div>
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>Haydovchi</th>
                  <th>JShShIR</th>
                  <th className="num">Safarlar</th>
                  <th className="num">Aylanma</th>
                  <th className="num">Soliq</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {report.data.drivers.map((d) => (
                  <tr key={d.driverId}>
                    <td>
                      <Link to={`/drivers/${d.driverId}`}>{d.fullName}</Link>
                    </td>
                    <td className="mono">{d.pinfl}</td>
                    <td className="num">{d.rides}</td>
                    <td className="num">{digits(d.base)}</td>
                    <td className="num">{digits(d.amount)}</td>
                    <td>
                      <Badge tone={d.remitted ? 'green' : 'amber'}>
                        {d.remitted ? 'To‘langan' : 'To‘lanmagan'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Jami</th>
                  <th />
                  <th className="num">{report.data.totals.rides}</th>
                  <th className="num">{digits(report.data.totals.base)}</th>
                  <th className="num">{digits(report.data.totals.amount)}</th>
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
          <section className="card">
            <h2>
              <Landmark size={17} aria-hidden /> Byudjetga to‘lovni qayd etish
            </h2>
            {unpaid.length === 0 ? (
              <p className="muted">Bu oyning soliqi to‘liq to‘langan deb belgilangan.</p>
            ) : (
              <div className="inline-save">
                <Field
                  label="To‘lov topshiriqnomasi raqami"
                  error={(touched && refError) || (remit.error ? errorText(remit.error) : null)}
                >
                  {(p) => (
                    <input
                      {...p}
                      value={reference}
                      maxLength={100}
                      placeholder="Masalan: PT-2026-10-015"
                      onChange={(e) => setReference(e.target.value)}
                    />
                  )}
                </Field>
                <Button variant="primary" loading={remit.isPending} onClick={() => void submit()}>
                  To‘langan deb belgilash
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
