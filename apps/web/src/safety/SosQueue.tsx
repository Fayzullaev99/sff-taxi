import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, ExternalLink, MapPin, Siren } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, errorText } from '../api/client';
import { useSos } from '../api/queries';
import type { SosEvent } from '../api/types';
import { ago, dateTime, RIDE_STATUS_SHORT, RIDE_STATUS_TONE } from '../lib/format';
import type { MapLayers } from '../map/adapter';
import { GeoMap, useGeoConfig } from '../map/GeoMap';
import { cityLayers } from '../map/places';
import { Badge, Button, Field, PageHeader, PhoneLink, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

/** Emergency services in Uzbekistan, the same numbers the apps show with an SOS. */
const EMERGENCY = [
  { number: '112', label: 'Yagona xizmat' },
  { number: '102', label: 'Militsiya' },
  { number: '103', label: 'Tez yordam' },
  { number: '101', label: 'Yong‘in' },
];

function ResolveDialog({ sos, onClose }: { sos: SosEvent; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const invalid = note.trim().length < 3 ? 'Nima qilinganini yozing (kamida 3 ta belgi)' : null;
  const resolve = useMutation({
    mutationFn: () =>
      api(`/v1/admin/sos/${sos.id}/resolve`, { method: 'POST', body: { note: note.trim() } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sos'] });
      toast(`#${sos.rideNumber} SOS yopildi`);
      onClose();
    },
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`SOS: #${sos.rideNumber} safari`}
      size="sm"
      busy={resolve.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={resolve.isPending}>
            Qaytish
          </Button>
          <Button
            variant="primary"
            loading={resolve.isPending}
            onClick={() => {
              setTouched(true);
              if (!invalid) resolve.mutate();
            }}
          >
            Yopish
          </Button>
        </>
      }
    >
      <Field
        label="Natija"
        hint="Masalan: yo‘lovchi bilan gaplashildi, xavf yo‘q; 102 ga xabar berildi"
        error={(touched && invalid) || (resolve.error ? errorText(resolve.error) : null)}
      >
        {(p) => (
          <textarea
            {...p}
            value={note}
            maxLength={500}
            autoFocus
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}

/** SOS signals from riders and drivers: call back, look at the ride, close with a note. */
export default function SosQueue() {
  const [view, setView] = useState<'open' | 'all'>('open');
  const sos = useSos(view === 'open', 10_000);
  const geo = useGeoConfig();
  const [resolving, setResolving] = useState<SosEvent | null>(null);
  const [focus, setFocus] = useState<SosEvent | null>(null);

  const withPoint = (sos.data ?? []).filter((s) => s.lat !== null && s.lng !== null);
  const layers = useMemo<MapLayers>(
    () => ({
      polygons: geo.data ? cityLayers(geo.data) : [],
      markers: withPoint.map((s) => ({
        id: s.id,
        point: { lat: s.lat!, lng: s.lng! },
        kind: 'sos' as const,
        text: '!',
        title: `#${s.rideNumber} · ${dateTime(s.createdAt)}`,
        selected: focus?.id === s.id,
        onClick: () => setFocus(s),
      })),
    }),
    [geo.data, sos.data, focus],
  );

  return (
    <div>
      <PageHeader
        title="SOS"
        subtitle="Yo‘lovchi yoki haydovchidan favqulodda signal: darhol qo‘ng‘iroq qiling"
        actions={
          <Segmented
            label="Ko‘rinish"
            value={view}
            onChange={setView}
            options={[
              { value: 'open', label: 'Ochiq' },
              { value: 'all', label: 'Hammasi' },
            ]}
          />
        }
      />
      <div className="emergency" aria-label="Favqulodda xizmatlar">
        {EMERGENCY.map((e) => (
          <a key={e.number} href={`tel:${e.number}`} className="btn btn-sm">
            <strong>{e.number}</strong> {e.label}
          </a>
        ))}
      </div>
      {sos.error ? (
        <ErrorBox error={sos.error} onRetry={() => void sos.refetch()} />
      ) : sos.isPending ? (
        <Loading />
      ) : !sos.data.length ? (
        <Empty
          title={view === 'open' ? 'Ochiq SOS yo‘q' : 'SOS bo‘lmagan'}
          icon={<CircleCheck size={32} aria-hidden />}
        />
      ) : (
        <div className="sos-layout">
          <ul className="sos-list">
            {sos.data.map((s) => (
              <li
                key={s.id}
                className={`card sos-card${s.resolvedAt ? ' is-resolved' : ''}${
                  focus?.id === s.id ? ' is-selected' : ''
                }`}
              >
                <div className="card-head">
                  <h2>
                    <Siren size={17} aria-hidden /> #{s.rideNumber}
                  </h2>
                  <Badge tone={RIDE_STATUS_TONE[s.rideStatus]}>
                    {RIDE_STATUS_SHORT[s.rideStatus]}
                  </Badge>
                </div>
                <p>
                  <strong>{s.role === 'driver' ? 'Haydovchi' : 'Yo‘lovchi'}</strong>{' '}
                  <PhoneLink phone={s.phone} />
                </p>
                <p className="muted small">
                  {dateTime(s.createdAt)} · {ago(s.createdAt)}
                </p>
                {s.note && <p className="comment">“{s.note}”</p>}
                {s.resolvedAt && (
                  <p className="small">
                    <CircleCheck size={14} aria-hidden /> Yopilgan {dateTime(s.resolvedAt)}
                    {s.resolutionNote && `: ${s.resolutionNote}`}
                  </p>
                )}
                <div className="row-actions">
                  {!s.resolvedAt && (
                    <Button size="sm" variant="primary" onClick={() => setResolving(s)}>
                      Yopish
                    </Button>
                  )}
                  <Link to={`/dispatch?ride=${s.rideId}`} className="btn btn-sm">
                    <ExternalLink size={14} aria-hidden /> Safar
                  </Link>
                  {s.lat !== null && s.lng !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<MapPin size={14} />}
                      onClick={() => setFocus(s)}
                    >
                      Xaritada
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {geo.data && withPoint.length > 0 && (
            <GeoMap
              config={geo.data}
              layers={layers}
              className="sos-map"
              label="SOS joylari"
              view={
                focus && focus.lat !== null && focus.lng !== null
                  ? { key: focus.id, center: { lat: focus.lat, lng: focus.lng }, zoom: 16 }
                  : undefined
              }
              fit={{
                key: `${view}-${withPoint.length}`,
                points: withPoint.map((s) => ({ lat: s.lat!, lng: s.lng! })),
                maxZoom: 15,
              }}
            />
          )}
        </div>
      )}
      {resolving && <ResolveDialog sos={resolving} onClose={() => setResolving(null)} />}
    </div>
  );
}
