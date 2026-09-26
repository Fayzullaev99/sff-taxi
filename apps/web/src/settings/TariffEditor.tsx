import { Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import {
  type ClassTariff,
  RIDE_CLASSES,
  RIDE_OPTIONS,
  type RideClass,
  type RideOption,
  type Tariff,
} from '../api/types';
import { CLASSES, OPTIONS, som } from '../lib/format';
import { calcFare, isNightNow, type Problem } from '../lib/tariff';
import { Field, MoneyInput, NumberInput, Segmented, Toggle } from '../ui/controls';

/** Empty inputs are kept as NaN in the draft; validation (lib/tariff) refuses them. */
const num = (v: number) => (Number.isNaN(v) ? null : v);
const set = (v: number | null) => (v === null ? NaN : v);

function errorAt(problems: Problem[], path: string): string | null {
  return problems.find((p) => p.path === path)?.message ?? null;
}

function Money({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  error?: string | null;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => <MoneyInput {...p} value={num(value)} onChange={(v) => onChange(set(v))} />}
    </Field>
  );
}

function Whole({
  label,
  value,
  onChange,
  suffix,
  error,
  hint,
}: {
  label: ReactNode;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  error?: string | null;
  hint?: ReactNode;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => (
        <NumberInput {...p} value={num(value)} suffix={suffix} onChange={(v) => onChange(set(v))} />
      )}
    </Field>
  );
}

