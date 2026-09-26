import type { LatLng, PolygonRings } from '../api/types';

export type MarkerKind =
  | 'pickup'
  | 'dropoff'
  | 'driver-free'
  | 'driver-offered'
  | 'driver-busy'
  | 'candidate'
  | 'ride'
  | 'ride-alert'
  | 'sos'
  | 'center';

export interface MarkerSpec {
  id: string;
  point: LatLng;
  kind: MarkerKind;
  title?: string;
  /** A few characters drawn inside the marker (a ride number, "A"/"B"). */
  text?: string;
  /** Emphasised (the selected ride or driver). */
  selected?: boolean;
  draggable?: boolean;
  onDragEnd?: (point: LatLng) => void;
  onClick?: () => void;
}

export interface CircleSpec {
  center: LatLng;
  radiusM: number;
}

export type AreaTone = 'active' | 'inactive' | 'selected' | 'preview';

export interface PolygonSpec {
  id: string;
  rings: PolygonRings;
  tone: AreaTone;
  title?: string;
}

export interface PolylineSpec {
  id: string;
  points: LatLng[];
  /** dashed = a planned line (pickup → drop-off), solid = a driver coming. */
  style?: 'route' | 'approach';
}

/** Everything drawn over the base map; redrawn as a whole when it changes. */
export interface MapLayers {
  polygons?: PolygonSpec[];
  circles?: CircleSpec[];
  polylines?: PolylineSpec[];
  markers?: MarkerSpec[];
}

/** What the panel needs from a map provider (Leaflet with the /geo/config tiles). */
export interface MapAdapter {
  draw(layers: MapLayers): void;
  setView(center: LatLng, zoom?: number): void;
  /** Shows all points (a single point is centred at `maxZoom`). */
  fit(points: LatLng[], maxZoom?: number): void;
  onClick(handler: ((point: LatLng) => void) | null): void;
  /** The container changed size (dialogs, drawers). */
  resize(): void;
  destroy(): void;
}

export const AREA_STYLE: Record<AreaTone, { color: string; fill: string; opacity: number }> = {
  active: { color: '#16a34a', fill: '#16a34a', opacity: 0.06 },
  inactive: { color: '#6b7280', fill: '#6b7280', opacity: 0.04 },
  selected: { color: '#2563eb', fill: '#2563eb', opacity: 0.12 },
  preview: { color: '#d97706', fill: '#FFC400', opacity: 0.15 },
};

/** Driver colours by state: free green, looking at an offer amber, on a ride blue. */
export const MARKER_COLOR: Record<MarkerKind, string> = {
  pickup: '#16a34a',
  dropoff: '#111111',
  'driver-free': '#16a34a',
  'driver-offered': '#f59e0b',
  'driver-busy': '#2563eb',
  candidate: '#7c3aed',
  ride: '#FFC400',
  'ride-alert': '#dc2626',
  sos: '#dc2626',
  center: '#111111',
};

/** Round markers stand on the point (cars); pins point at it with their tip. */
export const ROUND_MARKERS: ReadonlySet<MarkerKind> = new Set([
  'driver-free',
  'driver-offered',
  'driver-busy',
  'candidate',
  'center',
]);

export const LINE_COLOR = { route: '#111111', approach: '#2563eb' } as const;
