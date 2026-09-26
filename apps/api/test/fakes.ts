import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { distanceM } from '../src/lib/distance.js';
import type { Point } from '../src/lib/geo.js';

/**
 * One fake for every external HTTP service the API calls: Yandex Geocoder, Nominatim,
 * OSRM and the Expo push service. Tests switch their behaviour through `fake.mode` and
 * `fake.osrm`, and read what was called from `fake.hits`.
 */
export interface Hit {
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
  at: number;
}

export type OsrmAnswer = (
  origin: Point,
  destination: Point,
) => { distance: number; duration: number } | null;

/** Road = 1.3 × straight line at 30 km/h: a plausible small-city router. */
export const defaultOsrm: OsrmAnswer = (o, d) => {
  const distance = Math.round(distanceM(o.lat, o.lng, d.lat, d.lng) * 1.3);
  return { distance, duration: Math.round(distance / (30 / 3.6)) };
};

export interface Fake {
  base: string;
  hits: Hit[];
  mode: {
    yandex: 'ok' | 'fail';
    nominatim: 'ok' | 'fail';
    osrm: 'ok' | 'fail' | 'slow';
    expo: 'ok' | 'fail';
  };
  osrm: OsrmAnswer;
  hitsOf(prefix: string): Hit[];
  /** The env pointing the API at this fake (read by loadEnv when the app starts). */
  env(): Record<string, string>;
  close(): Promise<void>;
}

function yandexObject(name: string, description: string, lng: number, lat: number) {
  return {
    GeoObject: {
      metaDataProperty: {
        GeocoderMetaData: {
          kind: 'house',
          text: `Oʻzbekiston, ${description}, ${name}`,
          Address: {
            country_code: 'UZ',
            formatted: `${description}, ${name}`,
            Components: [
              { kind: 'country', name: 'Oʻzbekiston' },
              { kind: 'province', name: 'Sirdaryo viloyati' },
              { kind: 'locality', name: description.split(',')[0] },
              { kind: 'district', name: 'Bahor mahallasi' },
              { kind: 'street', name: 'Mustaqillik koʻchasi' },
              { kind: 'house', name: '12' },
            ],
          },
        },
      },
      name,
      description,
      Point: { pos: `${lng} ${lat}` },
    },
  };
}

function nominatimPlace(lat: number, lng: number) {
  return {
    lat: String(lat),
    lon: String(lng),
    name: '',
    display_name: 'Navoiy koʻchasi, 7, Guliston',
    addresstype: 'building',
    address: {
      house_number: '7',
      road: 'Navoiy koʻchasi',
      neighbourhood: 'Gulzor MFY',
      city: 'Guliston',
      state: 'Sirdaryo viloyati',
      country_code: 'uz',
    },
  };
}

export async function startFake(): Promise<Fake> {
  const hits: Hit[] = [];
  const fake = {
    hits,
    mode: { yandex: 'ok', nominatim: 'ok', osrm: 'ok', expo: 'ok' },
    osrm: defaultOsrm,
  } as Fake;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://fake');
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      const body = raw ? (JSON.parse(raw) as unknown) : null;
      hits.push({
        path: url.pathname,
        query: url.searchParams,
        headers: req.headers,
        body,
        at: Date.now(),
      });
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      if (url.pathname.startsWith('/yandex')) {
        if (fake.mode.yandex === 'fail') return json(500, { error: 'boom' });
        const geocode = url.searchParams.get('geocode')!;
        const guliston = yandexObject(
          'Mustaqillik koʻchasi, 12',
          'Guliston, Sirdaryo viloyati',
          68.776,
          40.4965,
        );
        const members = /^[\d.]+,[\d.]+$/.test(geocode)
          ? [guliston]
          : [
              guliston,
              yandexObject(
                'Mustaqillik koʻchasi, 12',
                'Yangiyer, Sirdaryo viloyati',
                68.8166,
                40.2701,
              ),
            ];
        return json(200, { response: { GeoObjectCollection: { featureMember: members } } });
      }
      if (url.pathname.startsWith('/nominatim')) {
        if (fake.mode.nominatim === 'fail') return json(503, { error: 'busy' });
        if (url.pathname.endsWith('/reverse')) {
          return json(
            200,
            nominatimPlace(
              Number(url.searchParams.get('lat')),
              Number(url.searchParams.get('lon')),
            ),
          );
        }
        return json(200, [nominatimPlace(40.497, 68.777)]);
      }
      if (url.pathname.startsWith('/osrm/table/v1/driving/')) {
        const coords = decodeURIComponent(url.pathname.slice('/osrm/table/v1/driving/'.length))
          .split(';')
          .map((c) => {
            const [lng, lat] = c.split(',').map(Number);
            return { lat: lat!, lng: lng! };
          });
        const sources = url.searchParams.get('sources')!.split(';').map(Number);
        const dest = coords[Number(url.searchParams.get('destinations'))]!;
        const answers = sources.map((i) => fake.osrm(coords[i]!, dest));
        const answer = () =>
          json(200, {
            code: 'Ok',
            distances: answers.map((a) => [a ? a.distance : null]),
            durations: answers.map((a) => [a ? a.duration : null]),
          });
        if (fake.mode.osrm === 'fail') return json(500, { code: 'InternalError' });
        if (fake.mode.osrm === 'slow') return void setTimeout(answer, 2500);
        return answer();
      }
      if (url.pathname === '/expo/send') {
        if (fake.mode.expo === 'fail') return json(503, { errors: [{ message: 'down' }] });
        // a token containing "Dead" belongs to an uninstalled app
        const messages = body as { to: string }[];
        return json(200, {
          data: messages.map((m, i) =>
            m.to.includes('Dead')
              ? {
                  status: 'error',
                  message: 'not registered',
                  details: { error: 'DeviceNotRegistered' },
                }
              : { status: 'ok', id: `ticket-${Date.now()}-${i}` },
          ),
        });
      }
      if (url.pathname === '/expo/getReceipts') return json(200, { data: {} });
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.base = base;
  fake.hitsOf = (prefix) => hits.filter((h) => h.path.startsWith(prefix));
  fake.env = () => ({
    GEOCODER: 'yandex',
    YANDEX_GEOCODER_KEY: 'test-yandex-geocoder-key',
    YANDEX_GEOCODER_URL: `${base}/yandex/1.x/`,
    NOMINATIM_URL: `${base}/nominatim`,
    GEOCODER_CONTACT_EMAIL: 'ops@example.com',
    ROUTER: 'osrm',
    OSRM_URL: `${base}/osrm`,
    PUSH_PROVIDER: 'expo',
    EXPO_PUSH_BASE_URL: `${base}/expo`,
  });
  fake.close = () => new Promise((resolve) => server.close(() => resolve()));
  return fake;
}
