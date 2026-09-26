import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, errorText } from '../api/client';
import { useCities, useTariff } from '../api/queries';
import type { AdminCity, LatLng, Tariff } from '../api/types';
import { formatBoundary, parseBoundary, pointInPolygon, ringsPoints } from '../lib/geo';
import { DEFAULT_TARIFF, validateTariff } from '../lib/tariff';
import type { MapLayers } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { Badge, Button, Field, NumberInput, PageHeader, Toggle } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';
import { FareCalculator, TariffEditor } from './TariffEditor';

function CityDialog({ city, onClose }: { city: AdminCity; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const geo = useGeoConfig();
  const global = useTariff();
  const [nameUz, setNameUz] = useState(city.nameUz);
  const [nameRu, setNameRu] = useState(city.nameRu);
  const [sort, setSort] = useState<number | null>(city.sort);
  const [center, setCenter] = useState<LatLng>(city.center);
  const original = useMemo(() => formatBoundary(city.boundary), [city.boundary]);
  const [boundaryText, setBoundaryText] = useState(original);
  const [ownTariff, setOwnTariff] = useState(city.tariff !== null);
  const [tariff, setTariff] = useState<Tariff>(city.tariff ?? global.data ?? DEFAULT_TARIFF);
  const [submitted, setSubmitted] = useState(false);

  const parsed = parseBoundary(boundaryText);
  const rings = 'rings' in parsed ? parsed.rings : null;
  const tariffProblems = ownTariff ? validateTariff(tariff) : [];
  const local: Record<string, string> = {};
  if (!nameUz.trim()) local.nameUz = 'Nomini kiriting';
  if (!nameRu.trim()) local.nameRu = 'Nomini kiriting';
  if (sort === null || sort < 0 || sort > 10_000) local.sort = '0 dan 10 000 gacha';
  if ('error' in parsed) local.boundary = parsed.error;
  else if (!pointInPolygon(center, parsed.rings)) local.center = 'Markaz chegara ichida bo‘lsin';
  if (tariffProblems.length) local.tariff = `Tarifda ${tariffProblems.length} ta xato`;

  const save = useMutation({
    mutationFn: () =>
      api<AdminCity>(`/v1/admin/geo/cities/${city.id}`, {
        method: 'PATCH',
        body: {
          nameUz: nameUz.trim(),
          nameRu: nameRu.trim(),
          sort,
          center,
          ...(boundaryText !== original && rings ? { boundary: rings } : {}),
          tariff: ownTariff ? tariff : null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-cities'] });
      void queryClient.invalidateQueries({ queryKey: ['geo-config'] });
      toast(`${nameUz.trim()}: saqlandi`);
      onClose();
    },
  });

  const layers = useMemo<MapLayers>(
    () => ({
      polygons: rings ? [{ id: city.id, rings, tone: 'selected' }] : [],
      markers: [{ id: 'center', point: center, kind: 'center', title: 'Markaz (xaritani bosing)' }],
    }),
    [rings === null ? null : boundaryText, center.lat, center.lng],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`${city.nameUz}: tahrirlash`}
      size="lg"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Bekor qilish
          </Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => {
              setSubmitted(true);
              if (!Object.keys(local).length) save.mutate();
            }}
          >
            Saqlash
          </Button>
        </>
      }
    >
      <div className="grid-3">
        <Field label="Nomi (o‘zbekcha)" error={submitted ? local.nameUz : null}>
          {(p) => (
            <input
              {...p}
              value={nameUz}
              maxLength={100}
              onChange={(e) => setNameUz(e.target.value)}
            />
          )}
        </Field>
        <Field label="Nomi (ruscha)" error={submitted ? local.nameRu : null}>
          {(p) => (
            <input
              {...p}
              value={nameRu}
              maxLength={100}
              onChange={(e) => setNameRu(e.target.value)}
            />
          )}
        </Field>
        <Field label="Tartib" hint="Kichigi ro‘yxatda oldin" error={submitted ? local.sort : null}>
          {(p) => <NumberInput {...p} value={sort} onChange={setSort} />}
        </Field>
      </div>
      {geo.data && (
        <GeoMap
          config={geo.data}
          layers={layers}
          className="city-map"
          label={`${city.nameUz} chegarasi`}
          onClick={setCenter}
          fit={{ key: 'city', points: rings ? ringsPoints(rings) : [center], maxZoom: 14 }}
        />
      )}
      <p className="muted small">
        Markaz: {center.lat.toFixed(5)}, {center.lng.toFixed(5)} — o‘zgartirish uchun xaritani
        bosing.
        {submitted && local.center && <span className="field-error"> {local.center}</span>}
      </p>
      <Field
        label="Chegara (GeoJSON Polygon koordinatalari: [uzunlik, kenglik])"
        hint="Chegara OSM’dan olingan; shahar kengayganda tahrirlang"
        error={local.boundary}
      >
        {(p) => (
          <textarea
            {...p}
            className="mono boundary-text"
            rows={6}
            spellCheck={false}
            value={boundaryText}
            onChange={(e) => setBoundaryText(e.target.value)}
          />
        )}
      </Field>
      <Toggle
        checked={ownTariff}
        onChange={(on) => {
          // a new own tariff starts as a copy of the global one
          if (on && !city.tariff) setTariff(global.data ?? DEFAULT_TARIFF);
          setOwnTariff(on);
        }}
        label="O‘z tarifi (aks holda umumiy tarif amal qiladi)"
      />
      {ownTariff && (
        <div className="settings-layout nested">
          <TariffEditor value={tariff} onChange={setTariff} problems={tariffProblems} />
          <FareCalculator tariff={tariff} valid={tariffProblems.length === 0} />
        </div>
      )}
      {save.error && <ErrorBox error={save.error} />}
    </Modal>
  );
}

