import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import {
  CARGO_CLASSES,
  type CargoClass,
  type CargoClassTariff,
  type CargoRules,
} from '../api/types';
import { type CargoDraft, cargoPrice, cargoProblems } from '../lib/cargo';
import { CLASSES, som } from '../lib/format';
import { Button, Field, MoneyInput, NumberInput, Segmented, Toggle } from '../ui/controls';
import { ErrorBox, useConfirm, useToast } from '../ui/feedback';

const CLASS_FIELDS: {
  key: keyof CargoClassTariff;
  label: string;
  suffix?: string;
  money?: boolean;
}[] = [
  { key: 'base', label: 'Asosiy narx', money: true },
  { key: 'included_km', label: 'Ichida km', suffix: 'km' },
  { key: 'included_minutes', label: 'Bepul yuklash', suffix: 'daq' },
  { key: 'per_km', label: 'Keyingi har km (shahar)', money: true },
  { key: 'intercity_per_km', label: 'Har km (shaharlararo)', money: true },
  { key: 'per_minute', label: 'Har qo‘shimcha daqiqa', money: true },
  { key: 'max_payload_kg', label: 'Eng og‘ir yuk', suffix: 'kg' },
];

/** A cargo price for a class, a distance and loaders, at the draft's prices. */
function CargoCalculator({ draft, valid }: { draft: CargoDraft; valid: boolean }) {
  const [cargoClass, setCargoClass] = useState<CargoClass>('cargo_s');
  const [km, setKm] = useState<number | null>(15);
  const [loaders, setLoaders] = useState(1);
  const [night, setNight] = useState(false);
  const p =
    valid && km !== null && km >= 0 && km <= 1000
      ? cargoPrice({ cargoClass, km, loaders, night }, draft as CargoRules)
      : null;
  return (
    <div className="pool-calc" aria-label="Yuk narxi kalkulyatori">
      <h3>Kalkulyator</h3>
      <Segmented<CargoClass>
        label="Yuk sinfi"
        value={cargoClass}
        onChange={setCargoClass}
        options={CARGO_CLASSES.map((c) => ({ value: c, label: CLASSES[c] }))}
      />
      <div className="grid-2">
        <Field label="Masofa">
          {(f) => <NumberInput {...f} decimals suffix="km" value={km} onChange={setKm} />}
        </Field>
        <Field label="Yukchilar">
          {(f) => (
            <select {...f} value={loaders} onChange={(e) => setLoaders(Number(e.target.value))}>
              {Array.from({ length: (draft.max_loaders ?? 0) + 1 }, (_, i) => (
                <option key={i} value={i}>
                  {i} kishi
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Toggle checked={night} onChange={setNight} label="Tungi vaqt" />
      {p ? (
        <p aria-live="polite">
          Narx: <strong>{som(p.total)}</strong>{' '}
          <span className="muted small">
            ({p.kind === 'intercity' ? 'shaharlararo' : 'shahar'}: asosiy {som(p.base - p.distance)}
            {p.extraKm > 0 && ` + ${p.extraKm} km × ${som(p.perKm)}`}
            {p.night > 0 && ` + tun ${som(p.night)}`}
            {p.loaders > 0 && ` + ${p.loaders} yukchi ${som(p.loadersTotal)}`})
          </span>
        </p>
      ) : (
        <p className="muted small">Qiymatlarni to‘g‘rilang.</p>
      )}
    </div>
  );
}

/** Cargo prices and deliveries (admin/settings/cargo): fixed at the quote, no surge. */
export function CargoSettingsCard({ data }: { data: CargoRules }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<CargoDraft>(data);
  useEffect(() => setD(data), [data]);
  const errors = cargoProblems(d);
  const valid = Object.keys(errors).length === 0;
  const dirty = JSON.stringify(d) !== JSON.stringify(data);
  const save = useMutation({
    mutationFn: (body: CargoRules) =>
      api<CargoRules>('/v1/admin/settings/cargo', { method: 'PUT', body }),
    onSuccess: (saved) => {
      queryClient.setQueryData(['settings', 'cargo'], saved);
      toast('Yuk tashish va yetkazish: saqlandi');
    },
  });
  const setClass = (c: CargoClass, key: keyof CargoClassTariff, v: number | null) =>
    setD({ ...d, classes: { ...d.classes, [c]: { ...d.classes[c], [key]: v } } });

  return (
    <section className="card settings-form settings-wide">
      <h2>Yuk tashish va yetkazish</h2>
      <p className="muted small">
        Yuk narxi buyurtmada qat’iy: asosiy narx ichidagi km va yuklash daqiqalarini qamraydi, keyin
        har km va har daqiqa, yukchilar alohida. Kichik sinf — Damas/Labo, o‘rta — Gazel/ Porter.
        Yetkazish — taksi mashinasida kichik posilka (taksi narxining foizi).
      </p>
      <Toggle
        checked={d.enabled}
        onChange={(enabled) => setD({ ...d, enabled })}
        label="Yuk tashish buyurtmalari qabul qilinadi"
      />
      <div className="table-scroll">
        <table className="table compact cargo-table">
          <thead>
            <tr>
              <th />
              {CARGO_CLASSES.map((c) => (
                <th key={c}>{CLASSES[c]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CLASS_FIELDS.map((f) => (
              <tr key={f.key}>
                <th scope="row">{f.label}</th>
                {CARGO_CLASSES.map((c) => {
                  const path = `classes.${c}.${f.key}`;
                  return (
                    <td key={c}>
                      <Field
                        label={<span className="sr-only">{`${CLASSES[c]}: ${f.label}`}</span>}
                        error={errors[path]}
                      >
                        {(p) =>
                          f.money ? (
                            <MoneyInput
                              {...p}
                              value={d.classes[c][f.key]}
                              onChange={(v) => setClass(c, f.key, v)}
                            />
                          ) : (
                            <NumberInput
                              {...p}
                              suffix={f.suffix}
                              value={d.classes[c][f.key]}
                              onChange={(v) => setClass(c, f.key, v)}
                            />
                          )
                        }
                      </Field>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2">
        <Field label="Yukchi narxi (bir kishi)" error={errors.loader_price}>
          {(p) => (
            <MoneyInput
              {...p}
              value={d.loader_price}
              onChange={(loader_price) => setD({ ...d, loader_price })}
            />
          )}
        </Field>
        <Field label="Ko‘pi bilan yukchilar" error={errors.max_loaders}>
          {(p) => (
            <NumberInput
              {...p}
              suffix="kishi"
              value={d.max_loaders}
              onChange={(max_loaders) => setD({ ...d, max_loaders })}
            />
          )}
        </Field>
        <Field
          label="Shaharlararo narx boshlanadi"
          hint="Yo‘l shundan uzun bo‘lsa, shaharlararo km narxi"
          error={errors.intercity_from_km}
        >
          {(p) => (
            <NumberInput
              {...p}
              suffix="km"
              value={d.intercity_from_km}
              onChange={(intercity_from_km) => setD({ ...d, intercity_from_km })}
            />
          )}
        </Field>
        <Field
          label={`Tungi qo‘shimcha (${d.night.from}–${d.night.to})`}
          hint="Yukchilarga qo‘shilmaydi"
          error={errors['night.percent'] ?? errors['night.from'] ?? errors['night.to']}
        >
          {(p) => (
            <NumberInput
              {...p}
              suffix="%"
              value={d.night.percent}
              onChange={(percent) => setD({ ...d, night: { ...d.night, percent } })}
            />
          )}
        </Field>
      </div>
      <h3>Yetkazish (posilka)</h3>
      <Toggle
        checked={d.delivery.enabled}
        onChange={(enabled) => setD({ ...d, delivery: { ...d.delivery, enabled } })}
        label="Yetkazish buyurtmalari qabul qilinadi"
      />
      <div className="grid-2">
        <Field
          label="Narx: taksi narxidan"
          hint="100% — taksi narxi bilan bir xil"
          error={errors['delivery.percent']}
        >
          {(p) => (
            <NumberInput
              {...p}
              suffix="%"
              value={d.delivery.percent}
              onChange={(percent) => setD({ ...d, delivery: { ...d.delivery, percent } })}
            />
          )}
        </Field>
        <Field label="Eng og‘ir posilka" error={errors['delivery.max_weight_kg']}>
          {(p) => (
            <NumberInput
              {...p}
              suffix="kg"
              value={d.delivery.max_weight_kg}
              onChange={(max_weight_kg) =>
                setD({ ...d, delivery: { ...d.delivery, max_weight_kg } })
              }
            />
          )}
        </Field>
      </div>
      <CargoCalculator draft={d} valid={valid} />
      {save.error && <ErrorBox error={save.error} />}
      <div className="form-actions">
        <Button variant="ghost" disabled={!dirty} onClick={() => setD(data)}>
          Bekor qilish
        </Button>
        <Button
          variant="primary"
          icon={<Save size={16} />}
          disabled={!dirty || !valid}
          loading={save.isPending}
          onClick={() =>
            void confirm({
              title: 'Yuk tashish narxlarini saqlash',
              text: 'Yangi narxlar keyingi hisob-kitoblardan amal qiladi; buyurtma qilinganlar o‘zgarmaydi.',
              confirm: 'Saqlash',
            }).then((ok) => ok && save.mutate(d as CargoRules))
          }
        >
          Saqlash
        </Button>
      </div>
    </section>
  );
}
