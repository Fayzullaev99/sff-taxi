import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { config } from './config';
import { type Key, type Lang, t } from './i18n';
import { currentLang } from './lang';
import { tokenFromLocation } from './links';
import { initPage } from './page';

/**
 * /t/TOKEN: the share-trip page riders send to family (API GET /v1/share/:token): the
 * car, the driver's first name and rating, the stops and the live position with its trail.
 * No phone numbers; 410 once the ride ended. Polled every 5 seconds.
 */

interface SharedRide {
  number: number;
  status: string;
  pickup: { address: string | null; landmark?: string | null; lat: number; lng: number };
  dropoff: { address: string | null; landmark?: string | null; lat: number; lng: number };
  stops: { address: string | null; lat: number; lng: number; passed: boolean }[];
  driver: { name: string; rating: number | null } | null;
  vehicle: {
    make: string;
    model: string;
    /** In the API's default language; `colourNames` has both, for the page's own switch. */
    colour: string;
    colourNames?: { uz: string; ru: string };
    plateFormatted: string;
  } | null;
  position: { lat: number; lng: number; heading?: number | null } | null;
  trail: { lat: number; lng: number }[];
  startedAt: string | null;
}

const POLL_MS = 5000;
// apps/api src/core/db/schema.ts OPEN_RIDE_STATUSES (the page gets 410 for any other)
const STATUS_KEYS: Record<string, Key> = {
  searching: 'share.status.searching',
  driver_assigned: 'share.status.assigned',
  driver_arrived: 'share.status.arrived',
  in_progress: 'share.status.in_progress',
};

const $ = (id: string) => document.getElementById(id);

initPage({ campaign: 'share' });

const token = tokenFromLocation(location.pathname);
let ride: SharedRide | null = null;
let map: L.Map | null = null;
let car: L.Marker | null = null;
let trail: L.Polyline | null = null;
let fitted = false;

function showMessage(key: Key, error = false): void {
  const msg = $('message');
  if (!msg) return;
  msg.hidden = false;
  msg.className = `trip__msg${error ? ' trip__msg--error' : ''}`;
  msg.textContent = t(key, currentLang());
  const facts = $('facts');
  if (facts) facts.hidden = true;
}

function place(p: { address: string | null; landmark?: string | null }): string {
  return p.landmark || p.address || '—';
}

function render(lang: Lang): void {
  if (!ride) return;
  const status = $('status');
  if (status) status.textContent = t(STATUS_KEYS[ride.status] ?? 'share.status.other', lang);
  const title = $('title');
  if (title) title.textContent = t('share.ride', lang, { number: ride.number });
  const driver = $('driver');
  if (driver) {
    driver.textContent = ride.driver
      ? `${ride.driver.name}${ride.driver.rating ? ` · ★ ${ride.driver.rating.toFixed(1)}` : ''}`
      : '—';
  }
  const vehicle = $('vehicle');
  if (vehicle) {
    vehicle.textContent = '';
    if (ride.vehicle) {
      const colour = ride.vehicle.colourNames?.[lang] ?? ride.vehicle.colour;
      vehicle.append(`${colour} ${ride.vehicle.make} ${ride.vehicle.model}`);
      const plate = document.createElement('span');
      plate.className = 'plate';
      plate.textContent = ride.vehicle.plateFormatted;
      vehicle.append(plate);
    } else vehicle.textContent = '—';
  }
  const from = $('from');
  if (from) from.textContent = place(ride.pickup);
  const to = $('to');
  if (to) to.textContent = place(ride.dropoff);
  const stops = $('stops');
  const stopsFact = $('stops-fact');
  if (stops && stopsFact) {
    stopsFact.hidden = ride.stops.length === 0;
    stops.textContent = ride.stops
      .map((s) => `${s.passed ? '✓ ' : ''}${s.address ?? '—'}`)
      .join(' → ');
  }
  const noPos = $('no-position');
  if (noPos) noPos.hidden = Boolean(ride.position);
  renderMap();
}

function renderMap(): void {
  if (!ride) return;
  const el = $('map');
  if (!el) return;
  if (!map) {
    map = L.map(el, { zoomControl: true, attributionControl: true });
    L.tileLayer(config.mapTileUrl, { maxZoom: 19, attribution: config.mapAttribution }).addTo(map);
    const pin = (lat: number, lng: number, label: string) =>
      L.circleMarker([lat, lng], {
        radius: 7,
        color: '#111',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2,
      })
        .addTo(map!)
        .bindTooltip(label);
    pin(ride.pickup.lat, ride.pickup.lng, 'A');
    ride.stops.forEach((s, i) => pin(s.lat, s.lng, String(i + 1)));
    pin(ride.dropoff.lat, ride.dropoff.lng, 'B');
  }
  const points: L.LatLngExpression[] = ride.trail.map((p) => [p.lat, p.lng]);
  if (ride.position) points.push([ride.position.lat, ride.position.lng]);
  if (points.length) {
    if (!trail) trail = L.polyline(points, { color: '#111', weight: 3, opacity: 0.6 }).addTo(map);
    else trail.setLatLngs(points);
  }
  if (ride.position) {
    const at: L.LatLngExpression = [ride.position.lat, ride.position.lng];
    if (!car) {
      car = L.marker(at, {
        icon: L.divIcon({ className: 'car-marker', iconSize: [18, 18] }),
        keyboard: false,
      }).addTo(map);
    } else car.setLatLng(at);
  }
  if (!fitted) {
    const all: L.LatLngExpression[] = [
      [ride.pickup.lat, ride.pickup.lng],
      [ride.dropoff.lat, ride.dropoff.lng],
      ...ride.stops.map((s): L.LatLngExpression => [s.lat, s.lng]),
      ...points,
    ];
    map.fitBounds(L.latLngBounds(all), { padding: [30, 30], maxZoom: 16 });
    fitted = true;
  }
}

async function poll(): Promise<void> {
  if (!token) return;
  try {
    const res = await fetch(`${config.apiUrl}/v1/share/${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return showMessage('share.notFound', true);
    if (res.status === 410) return showMessage('share.ended');
    if (!res.ok) throw new Error(String(res.status));
    ride = (await res.json()) as SharedRide;
    const msg = $('message');
    if (msg) msg.hidden = true;
    const facts = $('facts');
    if (facts) facts.hidden = false;
    render(currentLang());
    window.setTimeout(() => void poll(), POLL_MS);
  } catch {
    if (!ride) showMessage('share.error', true);
    window.setTimeout(() => void poll(), POLL_MS * 2);
  }
}

if (!token) showMessage('share.notFound', true);
else void poll();
document.addEventListener('langchange', (e) => render((e as CustomEvent<Lang>).detail));
