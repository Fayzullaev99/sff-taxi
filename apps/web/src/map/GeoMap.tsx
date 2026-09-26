import { useQuery } from '@tanstack/react-query';
import { MapPinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import type { GeoConfig, LatLng } from '../api/types';
import type { MapAdapter, MapLayers } from './adapter';
import { createLeafletMap } from './leaflet';

/** Central Guliston, the launch city: the view when the API names no default. */
export const GULISTON: LatLng = { lat: 40.49598, lng: 68.77587 };

/** Map provider, tiles, default view and the service areas (public, cached for a while). */
export function useGeoConfig() {
  return useQuery({
    queryKey: ['geo-config'],
    queryFn: () => api<GeoConfig>('/v1/geo/config', { auth: false }),
    staleTime: 10 * 60_000,
  });
}

export interface GeoMapProps {
  config: GeoConfig;
  layers: MapLayers;
  /** Clicking the map (e.g. to drop a pin). */
  onClick?: (point: LatLng) => void;
  /** Shows these points whenever `key` changes. */
  fit?: { key: string; points: LatLng[]; maxZoom?: number };
  /** Moves the view whenever `key` changes. */
  view?: { key: string; center: LatLng; zoom?: number };
  className?: string;
  label: string;
}

/**
 * Leaflet with the OSM-style tiles of /v1/geo/config (`osm` is always there "for web panels
 * without a Yandex key"): dispatchers need dense, fast redraws of many cars, which Leaflet
 * does well and without a paid key.
 */
export function GeoMap({ config, layers, onClick, fit, view, className, label }: GeoMapProps) {
  const el = useRef<HTMLDivElement>(null);
  const [adapter, setAdapter] = useState<MapAdapter | null>(null);
  const [failed, setFailed] = useState(false);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const pendingFit = useRef<GeoMapProps['fit'] | null>(null);
  const initial = useRef({
    center: view?.center ?? fit?.points[0] ?? config.defaultCenter ?? GULISTON,
    zoom: view?.zoom ?? config.defaultZoom,
  });

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let created: MapAdapter | null = null;
    const { center, zoom } = initial.current;
    try {
      created = createLeafletMap(node, config, center, zoom);
      setAdapter(created);
    } catch {
      setFailed(true);
    }
    return () => {
      created?.destroy();
      setAdapter(null);
    };
  }, [config]);

  // dialogs and drawers open after the map is created: follow the container's size
  useEffect(() => {
    const node = el.current;
    if (!adapter || !node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!node.clientWidth) return;
      adapter.resize();
      if (pendingFit.current) {
        adapter.fit(pendingFit.current.points, pendingFit.current.maxZoom);
        pendingFit.current = null;
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [adapter]);

  useEffect(() => {
    adapter?.draw(layers);
  }, [adapter, layers]);

  const clickable = Boolean(onClick);
  useEffect(() => {
    adapter?.onClick(clickable ? (p) => onClickRef.current?.(p) : null);
  }, [adapter, clickable]);

  const fitKey = fit?.key;
  useEffect(() => {
    if (!adapter || !fit) return;
    if (el.current && !el.current.clientWidth) pendingFit.current = fit;
    else adapter.fit(fit.points, fit.maxZoom);
  }, [adapter, fitKey]);

  const viewKey = view?.key;
  useEffect(() => {
    if (adapter && view) adapter.setView(view.center, view.zoom);
  }, [adapter, viewKey]);

  return (
    <div className={`geo-map${className ? ` ${className}` : ''}`}>
      <div ref={el} className="geo-map-canvas" role="region" aria-label={label} />
      {failed && (
        <div className="geo-map-failed">
          <MapPinOff size={20} aria-hidden /> Xarita yuklanmadi
        </div>
      )}
    </div>
  );
}
