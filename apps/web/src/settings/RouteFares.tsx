import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Power, Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useIntercityPoints, useRouteFares } from '../api/queries';
import type { IntercityPoint, RideClass, RouteFare, RouteFareBody } from '../api/types';
import { CLASSES, dateTime, som } from '../lib/format';
import { routeFareBody, type RouteFareDraft, routeFareProblems } from '../lib/pool';
import { Badge, Button, Field, MoneyInput, PageHeader, Segmented, Toggle } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';

function emptyDraft(points: IntercityPoint[]): RouteFareDraft {
  const slug = (s: string) => points.find((p) => p.slug === s)?.slug;
  return {
    from: slug('yangiyer') ?? points[0]?.slug ?? '',
    to: slug('guliston') ?? points[1]?.slug ?? '',
    class: 'economy',
    seatPrice: null,
    carPrice: null,
    seatOn: true,
    carOn: false,
    isActive: true,
    bothWays: true,
  };
}

function draftOf(f: RouteFare): RouteFareDraft {
  return {
    from: f.from.slug,
    to: f.to.slug,
    class: f.class,
    seatPrice: f.seatPrice,
    carPrice: f.carPrice,
    seatOn: f.seatPrice !== null,
    carOn: f.carPrice !== null,
    isActive: f.isActive,
    bothWays: false,
  };
}

const routeName = (f: RouteFare) => `${f.from.name} → ${f.to.name}`;

/**
 * Fixed prices of rides between towns (docs/shared-rides.md §6): a seat in a shared car
 * and/or the whole car. A trip gets the route's price when it starts in the first town's zone
 * and ends in the second's; per km a long ride would cost one person too much.
 */
