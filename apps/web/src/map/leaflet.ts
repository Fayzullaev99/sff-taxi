import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import type { GeoConfig, LatLng } from '../api/types';
import {
  AREA_STYLE,
  LINE_COLOR,
  type MapAdapter,
  type MapLayers,
  MARKER_COLOR,
  ROUND_MARKERS,
} from './adapter';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Leaflet with the OSM-style tiles from /v1/geo/config. */
export function createLeafletMap(
  el: HTMLElement,
  config: GeoConfig,
  center: LatLng,
  zoom: number,
): MapAdapter {
  const map = L.map(el, { center: [center.lat, center.lng], zoom, zoomControl: true });
  L.tileLayer(config.osm.tileUrl, {
    attribution: escapeHtml(config.osm.attribution),
    maxZoom: config.osm.maxZoom,
  }).addTo(map);
  const overlay = L.layerGroup().addTo(map);
  let clickHandler: ((p: LatLng) => void) | null = null;
  map.on('click', (e: L.LeafletMouseEvent) =>
    clickHandler?.({ lat: e.latlng.lat, lng: e.latlng.lng }),
  );

  return {
    draw(layers: MapLayers) {
      overlay.clearLayers();
      for (const p of layers.polygons ?? []) {
        const style = AREA_STYLE[p.tone];
        overlay.addLayer(
          L.polygon(
            p.rings.map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number])),
            {
              color: style.color,
              weight: p.tone === 'inactive' ? 1 : 2,
              dashArray: p.tone === 'inactive' ? '4 4' : undefined,
              fillColor: style.fill,
              fillOpacity: style.opacity,
              // clicks go through to the map (pin placement)
              interactive: false,
            },
          ),
        );
      }
      for (const c of layers.circles ?? []) {
        overlay.addLayer(
          L.circle([c.center.lat, c.center.lng], {
            radius: c.radiusM,
            color: '#d97706',
            weight: 1.5,
            fillOpacity: 0.05,
            interactive: false,
          }),
        );
      }
      for (const line of layers.polylines ?? []) {
        const style = line.style ?? 'route';
        overlay.addLayer(
          L.polyline(
            line.points.map((p) => [p.lat, p.lng] as [number, number]),
            {
              color: LINE_COLOR[style],
              weight: 3,
              opacity: 0.75,
              dashArray: style === 'route' ? '6 6' : undefined,
              interactive: false,
            },
          ),
        );
      }
      for (const m of layers.markers ?? []) {
        const round = ROUND_MARKERS.has(m.kind);
        const size = m.selected ? 34 : 26;
        const text = m.text ? `<b>${escapeHtml(m.text)}</b>` : '';
        const marker = L.marker([m.point.lat, m.point.lng], {
          icon: L.divIcon({
            className: `map-marker map-marker-${m.kind}${round ? ' is-round' : ''}${
              m.selected ? ' is-selected' : ''
            }`,
            html: `<span style="--marker:${MARKER_COLOR[m.kind]}">${text}</span>`,
            iconSize: [size, size],
            iconAnchor: round ? [size / 2, size / 2] : [size / 2, size],
          }),
          draggable: Boolean(m.draggable),
          title: m.title,
          alt: m.title,
          keyboard: Boolean(m.draggable || m.onClick),
          zIndexOffset: m.selected ? 1000 : m.kind.startsWith('driver') ? 0 : 500,
        });
        if (m.title) {
          marker.bindTooltip(m.title, { direction: 'top', offset: [0, round ? -14 : -26] });
        }
        if (m.onDragEnd) {
          const onDragEnd = m.onDragEnd;
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            onDragEnd({ lat: p.lat, lng: p.lng });
          });
        }
        if (m.onClick) {
          const onClick = m.onClick;
          // Leaflet also fires click for Enter on a focused marker (keyboard users)
          marker.on('click', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e);
            onClick();
          });
        }
        overlay.addLayer(marker);
      }
    },
    setView(c, z) {
      map.setView([c.lat, c.lng], z ?? map.getZoom());
    },
    fit(points, maxZoom = 16) {
      if (!points.length) return;
      if (points.length === 1) {
        map.setView([points[0]!.lat, points[0]!.lng], maxZoom);
        return;
      }
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [28, 28],
        maxZoom,
      });
    },
    onClick(handler) {
      clickHandler = handler;
      el.style.cursor = handler ? 'crosshair' : '';
    },
    resize() {
      map.invalidateSize();
    },
    destroy() {
      map.remove();
    },
  };
}
