/* global process, URL, performance, Buffer, setTimeout, console, fetch */
/**
 * Load test against a running API + worker on a SEEDED THROWAWAY database (seed.ts):
 *
 *   LOAD_API=http://localhost:3270 LOAD_DB=postgres://taxi_app:…/taxi_load_x \
 *   LOAD_REDIS=redis://localhost:6394/10 LOAD_JWT_SECRET=… node scripts/loadtest/run.mjs
 *
 * Tokens are minted with the API's JWT secret for seeded accounts (no SMS). Online drivers
 * send a GPS fix every 4 s for the whole run; drivers hear their offers the way the app's
 * stream does (the realtime Redis channel the API relays) and accept through the API.
 * Prints p50/p95/p99 per endpoint as JSON lines and a summary table.
 *
 * LOAD_WAVE4=1 adds wave 4 (docs/shared-rides.md): LOAD_POOL_SHARE of the online drivers take
 * shared rides (PUT driver/preferences, a third of them heading somewhere), LOAD_SHAREABLE of
 * the orders agree to share, some verified women drivers and women riders (a few women-only
 * orders). Drivers then follow their stop list (GET driver/rides/current, the next stop's
 * ride; start codes from the rider's view) and keep taking offers on their way; a trip takes
 * LOAD_TRIP_S. The worker's dispatch tick histogram (LOAD_WORKER/metrics) is reported too.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const API = process.env.LOAD_API ?? 'http://localhost:3270';
const ONLINE = Number(process.env.LOAD_ONLINE ?? 300);
const FIX_EVERY_MS = Number(process.env.LOAD_FIX_MS ?? 4000);
const PHASE_S = Number(process.env.LOAD_PHASE_S ?? 20);
const CYCLE_S = Number(process.env.LOAD_CYCLE_S ?? 60);
const RIDER_FLOWS = Number(process.env.LOAD_RIDER_FLOWS ?? 20);
const CENTER = { lat: 40.49598, lng: 68.77587 };
const STATION = { lat: 40.5, lng: 68.825 };
const WAVE4 = process.env.LOAD_WAVE4 === '1';
const POOL_SHARE = Number(process.env.LOAD_POOL_SHARE ?? 0.2);
const SHAREABLE = Number(process.env.LOAD_SHAREABLE ?? 0.3);
const WOMEN_ONLY = Number(process.env.LOAD_WOMEN_ONLY ?? 0.05);
const TRIP_MS = Number(process.env.LOAD_TRIP_S ?? 15) * 1000;
const WORKER = process.env.LOAD_WORKER ?? 'http://localhost:3271';

const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });
const url = new URL(API);
const stats = new Map();
const record = (name, ms, ok) => {
  let s = stats.get(name);
  if (!s) stats.set(name, (s = { lat: [], errors: 0, codes: {} }));
  s.lat.push(ms);
  if (!ok) s.errors++;
};

function call(name, method, path, token, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const started = performance.now();
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: `/v1${path}`,
        method,
        agent,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const ms = performance.now() - started;
          const ok = res.statusCode < 400 || res.statusCode === 409;
          if (name) {
            record(name, ms, ok);
            const s = stats.get(name);
            s.codes[res.statusCode] = (s.codes[res.statusCode] ?? 0) + 1;
          }
          const text = Buffer.concat(chunks).toString();
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, body: json, ms });
        });
      },
    );
    req.on('error', () => {
      if (name) record(name, performance.now() - started, false);
      resolve({ status: 0, body: null, ms: 0 });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (m) => (Math.random() - 0.5) * (m / 55_000);
const around = (p, metres) => ({ lat: p.lat + jitter(metres), lng: p.lng + jitter(metres) * 1.3 });

/** Runs `fn` in `concurrency` loops for `seconds`. */
async function phase(label, concurrency, seconds, fn) {
  const until = Date.now() + seconds * 1000;
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < until) await fn(i++);
    }),
  );
  console.log(`phase ${label}: ${i} requests in ${seconds} s`);
}

const token = (sub) =>
  jwt.sign({}, process.env.LOAD_JWT_SECRET, {
    subject: sub,
    audience: 'access',
    expiresIn: 4 * 3600,
  });

