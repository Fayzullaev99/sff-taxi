/**
 * End-to-end smoke test against a running API + worker (skipped unless SMOKE_API_URL is
 * set). It drives the rider flow through this app's own API client and stream parser, with
 * a driver and an operator played through the HTTP API:
 *
 *   SMOKE_API_URL=http://localhost:3210 \
 *   SMOKE_ADMIN=+998900000019:111111 SMOKE_RIDER=+998911110001:222222 \
 *   SMOKE_DRIVER=+998911110002:333333 npx vitest run src/api/api.smoke.test.ts
 *
 * The API needs those phones in OTP_FIXED_CODES and the admin in ADMIN_PHONES; use a
 * throwaway database (the test creates a driver, rides, a complaint and intercity trips).
 * With Payme configured on the API (PAYME_MERCHANT_ID/PAYME_KEY) and SMOKE_PAYME_KEY set to
 * that key, a card ride is also paid (as Payme would) and refunded.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cancelTerms, fareLines, quoteOwedFee, rideRules } from '../lib/fare';
import { tashkentDay } from '../lib/format';
import { bookingCancelTerms, bookingPrice, cancelRulesFrom } from '../lib/intercity';
import { cardMoneyNote, checkoutLinks } from '../lib/payment';
import { groupSaved, recentKeyOf } from '../lib/places';
import { rideScreen } from '../lib/ride-state';
import { createApiClient, type SessionTokens } from './client';
import { parseRealtimeEvent } from './realtime-logic';
import type {
  AppConfig,
  Complaint,
  ComplaintListItem,
  CreatedUpload,
  GeoConfig,
  GeoResolve,
  IntercityBooking,
  IntercityTrip,
  Page,
  Quote,
  RealtimeEvent,
  RecentPlace,
  Ride,
  RideHistoryPage,
  RideSummary,
  SavedPlace,
  SosResult,
  TariffInfo,
  UploadsConfig,
} from './types';

const BASE = process.env.SMOKE_API_URL;
const GULISTON = { lat: 40.49598, lng: 68.77587 };
const MID = { lat: 40.49, lng: 68.8 };
const TASHKENT = { lat: 41.2995, lng: 69.2401 };

function creds(value: string | undefined) {
  const [phone, code] = (value ?? '').split(':');
  return { phone: phone!, code: code! };
}

type Client = ReturnType<typeof createApiClient>;

async function signIn(c: Client, who: string | undefined, app: 'rider' | 'driver' | 'admin') {
  const { phone, code } = creds(who);
  await c
    .request('/v1/auth/code', { method: 'POST', auth: 'none', body: { phone } })
    .catch(() => undefined);
  const pair = await c.request<SessionTokens>('/v1/auth/verify', {
    method: 'POST',
    auth: 'none',
    body: { phone, code, client: app },
  });
  return pair;
}

/** A client that already holds a session. */
async function session(who: string | undefined, app: 'rider' | 'driver' | 'admin') {
  let tokens: SessionTokens | null = null;
  const c = createApiClient({
    baseUrl: BASE!,
    tokens: { get: () => tokens, set: (t) => void (tokens = t) },
  });
  tokens = await signIn(c, who, app);
  return c;
}

/** Reads the SSE stream like the app does (react-native-sse there, fetch here). */
async function openStream(c: Client) {
  const { ticket } = await c.request<{ ticket: string }>('/v1/stream/ticket', {
    method: 'POST',
    body: {},
  });
  const controller = new AbortController();
  const res = await fetch(`${BASE}/v1/stream?ticket=${encodeURIComponent(ticket)}`, {
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  const events: RealtimeEvent[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const event = parseRealtimeEvent(line.slice(6));
            if (event) events.push(event);
          }
        }
      }
    } catch {
      // aborted
    }
  })();
  return { events, close: () => controller.abort() };
}