export default function RouteFares() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const points = useIntercityPoints();
  const fares = useRouteFares();
  const [draft, setDraft] = useState<RouteFareDraft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (points.data && !draft) setDraft(emptyDraft(points.data));
  }, [points.data, draft]);

  const save = useMutation({
    mutationFn: (body: RouteFareBody) =>
      api<RouteFare[]>('/v1/admin/routes', { method: 'PUT', body }),
    onSuccess: (list, body) => {
      queryClient.setQueryData(['routes'], list);
      const name = (s: string) => points.data?.find((p) => p.slug === s)?.nameUz ?? s;
      toast(
        `${name(body.from)} → ${name(body.to)}${body.bothWays ? ' (ikki tomonga)' : ''}: saqlandi`,
      );
      setEditing(null);
      setTouched(false);
      if (points.data) setDraft(emptyDraft(points.data));
    },
  });
  const remove = useMutation({
    mutationFn: (f: RouteFare) => api<void>(`/v1/admin/routes/${f.id}`, { method: 'DELETE' }),
    onSuccess: (_v, f) => {
      void queryClient.invalidateQueries({ queryKey: ['routes'] });
      toast(`${routeName(f)}: o‘chirildi`);
    },
  });

  if (points.isPending || fares.isPending) return <Loading />;
  if (points.error) return <ErrorBox error={points.error} onRetry={() => void points.refetch()} />;
  if (!draft) return <Loading />;
  const d = draft;
  const problems = routeFareProblems(d);
  const shown = (key: string) => (touched ? problems[key] : undefined);
  const set = (patch: Partial<RouteFareDraft>) => setDraft({ ...d, ...patch });
  const name = (slug: string) => points.data.find((p) => p.slug === slug)?.nameUz ?? slug;

  const submit = async () => {
    setTouched(true);
    if (Object.keys(problems).length) return;
    const body = routeFareBody(d);
    const prices = [
      body.seatPrice !== null ? `o‘rindiq ${som(body.seatPrice)}` : null,
      body.carPrice !== null ? `butun mashina ${som(body.carPrice)}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const ok = await confirm({
      title: 'Yo‘nalish narxini saqlash',
      text: `${name(body.from)} → ${name(body.to)}${body.bothWays ? ' va qaytishi' : ''} (${CLASSES[body.class]}): ${prices}. Yangi buyurtmalarga darhol amal qiladi.`,
      confirm: 'Saqlash',
    });
    if (ok) save.mutate(body);
  };

  const toggleActive = (f: RouteFare) =>
    void confirm({
      title: f.isActive ? 'Yo‘nalish narxini to‘xtatish' : 'Yo‘nalish narxini yoqish',
      text: f.isActive
        ? `${routeName(f)}: yangi buyurtmalar tarif bo‘yicha narxlanadi.`
        : `${routeName(f)}: yangi buyurtmalar yana shu narxda.`,
      confirm: f.isActive ? 'To‘xtatish' : 'Yoqish',
      danger: f.isActive,
    }).then(
      (ok) =>
        ok && save.mutate(routeFareBody({ ...draftOf(f), isActive: !f.isActive, bothWays: false })),
    );

  return (
    <div>
      <PageHeader
        title="Yo‘nalish narxlari"
        subtitle="Shaharlar orasidagi taksi safarlariga qat’iy narx: bir o‘rindiq (hamroh bilan) yoki butun mashina"
      />
      <div className="fares-layout">
        <section className="card">
          <h2>{editing ? 'Narxni o‘zgartirish' : 'Yangi yo‘nalish narxi'}</h2>
          <p className="muted small">
            Masalan Yangiyer → Guliston o‘rindiq 10 000 so‘m. Safar birinchi shahar hududida
            boshlanib, ikkinchisida tugasa shu narx qo‘llanadi (tarif bo‘yicha km hisobi emas).
            O‘rindiq narxi — boshqa yo‘lovchilar bilan birga ketadigan bir kishi uchun, ustiga
            chegirma berilmaydi. Shaharlararo qatnovlar (e’lonlar) narxi alohida — Shaharlararo
            bo‘limida.
          </p>
          <div className="grid-2">
            <Field label="Qayerdan" error={shown('from')}>
              {(p) => (
                <select
                  {...p}
                  value={d.from}
                  disabled={editing !== null}
                  onChange={(e) => set({ from: e.target.value })}
                >
                  {points.data.map((x) => (
                    <option key={x.slug} value={x.slug}>
                      {x.nameUz}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Qayerga" error={shown('to') ?? (d.from === d.to ? problems.to : null)}>
              {(p) => (
                <select
                  {...p}
                  value={d.to}
                  disabled={editing !== null}
                  onChange={(e) => set({ to: e.target.value })}
                >
                  {points.data.map((x) => (
                    <option key={x.slug} value={x.slug}>
                      {x.nameUz}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <Segmented<RideClass>
            label="Tarif"
            value={d.class}
            onChange={(c) => editing === null && set({ class: c })}
            options={[
              { value: 'economy', label: CLASSES.economy },
              { value: 'comfort', label: CLASSES.comfort },
            ]}
          />
          <div className="grid-2">
            <div>
              <Toggle
                checked={d.seatOn}
                onChange={(seatOn) => set({ seatOn })}
                label="Bir o‘rindiq (kishi boshiga)"
              />
              {d.seatOn && (
                <Field label="O‘rindiq narxi" error={shown('seatPrice')}>
                  {(p) => (
                    <MoneyInput
                      {...p}
                      value={d.seatPrice}
                      onChange={(seatPrice) => set({ seatPrice })}
                    />
                  )}
                </Field>
              )}
              {!d.seatOn && shown('seatPrice') && (
                <div className="field-error">{problems.seatPrice}</div>
              )}
            </div>
            <div>
              <Toggle
                checked={d.carOn}
                onChange={(carOn) => set({ carOn })}
                label="Butun mashina"
              />
              {d.carOn && (
                <Field label="Butun mashina narxi" error={shown('carPrice')}>
                  {(p) => (
                    <MoneyInput
                      {...p}
                      value={d.carPrice}
                      onChange={(carPrice) => set({ carPrice })}
                    />
                  )}
                </Field>
              )}
            </div>
          </div>
          <div className="toggles">
            <Toggle
              checked={d.isActive}
              onChange={(isActive) => set({ isActive })}
              label="Faol (yangi buyurtmalarga qo‘llanadi)"
            />
            <label className="check">
              <input
                type="checkbox"
                checked={d.bothWays}
                onChange={(e) => set({ bothWays: e.target.checked })}
              />
              Ikki tomonga (qaytishi ham shu narxda)
            </label>
          </div>
          {save.error && <ErrorBox error={save.error} />}
          <div className="form-actions">
            {editing && (
              <Button
                variant="ghost"
                icon={<X size={16} />}
                onClick={() => {
                  setEditing(null);
                  setTouched(false);
                  setDraft(emptyDraft(points.data));
                }}
              >
                Bekor qilish
              </Button>
            )}
            <Button
              variant="primary"
              icon={editing ? <Save size={16} /> : <Plus size={16} />}
              loading={save.isPending}
              onClick={() => void submit()}
            >
              Saqlash
            </Button>
          </div>
        </section>

        <section className="card table-card">
          {fares.error ? (
            <ErrorBox error={fares.error} onRetry={() => void fares.refetch()} />
          ) : !fares.data.length ? (
            <Empty title="Belgilangan narx yo‘q">Hamma safarlar tarif bo‘yicha narxlanadi.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Yo‘nalish</th>
                    <th>Tarif</th>
                    <th className="num">O‘rindiq (1 kishi)</th>
                    <th className="num">Butun mashina</th>
                    <th>Holat</th>
                    <th>Yangilangan</th>
                    <th>
                      <span className="sr-only">Amallar</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {fares.data.map((f) => (
                    <tr key={f.id} className={f.isActive ? undefined : 'muted'}>
                      <td>{routeName(f)}</td>
                      <td>{CLASSES[f.class]}</td>
                      <td className="num">{f.seatPrice !== null ? som(f.seatPrice) : '—'}</td>
                      <td className="num">{f.carPrice !== null ? som(f.carPrice) : '—'}</td>
                      <td>
                        <Badge tone={f.isActive ? 'green' : 'neutral'}>
                          {f.isActive ? 'Faol' : 'To‘xtatilgan'}
                        </Badge>
                      </td>
                      <td className="nowrap">{dateTime(f.updatedAt)}</td>
                      <td className="actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Pencil size={14} />}
                          aria-label={`${routeName(f)}: tahrirlash`}
                          onClick={() => {
                            setEditing(f.id);
                            setTouched(false);
                            setDraft(draftOf(f));
                            save.reset();
                          }}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Power size={14} />}
                          aria-label={`${routeName(f)}: ${f.isActive ? 'to‘xtatish' : 'yoqish'}`}
                          disabled={save.isPending}
                          onClick={() => toggleActive(f)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 size={14} />}
                          aria-label={`${routeName(f)}: o‘chirish`}
                          disabled={remove.isPending}
                          onClick={() =>
                            void confirm({
                              title: 'Yo‘nalish narxini o‘chirish',
                              text: `${routeName(f)} (${CLASSES[f.class]}): yangi buyurtmalar tarif bo‘yicha narxlanadi. Shu narxda buyurtma qilingan safar bo‘lsa, narx o‘chirilmaydi — to‘xtatiladi.`,
                              confirm: 'O‘chirish',
                              danger: true,
                            }).then((ok) => ok && remove.mutate(f))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {remove.error && <ErrorBox error={remove.error} />}
        </section>
      </div>
    </div>
  );
}