/** Service areas: turn a town on when drivers are ready there, edit its boundary and tariff. */
export default function Cities() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const cities = useCities();
  const geo = useGeoConfig();
  const [editing, setEditing] = useState<AdminCity | null>(null);

  const activate = useMutation({
    mutationFn: (c: AdminCity) =>
      api<AdminCity>(`/v1/admin/geo/cities/${c.id}`, {
        method: 'PATCH',
        body: { isActive: !c.isActive },
      }),
    onSuccess: (c) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-cities'] });
      void queryClient.invalidateQueries({ queryKey: ['geo-config'] });
      toast(`${c.nameUz}: ${c.isActive ? 'ishga tushirildi' : 'to‘xtatildi'}`);
    },
    onError: (e) => toast(errorText(e), 'error'),
  });

  const layers = useMemo<MapLayers>(
    () => ({
      polygons: (cities.data ?? []).map((c) => ({
        id: c.id,
        rings: c.boundary,
        tone: c.isActive ? ('active' as const) : ('inactive' as const),
        title: c.nameUz,
      })),
    }),
    [cities.data],
  );

  const toggle = async (c: AdminCity) => {
    const ok = await confirm({
      title: c.isActive ? `${c.nameUz}: to‘xtatish` : `${c.nameUz}: ishga tushirish`,
      text: c.isActive
        ? 'Bu shahardan yangi buyurtma olinmaydi (ilova “tez orada” deb ko‘rsatadi). Ochiq safarlar davom etadi.'
        : 'Shahar va uning atrofidagi qishloqlardan buyurtmalar qabul qilinadi. Haydovchilar tayyormi?',
      confirm: c.isActive ? 'To‘xtatish' : 'Ishga tushirish',
      danger: c.isActive,
    });
    if (ok) activate.mutate(c);
  };

  return (
    <div>
      <PageHeader
        title="Shaharlar"
        subtitle="Xizmat hududlari: faol shaharlar va “tez orada” ro‘yxati, chegaralar, o‘z tariflari"
      />
      {cities.error ? (
        <ErrorBox error={cities.error} onRetry={() => void cities.refetch()} />
      ) : cities.isPending ? (
        <Loading />
      ) : !cities.data.length ? (
        <Empty title="Shaharlar yo‘q" />
      ) : (
        <div className="cities-layout">
          <div className="card table-card">
            <table className="table">
              <thead>
                <tr>
                  <th>Shahar</th>
                  <th>Holat</th>
                  <th>Tarif</th>
                  <th>
                    <span className="sr-only">Amallar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {cities.data.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.nameUz}</strong>
                      <div className="muted small">{c.nameRu}</div>
                    </td>
                    <td>
                      <Toggle
                        checked={c.isActive}
                        disabled={activate.isPending}
                        onChange={() => void toggle(c)}
                        label={c.isActive ? 'Faol' : 'Tez orada'}
                      />
                    </td>
                    <td>
                      {c.tariff ? (
                        <Badge tone="brand">O‘ziniki</Badge>
                      ) : (
                        <span className="muted">Umumiy</span>
                      )}
                    </td>
                    <td className="actions">
                      <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(c)}>
                        Tahrirlash
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {geo.data && (
            <GeoMap
              config={geo.data}
              layers={layers}
              className="cities-map"
              label="Xizmat hududlari xaritasi"
              fit={{
                key: 'all',
                points: cities.data.flatMap((c) => ringsPoints(c.boundary)),
                maxZoom: 12,
              }}
            />
          )}
        </div>
      )}
      {editing && <CityDialog city={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