async function waitFor<T>(what: string, fn: () => Promise<T | null> | T | null, ms = 20_000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const digits = (n: number) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const letter = () => 'ABCDEFGHJKLMNOPRSTUVXYZ'[Math.floor(Math.random() * 23)]!;

/** Application with a car (no child seat), documents, operator approval. */
async function onboardDriver(driver: Client, admin: Client) {
  const applied = await driver.request<{ id: string }>('/v1/driver/application', {
    method: 'POST',
    body: {
      fullName: 'Aziz Karimov',
      birthDate: '1990-05-01',
      pinfl: `3${digits(13)}`,
      licenceNumber: `A${letter()}${digits(7)}`,
      licenceCategories: ['B'],
      licenceIssuedOn: '2012-03-01',
      licenceCardNumber: `LK-${digits(8)}`,
      licenceCardExpiresOn: '2030-01-01',
      vehicle: {
        make: 'Chevrolet',
        model: 'Cobalt',
        colour: 'oq',
        plate: `20 ${letter()} ${digits(3)} ${letter()}${letter()}`,
        year: 2021,
        seats: 4,
        class: 'economy',
        features: ['ac'],
      },
    },
  });
  for (const kind of [
    'licence_card',
    'driver_licence',
    'passport',
    'vehicle_registration',
    'insurance',
    'vehicle_photo',
    'selfie',
  ]) {
    await driver.request(`/v1/driver/documents/${kind}`, {
      method: 'PUT',
      body: { url: `https://files.example.uz/${applied.id}/${kind}.jpg` },
    });
  }
  // the licence card checked in the Ministry's registry (manual), then approval
  await admin.request(`/v1/admin/drivers/${applied.id}/licence`, {
    method: 'POST',
    body: { result: 'valid', note: 'Reyestrda tekshirildi' },
  });
  await admin.request(`/v1/admin/drivers/${applied.id}/approve`, { method: 'POST', body: {} });
}

/** Payme's side of a payment (JSON-RPC with the cashbox key), as the API's tests do it. */
async function payWithPayme(intentId: string, amount: number) {
  const call = async (method: string, params: Record<string, unknown>) => {
    const res = await fetch(`${BASE}/v1/payments/payme`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`Paycom:${process.env.SMOKE_PAYME_KEY}`).toString('base64')}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    return (await res.json()) as { result?: { state?: number }; error?: unknown };
  };
  const id = `pm-${randomUUID()}`;
  const created = await call('CreateTransaction', {
    id,
    time: Date.now(),
    amount: amount * 100,
    account: { order_id: intentId },
  });
  expect(created.result?.state).toBe(1);
  const performed = await call('PerformTransaction', { id });
  expect(performed.result?.state).toBe(2);
}