function ClassFields({
  rideClass,
  value,
  onChange,
  problems,
}: {
  rideClass: RideClass;
  value: ClassTariff;
  onChange: (v: ClassTariff) => void;
  problems: Problem[];
}) {
  const p = `classes.${rideClass}`;
  const bands = value.bands;
  const setBand = (i: number, patch: Partial<ClassTariff['bands'][number]>) =>
    onChange({ ...value, bands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const bandError = errorAt(problems, `${p}.bands`);
  return (
    <div className="class-tariff">
      <h3 className="subhead">Shahar ichida: masofa oraliqlari</h3>
      <table className="table compact bands">
        <thead>
          <tr>
            <th>Gacha (yo‘l bo‘yicha)</th>
            <th>Narx</th>
            <th>
              <span className="sr-only">O‘chirish</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => {
            const distErr = errorAt(problems, `${p}.bands.${i}.up_to_m`);
            const priceErr = errorAt(problems, `${p}.bands.${i}.price`);
            return (
              <tr key={i}>
                <td>
                  <NumberInput
                    aria-label={`${i + 1}-oraliq chegarasi, km`}
                    aria-invalid={distErr ? true : undefined}
                    decimals
                    suffix="km"
                    value={Number.isNaN(b.up_to_m) ? null : b.up_to_m / 1000}
                    onChange={(v) =>
                      setBand(i, { up_to_m: v === null ? NaN : Math.round(v * 1000) })
                    }
                  />
                  {distErr && <div className="field-error">{distErr}</div>}
                </td>
                <td>
                  <MoneyInput
                    aria-label={`${i + 1}-oraliq narxi`}
                    aria-invalid={priceErr ? true : undefined}
                    value={num(b.price)}
                    onChange={(v) => setBand(i, { price: set(v) })}
                  />
                  {priceErr && <div className="field-error">{priceErr}</div>}
                </td>
                <td className="actions">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`${i + 1}-oraliqni o‘chirish`}
                    disabled={bands.length <= 1}
                    onClick={() => onChange({ ...value, bands: bands.filter((_, j) => j !== i) })}
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {bandError && <div className="field-error">{bandError}</div>}
      <button
        type="button"
        className="link-btn add-band"
        disabled={bands.length >= 10}
        onClick={() => {
          const last = bands.at(-1);
          onChange({
            ...value,
            bands: [
              ...bands,
              {
                up_to_m: (last && !Number.isNaN(last.up_to_m) ? last.up_to_m : 0) + 3000,
                price: last && !Number.isNaN(last.price) ? last.price + 3000 : 5000,
              },
            ],
          });
        }}
      >
        <Plus size={15} aria-hidden /> Oraliq qo‘shish
      </button>
      <div className="grid-2">
        <Money
          label="Oxirgi oraliqdan keyin, har km"
          value={value.beyond_per_km}
          onChange={(v) => onChange({ ...value, beyond_per_km: v })}
          error={errorAt(problems, `${p}.beyond_per_km`)}
        />
        <Money
          label="Shahar chegarasidan tashqari, har km"
          hint="Qishloqlar, shahar atrofi"
          value={value.outside_per_km}
          onChange={(v) => onChange({ ...value, outside_per_km: v })}
          error={errorAt(problems, `${p}.outside_per_km`)}
        />
        <Money
          label="Shaharlararo, har km (butun mashina)"
          value={value.intercity_per_km}
          onChange={(v) => onChange({ ...value, intercity_per_km: v })}
          error={errorAt(problems, `${p}.intercity_per_km`)}
        />
        <Money
          label="Shaharlararo, eng kam narx"
          value={value.intercity_min}
          onChange={(v) => onChange({ ...value, intercity_min: v })}
          error={errorAt(problems, `${p}.intercity_min`)}
        />
      </div>
    </div>
  );
}

/** Every part of a tariff; the draft may hold NaN for fields being typed. */
export function TariffEditor({
  value,
  onChange,
  problems,
}: {
  value: Tariff;
  onChange: (t: Tariff) => void;
  problems: Problem[];
}) {
  const [rideClass, setRideClass] = useState<RideClass>('economy');
  const t = value;
  return (
    <div className="tariff-editor">
      <section className="card">
        <div className="card-head">
          <h2>Narxlar</h2>
          <Segmented
            label="Sinf"
            value={rideClass}
            onChange={setRideClass}
            options={RIDE_CLASSES.map((c) => ({ value: c, label: CLASSES[c] }))}
          />
        </div>
        <ClassFields
          key={rideClass}
          rideClass={rideClass}
          value={t.classes[rideClass]}
          problems={problems}
          onChange={(c) => onChange({ ...t, classes: { ...t.classes, [rideClass]: c } })}
        />
      </section>

      <section className="card">
        <h2>Tun, kutish, bekor qilish</h2>
        <div className="grid-3">
          <Whole
            label="Tungi qo‘shimcha"
            suffix="%"
            value={t.night.percent}
            onChange={(percent) => onChange({ ...t, night: { ...t.night, percent } })}
            error={errorAt(problems, 'night.percent')}
          />
          <Field label="Tun boshlanadi" error={errorAt(problems, 'night.from')}>
            {(p) => (
              <input
                {...p}
                type="time"
                value={t.night.from}
                onChange={(e) => onChange({ ...t, night: { ...t.night, from: e.target.value } })}
              />
            )}
          </Field>
          <Field label="Tun tugaydi" hint="Toshkent vaqti" error={errorAt(problems, 'night.to')}>
            {(p) => (
              <input
                {...p}
                type="time"
                value={t.night.to}
                onChange={(e) => onChange({ ...t, night: { ...t.night, to: e.target.value } })}
              />
            )}
          </Field>
          <Whole
            label="Bepul kutish"
            suffix="daq"
            value={t.waiting.free_minutes}
            onChange={(free_minutes) => onChange({ ...t, waiting: { ...t.waiting, free_minutes } })}
            error={errorAt(problems, 'waiting.free_minutes')}
          />
          <Money
            label="Pullik kutish, har daqiqa"
            value={t.waiting.per_minute}
            onChange={(per_minute) => onChange({ ...t, waiting: { ...t.waiting, per_minute } })}
            error={errorAt(problems, 'waiting.per_minute')}
          />
          <Money
            label="Bekor qilish jarimasi"
            hint="Haydovchi kutib bo‘lgach yoki yo‘lovchi chiqmasa"
            value={t.cancellation_fee}
            onChange={(cancellation_fee) => onChange({ ...t, cancellation_fee })}
            error={errorAt(problems, 'cancellation_fee')}
          />
        </div>
      </section>

      <section className="card">
        <h2>Qo‘shimcha xizmatlar</h2>
        <p className="muted small">0 — bepul, lekin mos mashina talab qilinadi.</p>
        <div className="grid-2">
          {RIDE_OPTIONS.map((o) => (
            <Money
              key={o}
              label={OPTIONS[o]}
              value={t.options[o]}
              onChange={(v) => onChange({ ...t, options: { ...t.options, [o]: v } })}
              error={errorAt(problems, `options.${o}`)}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Shaharlararo va xizmat hududi</h2>
        <div className="grid-2">
          <Whole
            label="Shaharlararo hisoblanadi (masofa kamida)"
            suffix="km"
            value={t.intercity_from_km}
            onChange={(intercity_from_km) => onChange({ ...t, intercity_from_km })}
            error={errorAt(problems, 'intercity_from_km')}
          />
          <Whole
            label="Xizmat radiusi (shahar chegarasidan)"
            hint="Shu masofadagi qishloqlardan ham buyurtma olinadi"
            suffix="km"
            value={t.service_radius_km}
            onChange={(service_radius_km) => onChange({ ...t, service_radius_km })}
            error={errorAt(problems, 'service_radius_km')}
          />
          <Whole
            label="Bir o‘rindiq ulushi"
            hint="Butun mashina narxidan (ma’lumot uchun)"
            suffix="%"
            value={t.seats.share_percent}
            onChange={(share_percent) => onChange({ ...t, seats: { ...t.seats, share_percent } })}
            error={errorAt(problems, 'seats.share_percent')}
          />
          <Whole
            label="Old o‘rindiq qo‘shimchasi"
            suffix="%"
            value={t.seats.front_extra_percent}
            onChange={(front_extra_percent) =>
              onChange({ ...t, seats: { ...t.seats, front_extra_percent } })
            }
            error={errorAt(problems, 'seats.front_extra_percent')}
          />
        </div>
      </section>
    </div>
  );
}

/** Live price of a sample trip under the tariff being edited. */
export function FareCalculator({ tariff, valid }: { tariff: Tariff; valid: boolean }) {
  const [rideClass, setRideClass] = useState<RideClass>('economy');
  const [insideKm, setInsideKm] = useState<number | null>(3.5);
  const [outsideKm, setOutsideKm] = useState<number | null>(0);
  const [options, setOptions] = useState<RideOption[]>([]);
  const [night, setNight] = useState(() => isNightNow(tariff.night));
  const fare =
    valid && insideKm !== null && outsideKm !== null
      ? calcFare(
          {
            rideClass,
            insideM: Math.round(insideKm * 1000),
            outsideM: Math.round(outsideKm * 1000),
            options,
            night,
          },
          tariff,
        )
      : null;
  return (
    <aside className="card calculator" aria-label="Narx kalkulyatori">
      <h2>Kalkulyator</h2>
      <Segmented
        label="Sinf"
        value={rideClass}
        onChange={setRideClass}
        options={RIDE_CLASSES.map((c) => ({ value: c, label: CLASSES[c] }))}
      />
      <div className="grid-2">
        <Field label="Shahar ichida">
          {(p) => (
            <NumberInput {...p} decimals suffix="km" value={insideKm} onChange={setInsideKm} />
          )}
        </Field>
        <Field label="Chegaradan tashqarida">
          {(p) => (
            <NumberInput {...p} decimals suffix="km" value={outsideKm} onChange={setOutsideKm} />
          )}
        </Field>
      </div>
      <div className="toggles">
        {RIDE_OPTIONS.map((o) => (
          <label key={o} className="check">
            <input
              type="checkbox"
              checked={options.includes(o)}
              onChange={(e) =>
                setOptions((l) => (e.target.checked ? [...l, o] : l.filter((x) => x !== o)))
              }
            />
            {OPTIONS[o]}
          </label>
        ))}
        <Toggle checked={night} onChange={setNight} label="Tunda" />
      </div>
      {!fare ? (
        <p className="muted">Xatolarni tuzating — narx shu yerda ko‘rinadi.</p>
      ) : (
        <>
          <div className="calc-total">
            <strong>{som(fare.total)}</strong>
            {fare.kind === 'intercity' && <span className="badge badge-blue">Shaharlararo</span>}
          </div>
          <dl className="facts">
            <div>
              <dt>Masofa narxi</dt>
              <dd>{som(fare.base - fare.outside)}</dd>
            </div>
            {fare.outside > 0 && (
              <div>
                <dt>Chegaradan tashqari</dt>
                <dd>{som(fare.outside)}</dd>
              </div>
            )}
            {fare.night > 0 && (
              <div>
                <dt>Tungi qo‘shimcha</dt>
                <dd>{som(fare.night)}</dd>
              </div>
            )}
            {fare.options > 0 && (
              <div>
                <dt>Qo‘shimchalar</dt>
                <dd>{som(fare.options)}</dd>
              </div>
            )}
            {fare.seat && (
              <div>
                <dt>O‘rindiq (orqa / old)</dt>
                <dd>
                  {som(fare.seat.rear)} / {som(fare.seat.front)}
                </dd>
              </div>
            )}
          </dl>
          <p className="muted small">Jami 100 so‘mgacha yaxlitlanadi (naqd).</p>
        </>
      )}
    </aside>
  );
}