// Setup --------------------------------------------------------------------------------------
const db = new pg.Client({ connectionString: process.env.LOAD_DB });
await db.connect();
const riders = (
  await db.query(
    `SELECT id, phone FROM users WHERE phone LIKE '+99893%' ORDER BY random() LIMIT 6000`,
  )
).rows.map((r) => ({ ...r, token: token(r.id) }));
const drivers = (
  await db.query(
    `SELECT d.user_id AS id FROM drivers d WHERE d.status = 'active' ORDER BY random() LIMIT $1`,
    [ONLINE],
  )
).rows.map((r) => ({ ...r, token: token(r.id), pos: around(CENTER, 5000), busy: false }));
const driverById = new Map(drivers.map((d) => [d.id, d]));
const someDriverIds = (
  await db.query(`SELECT user_id FROM drivers ORDER BY random() LIMIT 50`)
).rows.map((r) => r.user_id);
if (WAVE4) {
  // one driver in ten a verified woman (none of them women-riders-only), 45% women riders
  await db.query(
    `UPDATE drivers SET gender = 'female', gender_verified_at = coalesce(gender_verified_at, now())
     WHERE abs(hashtext(user_id::text)) % 10 = 0`,
  );
  await db.query(
    `UPDATE users SET gender = CASE WHEN abs(hashtext(id::text)) % 100 < 45 THEN 'female' ELSE 'male' END
     WHERE id = ANY($1::uuid[])`,
    [riders.map((r) => r.id)],
  );
  const women = new Set(
    (
      await db.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) AND gender = 'female'`, [
        riders.map((r) => r.id),
      ])
    ).rows.map((r) => r.id),
  );
  for (const r of riders) r.female = women.has(r.id);
}
await db.end();

/** The worker's dispatch tick histogram: cumulative buckets, sum and count. */
async function tickHistogram() {
  const res = await fetch(`${WORKER}/metrics`).catch(() => null);
  if (!res?.ok) return null;
  const text = await res.text();
  const buckets = [];
  let sum = 0;
  let count = 0;
  for (const line of text.split('\n')) {
    const b = /^dispatch_tick_seconds_bucket\{le="([^"]+)".*\} (\S+)$/.exec(line);
    if (b) buckets.push([b[1] === '+Inf' ? Infinity : Number(b[1]), Number(b[2])]);
    const s = /^dispatch_tick_seconds_sum\{.*\} (\S+)$/.exec(line);
    if (s) sum = Number(s[1]);
    const c = /^dispatch_tick_seconds_count\{.*\} (\S+)$/.exec(line);
    if (c) count = Number(c[1]);
  }
  return { buckets, sum, count };
}
/** p50/p95/p99 (ms, linear within a bucket) and the mean of the ticks between two scrapes. */
function tickSummary(a, b) {
  if (!a || !b || b.count <= a.count) return null;
  const n = b.count - a.count;
  const at = (p) => {
    const want = (p / 100) * n;
    let lower = 0;
    let below = 0;
    for (const [i, [le, cum]] of b.buckets.entries()) {
      const c = cum - (a.buckets[i]?.[1] ?? 0);
      if (c >= want) {
        if (le === Infinity) return lower * 1000;
        return (lower + ((want - below) / Math.max(1, c - below)) * (le - lower)) * 1000;
      }
      lower = le;
      below = c;
    }
    return lower * 1000;
  };
  return { n, p50: at(50), p95: at(95), p99: at(99), mean: ((b.sum - a.sum) / n) * 1000 };
}
const ticksAtStart = await tickHistogram();

await call(null, 'POST', '/auth/code', null, { phone: '+998900000001' });
const adminLogin = await call(null, 'POST', '/auth/verify', null, {
  phone: '+998900000001',
  code: '111111',
  client: 'admin',
});
const admin = adminLogin.body.accessToken;
if (!admin) throw new Error(`admin sign-in failed: ${JSON.stringify(adminLogin.body)}`);

// drivers start the shift and send a first fix
await Promise.all(
  drivers.map(async (d) => {
    const s = await call(null, 'POST', '/driver/shift', d.token, { online: true });
    if (s.status !== 200) console.log('shift', s.status, JSON.stringify(s.body));
    await call(null, 'POST', '/driver/location', d.token, { ...d.pos, accuracy: 10 });
  }),
);
console.log(`${drivers.length} drivers online, ${riders.length} rider tokens`);
if (WAVE4) {
  // shared rides on for POOL_SHARE of the drivers; a third of them heading somewhere
  const poolDrivers = drivers.slice(0, Math.round(drivers.length * POOL_SHARE));
  await Promise.all(
    poolDrivers.map(async (d, i) => {
      d.pool = true;
      const dest = i % 3 === 0 ? around(STATION, 2000) : null;
      const res = await call('driver/preferences', 'PUT', '/driver/preferences', d.token, {
        poolEnabled: true,
        ...(dest ? { destination: { ...dest, address: 'Guliston' } } : {}),
      });
      if (res.status !== 200) console.log('preferences', res.status, JSON.stringify(res.body));
    }),
  );
  console.log(`${poolDrivers.length} drivers take shared rides`);
}

// Background: every online driver sends a fix every FIX_EVERY_MS ------------------------------
let running = true;
const locationLoops = drivers.map(async (d, i) => {
  await sleep((i / drivers.length) * FIX_EVERY_MS);
  while (running) {
    d.pos = around(d.pos, 60);
    await call('driver/location', 'POST', '/driver/location', d.token, {
      ...d.pos,
      accuracy: 8,
      speed: 7,
      heading: 90,
    });
    await sleep(FIX_EVERY_MS);
  }
});

// Offers reach drivers like the app's stream does (the Redis channel the API relays) ----------
const sub = new Redis(process.env.LOAD_REDIS ?? 'redis://localhost:6394/10');
const rideWaiters = new Map();
/** rideId -> when its order was answered; the first offer.new of the ride is timed from it. */
const offerWaiters = new Map();
const offerMs = [];
const offerMsShared = [];
/** Orders that agreed to share (timed separately). */
const sharedRides = new Set();
await sub.subscribe('taxi:realtime');
sub.on('message', (_c, raw) => {
  const m = JSON.parse(raw);
  const e = m.event;
  if (e.type === 'offer.new' && offerWaiters.has(e.rideId)) {
    const ms = performance.now() - offerWaiters.get(e.rideId);
    (sharedRides.has(e.rideId) ? offerMsShared : offerMs).push(ms);
    offerWaiters.delete(e.rideId);
  }
  if (e.type === 'offer.new') {
    const d = driverById.get(e.driverId);
    if (WAVE4) {
      // a car taking shared rides hears offers on its way while carrying riders
      if (d && !d.reading && (!d.busy || d.pool)) void acceptOnTheWay(d, e.offerId);
    } else if (d && !d.busy) void acceptAndDrive(d, e.offerId);
  }
  if (e.type === 'ride.updated' && e.status === 'driver_assigned') {
    rideWaiters.get(e.rideId)?.();
  }
});

/** rideId -> start code (from the rider's view) and the rider's token. */
const pins = new Map();
const riderOfRide = new Map();
/** The start code the rider tells the driver (the rider's view shows it). */
async function startPin(rideId) {
  if (!pins.has(rideId) && riderOfRide.has(rideId)) {
    const view = await call(null, 'GET', `/rides/${rideId}`, riderOfRide.get(rideId));
    if (view.body?.startPin) pins.set(rideId, view.body.startPin);
  }
  return pins.get(rideId) ?? null;
}

async function acceptAndDrive(d, offerId) {
  d.busy = true;
  await sleep(1500 + Math.random() * 2000); // the driver reads the offer
  const res = await call(
    'driver/offers/:id/accept',
    'POST',
    `/driver/offers/${offerId}/accept`,
    d.token,
  );
  if (res.status !== 200) {
    d.busy = false;
    return;
  }
  const rideId = res.body.id;
  for (const stepName of ['arrive', 'start', 'complete']) {
    await sleep(1000);
    // rides at night (and shared, women-only, intercity) start with the rider's code
    const body =
      stepName === 'start' && res.body.hasStartPin ? { pin: await startPin(rideId) } : undefined;
    await call(
      `driver/rides/:id/${stepName}`,
      'POST',
      `/driver/rides/${rideId}/${stepName}`,
      d.token,
      body,
    );
  }
  d.busy = false;
}

let joins = 0;
let alongAccepts = 0;
const recordAs = (name, res) => {
  record(name, res.ms, res.status > 0 && (res.status < 400 || res.status === 409));
  const s = stats.get(name);
  s.codes[res.status] = (s.codes[res.status] ?? 0) + 1;
};

async function acceptOnTheWay(d, offerId) {
  d.reading = true;
  // the app fetches its offers when the stream says there is one
  const list = await call('driver/offers', 'GET', '/driver/offers', d.token);
  const offer = Array.isArray(list.body) ? list.body.find((o) => o.id === offerId) : null;
  await sleep(1500 + Math.random() * 2000); // the driver reads the offer
  const res = await call(null, 'POST', `/driver/offers/${offerId}/accept`, d.token);
  d.reading = false;
  const joined = res.status === 200 && res.body?.pool != null;
  if (joined) joins++;
  if (offer?.along) alongAccepts++;
  recordAs(
    joined
      ? 'driver/offers/:id/accept (join)'
      : offer?.along
        ? 'driver/offers/:id/accept (along)'
        : 'driver/offers/:id/accept',
    res,
  );
  if (res.status === 200 && !d.driving) void drive(d);
}

/** Follows the car's stops: the current ride is always the next stop's. */
async function drive(d) {
  d.driving = true;
  d.busy = true;
  const startedAt = new Map();
  let failures = 0;
  while (failures < 5) {
    const cur = await call('driver/rides/current', 'GET', '/driver/rides/current', d.token);
    if (cur.body?.ride?.pool) recordAs('driver/rides/current (pool stops)', cur);
    const r = cur.body?.ride;
    if (cur.status !== 200 || !r?.id) break;
    let step;
    if (r.status === 'driver_assigned') {
      await sleep(1000);
      step = await call('driver/rides/:id/arrive', 'POST', `/driver/rides/${r.id}/arrive`, d.token);
    } else if (r.status === 'driver_arrived') {
      await sleep(1000);
      const pin = r.hasStartPin ? await startPin(r.id) : null;
      step = await call('driver/rides/:id/start', 'POST', `/driver/rides/${r.id}/start`, d.token, {
        pin,
      });
      startedAt.set(r.id, Date.now());
    } else if (r.status === 'in_progress') {
      const since = startedAt.get(r.id) ?? Date.now();
      startedAt.set(r.id, since);
      const left = TRIP_MS - (Date.now() - since);
      if (left > 0) {
        await sleep(Math.min(2000, left)); // the app refreshes the stops on the way
        continue;
      }
      step = await call(
        'driver/rides/:id/complete',
        'POST',
        `/driver/rides/${r.id}/complete`,
        d.token,
      );
    } else {
      await sleep(1000);
      continue;
    }
    failures = step.status === 200 ? 0 : failures + 1;
  }
  d.driving = false;
  d.busy = false;
}

let riderIndex = 0;
const nextRider = () => riders[riderIndex++ % riders.length];

// Phase 1: quotes --------------------------------------------------------------------------
await phase('quote', 20, PHASE_S, async () => {
  const r = nextRider();
  await call('rides/quote', 'POST', '/rides/quote', r.token, {
    pickup: around(CENTER, 3000),
    dropoff: around(CENTER, 6000),
  });
});

// Phase 2: operators' views, alone --------------------------------------------------------------
await phase('admin live map', 5, PHASE_S, () =>
  call('admin/dispatch/live', 'GET', '/admin/dispatch/live', admin),
);
const listVariants = [
  () => '/admin/rides?status=open',
  () => '/admin/rides?status=all',
  () => '/admin/rides?status=completed&from=2026-08-01&to=2026-08-31',
  () => `/admin/rides?status=all&driverId=${someDriverIds[Math.floor(Math.random() * 50)]}`,
  () => `/admin/rides?status=all&q=${String(Math.floor(Math.random() * 9000) + 1000)}`,
];
for (const [i, v] of listVariants.entries()) {
  const name = ['open', 'all', 'completed+days', 'by driver', 'phone search'][i];
  await phase(`admin rides (${name})`, 5, Math.max(8, PHASE_S / 2), () =>
    call(`admin/rides ${name}`, 'GET', v(), admin),
  );
}
await phase('admin drivers', 3, Math.max(8, PHASE_S / 2), () =>
  call('admin/drivers', 'GET', '/admin/drivers', admin),
);

// Phase 3: the order + dispatch cycle with operators watching ------------------------------------
const cycleMs = [];
const cycleMsShared = [];
const ticksAtCycle = await tickHistogram();
let missed = 0;
const until = Date.now() + CYCLE_S * 1000;
const watchers = [
  (async () => {
    while (Date.now() < until) {
      await Promise.all([
        call('admin/dispatch/live (busy)', 'GET', '/admin/dispatch/live', admin),
        call('admin/dispatch/live (busy)', 'GET', '/admin/dispatch/live', admin),
        call('admin/dispatch/live (busy)', 'GET', '/admin/dispatch/live', admin),
      ]);
      await sleep(2000);
    }
  })(),
  (async () => {
    while (Date.now() < until) {
      await call('admin/rides open (busy)', 'GET', '/admin/rides?status=open', admin);
      await sleep(3000);
    }
  })(),
];
let orders = 0;
await Promise.all([
  ...watchers,
  ...Array.from({ length: RIDER_FLOWS }, async () => {
    while (Date.now() < until) {
      const r = nextRider();
      const pickup = around(CENTER, 4000);
      // riders who share mostly go the same way (towards the station, ~4 km east)
      const shareable = WAVE4 && Math.random() < SHAREABLE;
      const q = await call('rides/quote (busy)', 'POST', '/rides/quote', r.token, {
        pickup,
        dropoff: shareable ? around(STATION, 2000) : around(CENTER, 7000),
      });
      if (q.status !== 200) continue;
      let done;
      const assignedAt = new Promise((resolve) => (done = resolve));
      const womenOnly = WAVE4 && r.female && Math.random() < WOMEN_ONLY * 2;
      const o = await call('rides (order)', 'POST', '/rides', r.token, {
        quoteId: q.body.quoteId,
        class: 'economy',
        ...(WAVE4 ? { shareable, womenOnly } : {}),
        pickup: { address: 'Guliston', landmark: null },
        dropoff: { address: 'Guliston', landmark: null },
        clientRequestId: randomUUID(),
      });
      if (o.status !== 201) continue;
      orders++;
      // measured from the order's answer to the rider hearing "driver assigned"
      const started = performance.now();
      if (shareable) sharedRides.add(o.body.id);
      riderOfRide.set(o.body.id, r.token);
      offerWaiters.set(o.body.id, started);
      rideWaiters.set(o.body.id, () => done(performance.now() - started));
      const ms = await Promise.race([assignedAt, sleep(45_000).then(() => null)]);
      rideWaiters.delete(o.body.id);
      if (ms === null) missed++;
      else (shareable ? cycleMsShared : cycleMs).push(ms);
      // the rider app shows the ride once
      const view = await call('rides/:id', 'GET', `/rides/${o.body.id}`, r.token);
      if (view.body?.startPin) pins.set(o.body.id, view.body.startPin);
      await sleep(2000);
    }
  }),
]);
const ticksAtEnd = await tickHistogram();
running = false;
await Promise.all(locationLoops);
await sub.quit();

// Report --------------------------------------------------------------------------------------
const rows = [...stats.entries()].map(([name, s]) => ({
  endpoint: name,
  n: s.lat.length,
  p50: Math.round(pct(s.lat, 50)),
  p95: Math.round(pct(s.lat, 95)),
  p99: Math.round(pct(s.lat, 99)),
  errors: s.errors,
  codes: s.codes,
}));
rows.push({
  endpoint: 'order → first offer (dispatch)',
  n: offerMs.length,
  p50: Math.round(pct(offerMs, 50) ?? 0),
  p95: Math.round(pct(offerMs, 95) ?? 0),
  p99: Math.round(pct(offerMs, 99) ?? 0),
  errors: 0,
  codes: {},
});
rows.push({
  endpoint: 'order → driver assigned (incl. ~2.5 s the driver reads the offer)',
  n: cycleMs.length,
  p50: Math.round(pct(cycleMs, 50) ?? 0),
  p95: Math.round(pct(cycleMs, 95) ?? 0),
  p99: Math.round(pct(cycleMs, 99) ?? 0),
  errors: missed,
  codes: { orders },
});
if (WAVE4) {
  rows.push({
    endpoint: 'order → first offer (shareable)',
    n: offerMsShared.length,
    p50: Math.round(pct(offerMsShared, 50) ?? 0),
    p95: Math.round(pct(offerMsShared, 95) ?? 0),
    p99: Math.round(pct(offerMsShared, 99) ?? 0),
    errors: 0,
    codes: {},
  });
  rows.push({
    endpoint: 'order → driver assigned (shareable)',
    n: cycleMsShared.length,
    p50: Math.round(pct(cycleMsShared, 50) ?? 0),
    p95: Math.round(pct(cycleMsShared, 95) ?? 0),
    p99: Math.round(pct(cycleMsShared, 99) ?? 0),
    errors: 0,
    codes: { joins, alongAccepts },
  });
}
for (const [label, t] of [
  ['dispatch tick (whole run)', tickSummary(ticksAtStart, ticksAtEnd)],
  ['dispatch tick (order cycle)', tickSummary(ticksAtCycle, ticksAtEnd)],
]) {
  if (!t) continue;
  rows.push({
    endpoint: label,
    n: t.n,
    p50: Math.round(t.p50),
    p95: Math.round(t.p95),
    p99: Math.round(t.p99),
    errors: 0,
    codes: { meanMs: Math.round(t.mean) },
  });
}
console.table(rows.map(({ codes, ...r }) => ({ ...r, codes: JSON.stringify(codes) })));
console.log(JSON.stringify(rows));
agent.destroy();