describe.skipIf(!BASE)('live API smoke (rider flow)', () => {
  it('orders, follows, completes, rates and cancels rides', { timeout: 120_000 }, async () => {
    const rider = await session(process.env.SMOKE_RIDER, 'rider');
    const driver = await session(process.env.SMOKE_DRIVER, 'driver');
    const admin = await session(process.env.SMOKE_ADMIN, 'admin');

    // profile
    const me = await rider.request<{ fullName: string | null }>('/v1/me', {
      method: 'PATCH',
      body: { fullName: 'Dilnoza Rahimova' },
    });
    expect(me.fullName).toBe('Dilnoza Rahimova');

    // map and service area
    const config = await rider.request<GeoConfig>('/v1/geo/config', { auth: 'none' });
    expect(config.defaultCenter).not.toBeNull();
    expect(config.cities.some((c) => c.isActive)).toBe(true);
    const here = await rider.request<TariffInfo>('/v1/tariffs', {
      auth: 'none',
      query: GULISTON,
    });
    expect(here.serviceable).toBe(true);
    expect(here.tariff?.waiting.free_minutes).toBeGreaterThan(0);
    expect(here.paymentMethods).toContain('cash');
    const far = await rider.request<TariffInfo>('/v1/tariffs', { auth: 'none', query: TASHKENT });
    expect(far.serviceable).toBe(false);
    const resolved = await rider.request<GeoResolve>('/v1/geo/resolve', {
      auth: 'none',
      query: TASHKENT,
    });
    expect(resolved.status).toBe('outside');

    // a driver: application, documents, approval (once), online next to the rider
    const driverMe = await driver.request<{ driver: { status: string } | null }>('/v1/me');
    if (driverMe.driver?.status !== 'active') await onboardDriver(driver, admin);
    await driver.request('/v1/driver/shift', { method: 'POST', body: { online: true } });
    await driver.request('/v1/driver/location', {
      method: 'POST',
      body: { lat: 40.4965, lng: 68.7762 },
    });

    // a ride left open by an earlier run would answer every order with 409
    const leftover = await rider.request<{ ride: Ride | null }>('/v1/rides/current');
    if (leftover.ride?.canCancel) {
      await rider.request(`/v1/rides/${leftover.ride.id}/cancel`, { method: 'POST', body: {} });
    }

    // quotes: fixed prices of both classes; the breakdown adds up; options are priced
    const withSeat = await rider.request<Quote>('/v1/rides/quote', {
      method: 'POST',
      body: { pickup: GULISTON, dropoff: MID, options: ['child_seat'] },
    });
    expect(withSeat.fares.economy.options.child_seat).toBeGreaterThan(0);
    for (const fare of Object.values(withSeat.fares)) {
      expect(fareLines(fare).reduce((s, l) => s + l.amount, 0)).toBe(fare.total);
    }
    // (the test car has no child seat: the ride itself is ordered without options)
    const quote = await rider.request<Quote>('/v1/rides/quote', {
      method: 'POST',
      body: { pickup: GULISTON, dropoff: MID, options: [] },
    });
    expect(quote.kind).toBe('city');
    // wave 3: card providers on the quote; nothing owed from earlier cancellations
    expect(Array.isArray(quote.cardProviders)).toBe(true);
    expect(quoteOwedFee(quote.owedFee, 'cash')).toBeNull();
    // the free car next to the rider is on the class buttons
    expect(quote.availability?.economy.cars).toBeGreaterThan(0);
    expect(quote.availability?.economy.etaS).toBeGreaterThanOrEqual(0);
    expect(quote.fares.comfort.total).toBeGreaterThan(quote.fares.economy.total);
    expect(withSeat.fares.economy.total).toBeGreaterThan(quote.fares.economy.total);
    const intercity = await rider.request<Quote>('/v1/rides/quote', {
      method: 'POST',
      body: { pickup: GULISTON, dropoff: TASHKENT, options: [] },
    });
    expect(intercity.kind).toBe('intercity');
    expect(intercity.fares.economy.seat?.rear).toBeGreaterThan(0);

    const stream = await openStream(rider);
    try {
      await waitFor('stream ready', () => stream.events.find((e) => e.type === 'ready') ?? null);

      // order; the same clientRequestId returns the same ride (200)
      const body = {
        quoteId: quote.quoteId,
        class: 'economy',
        paymentMethod: 'cash',
        pickup: { address: 'Mustaqillik 12', landmark: '5-maktab ro‘parasi' },
        dropoff: { address: 'Vokzal', landmark: null },
        comment: 'Darvoza oldida',
        clientRequestId: randomUUID(),
      };
      const first = await rider.requestWithStatus<Ride>('/v1/rides', { method: 'POST', body });
      expect(first.status).toBe(201);
      const again = await rider.requestWithStatus<Ride>('/v1/rides', { method: 'POST', body });
      expect(again.status).toBe(200);
      expect(again.data.id).toBe(first.data.id);
      const rideId = first.data.id;
      expect(rideScreen(first.data).phase).toBe('searching');
      expect(first.data.canCancel).toBe(true);
      expect(first.data.pickup.landmark).toBe('5-maktab ro‘parasi');

      const current = await rider.request<{ ride: Ride | null }>('/v1/rides/current');
      expect(current.ride?.id).toBe(rideId);

      // the driver gets the offer and takes it
      const offer = await waitFor('an offer', async () => {
        const offers =
          await driver.request<{ id: string; ride: { id: string } }[]>('/v1/driver/offers');
        return offers.find((o) => o.ride.id === rideId) ?? null;
      });
      await driver.request(`/v1/driver/offers/${offer.id}/accept`, { method: 'POST', body: {} });
      await waitFor('ride.updated assigned', () =>
        stream.events.find((e) => e.type === 'ride.updated' && e.status === 'driver_assigned')
          ? true
          : null,
      );
      const assigned = await rider.request<Ride>(`/v1/rides/${rideId}`);
      expect(rideScreen(assigned).phase).toBe('assigned');
      // wave 2: the car's road ETA and trail, the ride's own rules, not rated yet
      expect(assigned.driverEta?.etaS).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(assigned.trail)).toBe(true);
      expect(rideRules(assigned)).toEqual({
        waiting: quote.waiting,
        cancellationFee: quote.cancellationFee,
      });
      expect(assigned.rated).toBe(false);
      expect(assigned.driver?.name).toBe('Aziz Karimov');
      expect(assigned.driver?.phone).toBe(creds(process.env.SMOKE_DRIVER).phone);
      expect(assigned.vehicle?.plateFormatted).toMatch(/^20 /);
      expect(assigned.driver?.rating).toBeGreaterThan(0);

      // the car moves: the rider's stream carries its position
      await driver.request('/v1/driver/location', {
        method: 'POST',
        body: { lat: 40.4962, lng: 68.7761, heading: 180 },
      });
      const fix = await waitFor(
        'driver.location',
        () => stream.events.find((e) => e.type === 'driver.location') ?? null,
      );
      expect(fix).toMatchObject({ rideId, lat: 40.4962 });
      // on the way to the pickup the position carries the road ETA
      expect(fix.type === 'driver.location' ? fix.etaS : null).toBeGreaterThanOrEqual(0);

      // share link while the ride is open
      const link = await rider.request<{ url: string; token: string }>(
        `/v1/rides/${rideId}/share`,
        { method: 'POST', body: {} },
      );
      expect(link.url).toContain(link.token);

      // arrived: free waiting, cancelling is still free
      await driver.request(`/v1/driver/rides/${rideId}/arrive`, { method: 'POST', body: {} });
      const arrived = await waitFor('arrived', async () => {
        const r = await rider.request<Ride>(`/v1/rides/${rideId}`);
        return r.status === 'driver_arrived' ? r : null;
      });
      expect(arrived.arrivedAt).not.toBeNull();
      expect(
        cancelTerms(
          arrived,
          { waiting: quote.waiting, cancellationFee: quote.cancellationFee },
          new Date(),
        ).fee,
      ).toBe(0);

      // on the trip: SOS answers with the emergency numbers
      await driver.request(`/v1/driver/rides/${rideId}/start`, { method: 'POST', body: {} });
      const sos = await rider.request<SosResult>(`/v1/rides/${rideId}/sos`, {
        method: 'POST',
        body: { lat: 40.49, lng: 68.78, note: null },
      });
      expect(sos.emergency.unified).toBe('112');

      // wave 3: on the trip the car's position carries the road ETA to the destination
      await driver.request('/v1/driver/location', {
        method: 'POST',
        // under 200 m from the last fix: a bigger jump in a second is refused as a GPS glitch
        body: { lat: 40.4958, lng: 68.7775, heading: 120 },
      });
      const onTrip = await waitFor(
        'driver.location with destinationEtaS',
        () =>
          stream.events.find((e) => e.type === 'driver.location' && e.destinationEtaS !== null) ??
          null,
      );
      expect(
        onTrip.type === 'driver.location' ? onTrip.destinationEtaS : -1,
      ).toBeGreaterThanOrEqual(0);
      const riding = await rider.request<Ride>(`/v1/rides/${rideId}`);
      expect(riding.destinationEta?.etaS).toBeGreaterThanOrEqual(0);

      await driver.request(`/v1/driver/rides/${rideId}/complete`, { method: 'POST', body: {} });
      const done = await waitFor('completed', async () => {
        const r = await rider.request<Ride>(`/v1/rides/${rideId}`);
        return r.status === 'completed' ? r : null;
      });
      expect(rideScreen(done).final).toBe(true);
      expect(done.fare.total).toBe(done.fare.quoted + done.fare.waiting);
      expect(
        fareLines(done.fare.breakdown, done.fare.waiting).reduce((s, l) => s + l.amount, 0),
      ).toBe(done.fare.total);

      await rider.request(`/v1/rides/${rideId}/rating`, {
        method: 'POST',
        body: { stars: 5, tags: ['Toza mashina', 'Xushmuomala'], comment: null },
      });

      // rating twice is 409 (the app then just marks the ride as rated)
      const twice = await rider
        .request(`/v1/rides/${rideId}/rating`, {
          method: 'POST',
          body: { stars: 4, tags: [], comment: null },
        })
        .catch((e: unknown) => e);
      expect(twice).toMatchObject({ status: 409 });
      const rated = await rider.request<Ride>(`/v1/rides/${rideId}`);
      expect(rated.rated).toBe(true);
      // the fiscal receipt is prepared by the worker (no OFD provider: no link yet)
      const withReceipt = await waitFor('receipt', async () => {
        const r = await rider.request<Ride>(`/v1/rides/${rideId}`);
        return r.receipt ? r : null;
      });
      expect(['pending', 'sent', 'skipped']).toContain(withReceipt.receipt!.status);

      // a lost item on the completed ride: the thread with the operators
      const complaint = await rider.request<Complaint>(`/v1/rides/${rideId}/complaints`, {
        method: 'POST',
        body: { type: 'lost_item', text: 'Orqa o‘rindiqda qora sumka qoldi' },
      });
      expect(complaint).toMatchObject({ type: 'lost_item', status: 'open', rideId });
      const mine = await rider.request<Page<ComplaintListItem>>('/v1/complaints');
      expect(mine.items[0]?.id).toBe(complaint.id);
      await admin.request(`/v1/admin/complaints/${complaint.id}/messages`, {
        method: 'POST',
        body: { text: 'Haydovchi bilan bog‘landik, sumka ofisda' },
      });
      const replied = await rider.request<Complaint>(`/v1/complaints/${complaint.id}/messages`, {
        method: 'POST',
        body: { text: 'Rahmat, ertaga olaman' },
      });
      expect(replied.status).toBe('in_progress');
      expect(replied.messages.map((m) => m.authorRole)).toEqual(['admin', 'rider']);

      // wave 3: a photo on the complaint (with object storage: upload, PUT, complete)
      const uploads = await rider.request<UploadsConfig>('/v1/uploads/config');
      if (uploads.enabled) {
        const jpeg = new Uint8Array(64).fill(0);
        jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
        const created = await rider.request<CreatedUpload>('/v1/uploads', {
          method: 'POST',
          body: { purpose: 'complaint_photo', contentType: 'image/jpeg', sizeBytes: jpeg.length },
        });
        const put = await fetch(created.upload.url, {
          method: 'PUT',
          headers: created.upload.headers,
          body: jpeg,
        });
        expect(put.status).toBeLessThan(300);
        await rider.request(`/v1/uploads/${created.id}/complete`, { method: 'POST', body: {} });
        const withPhoto = await rider.request<Complaint>(
          `/v1/complaints/${complaint.id}/messages`,
          { method: 'POST', body: { text: 'Sumkaning rasmi', photoUploadIds: [created.id] } },
        );
        expect(withPhoto.photos?.map((p) => p.uploadId)).toEqual([created.id]);
        expect(withPhoto.photos?.[0]?.url).toMatch(/^https?:\/\//);
      }

      // recent destinations come from the ride history
      const recent = await rider.request<RecentPlace[]>('/v1/places/recent');
      expect(recent[0]).toMatchObject({ address: 'Vokzal' });
      // wave 3: hidden by its key until the rider goes there again; all back at once
      const key = recentKeyOf(recent[0]!);
      expect(recent[0]!.key).toBe(key);
      await rider.request('/v1/places/recent/hide', { method: 'POST', body: { key } });
      const hidden = await rider.request<RecentPlace[]>('/v1/places/recent');
      expect(hidden.map(recentKeyOf)).not.toContain(key);
      await rider.request('/v1/places/recent/hidden', { method: 'DELETE' });
      const shown = await rider.request<RecentPlace[]>('/v1/places/recent');
      expect(shown.map(recentKeyOf)).toContain(key);

      const history = await rider.request<RideHistoryPage>('/v1/rides');
      expect(history.items[0]?.id).toBe(rideId);

      // a second ride, cancelled by the rider while searching: free
      await driver.request('/v1/driver/shift', { method: 'POST', body: { online: false } });
      const quote2 = await rider.request<Quote>('/v1/rides/quote', {
        method: 'POST',
        body: { pickup: GULISTON, dropoff: MID, options: [] },
      });
      const second = await rider.request<Ride>('/v1/rides', {
        method: 'POST',
        body: { ...body, quoteId: quote2.quoteId, clientRequestId: randomUUID() },
      });
      // ordering again while it is open answers 409 with the open ride's id
      const conflict = await rider
        .request('/v1/rides', {
          method: 'POST',
          body: { ...body, quoteId: quote2.quoteId, clientRequestId: randomUUID() },
        })
        .catch((e: unknown) => e);
      expect(conflict).toMatchObject({ status: 409, body: { rideId: second.id } });
      const cancelled = await rider.request<Ride>(`/v1/rides/${second.id}/cancel`, {
        method: 'POST',
        body: { reason: 'Rejalarim o‘zgardi' },
      });
      expect(cancelled.status).toBe('cancelled');
      expect(cancelled.fare.cancellationFee).toBe(0);
      expect(rideScreen(cancelled).phase).toBe('cancelled');
    } finally {
      stream.close();
    }
  });

  it(
    'config, saved places, rides for later, card payment and intercity booking',
    { timeout: 120_000 },
    async () => {
      const rider = await session(process.env.SMOKE_RIDER, 'rider');
      const driver = await session(process.env.SMOKE_DRIVER, 'driver');
      const admin = await session(process.env.SMOKE_ADMIN, 'admin');
      const driverMe = await driver.request<{ driver: { status: string } | null }>('/v1/me');
      if (driverMe.driver?.status !== 'active') await onboardDriver(driver, admin);
      const leftover = await rider.request<{ ride: Ride | null }>('/v1/rides/current');
      if (leftover.ride?.canCancel) {
        await rider.request(`/v1/rides/${leftover.ride.id}/cancel`, { method: 'POST', body: {} });
      }

      // GET /config: public, the minimum version, what is switched on
      const config = await rider.request<AppConfig>('/v1/config', { auth: 'none' });
      // wave 3: no forced update unless set (null), store links, the seat board's rules
      expect(config.minAppVersion.rider ?? '0.0.0').toMatch(/^\d+\.\d+\.\d+$/);
      expect(config.storeUrls?.rider).toHaveProperty('android');
      expect(cancelRulesFrom(config.intercity)).toEqual(config.intercity);
      expect(config.features.intercity).toBe(true);
      expect(config.features.scheduledRides).toBe(true);

      // saved places: home replaces home, others add up, delete
      const before = await rider.request<SavedPlace[]>('/v1/places');
      for (const p of before) await rider.request(`/v1/places/${p.id}`, { method: 'DELETE' });
      await rider.request<SavedPlace>('/v1/places', {
        method: 'POST',
        body: { kind: 'home', address: 'Birinchi uy', lat: 40.5, lng: 68.78 },
      });
      const home = await rider.request<SavedPlace>('/v1/places', {
        method: 'POST',
        body: { kind: 'home', address: 'Yangi uy', lat: 40.501, lng: 68.781 },
      });
      const other = await rider.request<SavedPlace>('/v1/places', {
        method: 'POST',
        body: { kind: 'other', label: 'Onam', address: 'Bozor yonida', lat: 40.49, lng: 68.77 },
      });
      const grouped = groupSaved(await rider.request<SavedPlace[]>('/v1/places'));
      expect(grouped.home?.id).toBe(home.id);
      expect(grouped.home?.address).toBe('Yangi uy');
      expect(grouped.others.map((p) => p.id)).toEqual([other.id]);
      await rider.request(`/v1/places/${other.id}`, { method: 'DELETE' });

      // a ride for later: priced for its time, cash, listed, cancelled free
      const at = new Date(Date.now() + 2 * 3600_000);
      at.setUTCMinutes(0, 0, 0);
      const later = await rider.request<Quote>('/v1/rides/quote', {
        method: 'POST',
        body: { pickup: GULISTON, dropoff: MID, options: [], scheduledFor: at.toISOString() },
      });
      expect(later.availability).toBeNull();
      expect(new Date(later.scheduledFor!).getTime()).toBe(at.getTime());
      const scheduled = await rider.request<Ride>('/v1/rides', {
        method: 'POST',
        body: {
          quoteId: later.quoteId,
          class: 'economy',
          paymentMethod: 'cash',
          pickup: { address: 'Yangi uy', landmark: null },
          dropoff: { address: 'Vokzal', landmark: null },
          comment: null,
          clientRequestId: randomUUID(),
        },
      });
      expect(rideScreen(scheduled).phase).toBe('scheduled');
      const list = await rider.request<RideSummary[]>('/v1/rides/scheduled');
      expect(list.map((r) => r.id)).toContain(scheduled.id);
      const dropped = await rider.request<Ride>(`/v1/rides/${scheduled.id}/cancel`, {
        method: 'POST',
        body: { reason: null },
      });
      expect(rideScreen(dropped).phase).toBe('cancelled');

      // a card ride (when the API has a provider): awaiting payment, paid, cancelled, refunded
      if (config.cardProviders.includes('payme') && process.env.SMOKE_PAYME_KEY) {
        await driver.request('/v1/driver/shift', { method: 'POST', body: { online: false } });
        const q = await rider.request<Quote>('/v1/rides/quote', {
          method: 'POST',
          body: { pickup: GULISTON, dropoff: MID, options: [] },
        });
        expect(q.paymentMethods).toContain('card');
        const card = await rider.request<Ride>('/v1/rides', {
          method: 'POST',
          body: {
            quoteId: q.quoteId,
            class: 'economy',
            paymentMethod: 'card',
            pickup: { address: null, landmark: null },
            dropoff: { address: null, landmark: null },
            comment: null,
            clientRequestId: randomUUID(),
          },
        });
        expect(rideScreen(card).phase).toBe('awaiting_payment');
        expect(checkoutLinks(card.payment).map((l) => l.provider)).toContain('payme');
        await payWithPayme(card.payment!.id, card.payment!.amount);
        const paid = await waitFor('paid', async () => {
          const r = await rider.request<Ride>(`/v1/rides/${card.id}`);
          return r.status === 'searching' ? r : null;
        });
        expect(paid.paymentStatus).toBe('paid');
        const refundStream = await openStream(rider);
        try {
          await waitFor('stream ready', () =>
            refundStream.events.find((e) => e.type === 'ready') ? true : null,
          );
          const refunded = await rider.request<Ride>(`/v1/rides/${card.id}/cancel`, {
            method: 'POST',
            body: { reason: null },
          });
          expect(refunded.paymentStatus).toBe('refund_pending');
          expect(cardMoneyNote(refunded)?.title).toBe('Pul kartangizga qaytariladi');
          // wave 3: the refund reaches the open ride screen over the stream
          const refundEvent = await waitFor(
            'ride.refund',
            () =>
              refundStream.events.find((e) => e.type === 'ride.refund' && e.rideId === card.id) ??
              null,
          );
          expect(refundEvent).toMatchObject({ status: 'refund_pending', amount: paid.fare.quoted });
        } finally {
          refundStream.close();
        }
      }

      // intercity: the driver publishes a departure, the rider finds it and books the front
      const departure = new Date(Date.now() + 3 * 3600_000);
      const published = await driver.request<{ id: string }>('/v1/driver/intercity/trips', {
        method: 'POST',
        body: {
          from: 'guliston',
          to: 'toshkent',
          departureAt: departure.toISOString(),
          seats: 3,
          frontSeat: true,
        },
      });
      const found = await rider.request<IntercityTrip[]>('/v1/intercity/trips', {
        query: { from: 'guliston', to: 'toshkent', date: tashkentDay(departure), seats: 2 },
      });
      const trip = found.find((t) => t.id === published.id)!;
      expect(trip.seats).toMatchObject({ total: 3, free: 3, frontFree: true });
      expect(trip.price.front).toBeGreaterThanOrEqual(trip.price.rear);
      const bookBody = { seats: 2, front: true, pickupNote: null, clientRequestId: randomUUID() };
      const booked = await rider.requestWithStatus<IntercityBooking>(
        `/v1/intercity/trips/${trip.id}/bookings`,
        { method: 'POST', body: bookBody },
      );
      expect(booked.status).toBe(201);
      const repeat = await rider.requestWithStatus<IntercityBooking>(
        `/v1/intercity/trips/${trip.id}/bookings`,
        { method: 'POST', body: bookBody },
      );
      expect(repeat).toMatchObject({ status: 200, data: { id: booked.data.id } });
      expect(booked.data.price).toBe(bookingPrice(2, true, trip.price));
      expect(booked.data.contact?.driverPhone).toBe(creds(process.env.SMOKE_DRIVER).phone);
      expect(booked.data.canCancel).toBe(true);
      const again = await rider.request<IntercityTrip>(`/v1/intercity/trips/${trip.id}`);
      expect(again.myBookingId).toBe(booked.data.id);
      // wave 3: the rules and times the booking is under, from the API
      expect(cancelRulesFrom(again.cancelRules)).toEqual(config.intercity);
      expect(booked.data.cancelFeeNow).toBe(0);
      const terms = bookingCancelTerms(
        trip.departureAt,
        booked.data.price,
        new Date(),
        cancelRulesFrom(booked.data.cancelRules),
        { freeUntil: booked.data.cancelFreeUntil, feeNow: booked.data.cancelFeeNow },
      );
      expect(terms.fee).toBe(0);
      expect(terms.freeUntil?.toISOString()).toBe(
        new Date(booked.data.cancelFreeUntil!).toISOString(),
      );
      const cancelledBooking = await rider.request<IntercityBooking>(
        `/v1/intercity/bookings/${booked.data.id}/cancel`,
        { method: 'POST', body: { reason: null } },
      );
      // more than 60 minutes before departure: free
      expect(cancelledBooking).toMatchObject({ status: 'cancelled', cancellationFee: 0 });
      await driver.request(`/v1/driver/intercity/trips/${trip.id}/cancel`, {
        method: 'POST',
        body: { reason: 'Smoke test tugadi' },
      });
    },
  );

  // SMOKE_SLOW=1: waits for the shortest search timeout the API allows (60 s)
  it.skipIf(!process.env.SMOKE_SLOW)(
    'shows "no driver" when the system gives up searching',
    { timeout: 150_000 },
    async () => {
      const rider = await session(process.env.SMOKE_RIDER, 'rider');
      const admin = await session(process.env.SMOKE_ADMIN, 'admin');
      const driver = await session(process.env.SMOKE_DRIVER, 'driver');
      await driver.request('/v1/driver/shift', { method: 'POST', body: { online: false } });
      const rules = await admin.request<Record<string, unknown>>('/v1/admin/settings/dispatch');
      await admin.request('/v1/admin/settings/dispatch', {
        method: 'PUT',
        body: { ...rules, search_timeout_seconds: 60 },
      });
      try {
        const quote = await rider.request<Quote>('/v1/rides/quote', {
          method: 'POST',
          body: { pickup: GULISTON, dropoff: MID, options: [] },
        });
        const ride = await rider.request<Ride>('/v1/rides', {
          method: 'POST',
          body: {
            quoteId: quote.quoteId,
            class: 'economy',
            paymentMethod: 'cash',
            pickup: { address: null, landmark: null },
            dropoff: { address: null, landmark: null },
            comment: null,
            clientRequestId: randomUUID(),
          },
        });
        const gaveUp = await waitFor(
          'system cancellation',
          async () => {
            const r = await rider.request<Ride>(`/v1/rides/${ride.id}`);
            return r.status === 'cancelled' ? r : null;
          },
          120_000,
        );
        expect(gaveUp.cancelledBy).toBe('system');
        expect(rideScreen(gaveUp)).toMatchObject({ phase: 'no_driver', final: true });
      } finally {
        await admin.request('/v1/admin/settings/dispatch', { method: 'PUT', body: rules });
      }
    },
  );
});
