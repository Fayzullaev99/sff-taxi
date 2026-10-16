import { describe, expect, it } from 'vitest';
import { enabledClasses, renderExamples, renderPriceTable, renderRules } from './prices';
import {
  type ApiTariffResponse,
  cityFare,
  FALLBACK_TARIFFS,
  fetchTariffs,
  fromApi,
  intercityFare,
  isApiTariffResponse,
  money,
} from './tariffs';

const economy = FALLBACK_TARIFFS.classes[0]!;

/** What GET /v1/tariffs?lat&lng answers at Guliston with the launch tariff. */
const apiResponse: ApiTariffResponse = {
  serviceable: true,
  city: 'Guliston',
  tariff: {
    classes: Object.fromEntries(
      FALLBACK_TARIFFS.classes.map((c) => [
        c.id,
        {
          enabled: c.enabled,
          bands: c.bands.map((b) => ({ up_to_m: b.upToM, price: b.price })),
          beyond_per_km: c.beyondPerKm,
          outside_per_km: c.outsidePerKm,
          intercity_per_km: c.intercityPerKm,
          intercity_min: c.intercityMin,
        },
      ]),
    ),
    night: { percent: 20, from: '23:00', to: '06:00' },
    waiting: { free_minutes: 2, per_minute: 500 },
    options: { child_seat: 2000, luggage: 2000, pets: 3000, ac: 0 },
    seats: { share_percent: 30, front_extra_percent: 10 },
    intercity_from_km: 20,
    cancellation_fee: 3000,
    stops: { per_stop: 1000, free_minutes: 3 },
  },
};

describe('fares', () => {
  it('prices the bands and the kilometres beyond them like the API', () => {
    expect(cityFare(economy, 1500)).toBe(5000);
    expect(cityFare(economy, 2000)).toBe(5000);
    expect(cityFare(economy, 2001)).toBe(7000);
    expect(cityFare(economy, 7000)).toBe(10_000);
    expect(cityFare(economy, 9000)).toBe(11_800);
  });

  it('prices intercity by the kilometre with a minimum', () => {
    expect(intercityFare(economy, 5000)).toBe(25_000);
    expect(intercityFare(economy, 30_000)).toBe(51_000);
  });

  it('formats money in groups of three', () => {
    expect(money(5000)).toBe('5 000');
    expect(money(123_456_789)).toBe('123 456 789');
    expect(money(900)).toBe('900');
  });
});

describe('rendering', () => {
  it('shows only the classes operators switched on', () => {
    expect(enabledClasses(FALLBACK_TARIFFS).map((c) => c.id)).toEqual(['economy', 'comfort']);
    const table = renderPriceTable(FALLBACK_TARIFFS, 'uz');
    expect(table).toContain('Ekonom');
    expect(table).toContain('Komfort');
    expect(table).not.toContain('Miniven');
    expect(table).toContain('2 km gacha');
    expect(table).toContain('5 000');
    expect(table).toContain('+900');
  });

  it('renders Russian labels', () => {
    const table = renderPriceTable(FALLBACK_TARIFFS, 'ru');
    expect(table).toContain('Эконом');
    expect(table).toContain('до 2 км');
    expect(renderRules(FALLBACK_TARIFFS, 'ru')).toContain('23:00–06:00');
    expect(renderExamples(FALLBACK_TARIFFS, 'ru')).toContain('51 000 сум');
  });

  it('escapes labels coming from the API', () => {
    const evil = {
      ...FALLBACK_TARIFFS,
      classes: [{ ...economy, id: 'x', label: '<img src=x onerror=1>' }],
    };
    expect(renderPriceTable(evil, 'uz')).not.toContain('<img');
  });
});

describe('the API tariff', () => {
  it('converts the API document into the page shape, in class order', () => {
    const got = fromApi(apiResponse)!;
    expect(got.city).toBe('Guliston');
    expect(got.classes.map((c) => c.id)).toEqual(['economy', 'comfort', 'minivan', 'business']);
    expect(got.classes[0]).toEqual(economy);
    expect(got.waiting).toEqual({ freeMinutes: 2, perMinute: 500 });
    expect(got.stops).toEqual({ perStop: 1000, freeMinutes: 3 });
    expect(got.cancellationFee).toBe(3000);
  });

  it('is null outside the service area', () => {
    expect(fromApi({ serviceable: false, city: null, tariff: null })).toBeNull();
  });

  it('is fetched for the launch city', async () => {
    let url = '';
    const fetchFn = (async (input: RequestInfo | URL) => {
      url = String(input);
      return new Response(JSON.stringify(apiResponse), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const got = await fetchTariffs(fetchFn);
    expect(url).toContain('/v1/tariffs?lat=40.49598&lng=68.77587');
    expect(got?.classes.length).toBe(4);
  });

  it('falls back on errors, 404s and strange bodies', async () => {
    const notFound = (async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await fetchTariffs(notFound)).toBeNull();
    const strange = (async () => new Response(JSON.stringify({ hello: 1 }))) as typeof fetch;
    expect(await fetchTariffs(strange)).toBeNull();
    const failing = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    expect(await fetchTariffs(failing)).toBeNull();
    expect(isApiTariffResponse(null)).toBe(false);
    expect(isApiTariffResponse({ serviceable: true, tariff: { classes: 'x' } })).toBe(false);
  });
});
