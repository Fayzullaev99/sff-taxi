/* global process, URL, performance, Buffer, setTimeout, console */
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
await db.end();

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
await sub.subscribe('taxi:realtime');
sub.on('message', (_c, raw) => {
  const m = JSON.parse(raw);
  const e = m.event;
  if (e.type === 'offer.new' && offerWaiters.has(e.rideId)) {
    offerMs.push(performance.now() - offerWaiters.get(e.rideId));
    offerWaiters.delete(e.rideId);
  }
  if (e.type === 'offer.new') {
    const d = driverById.get(e.driverId);
    if (d && !d.busy) void acceptAndDrive(d, e.offerId);
  }
  if (e.type === 'ride.updated' && e.status === 'driver_assigned') {
    rideWaiters.get(e.rideId)?.();
  }
});

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
    await call(
      `driver/rides/:id/${stepName}`,
      'POST',
      `/driver/rides/${rideId}/${stepName}`,
      d.token,
    );
  }
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
      const q = await call('rides/quote (busy)', 'POST', '/rides/quote', r.token, {
        pickup,
        dropoff: around(CENTER, 7000),
      });
      if (q.status !== 200) continue;
      let done;
      const assignedAt = new Promise((resolve) => (done = resolve));
      const o = await call('rides (order)', 'POST', '/rides', r.token, {
        quoteId: q.body.quoteId,
        class: 'economy',
        pickup: { address: 'Guliston', landmark: null },
        dropoff: { address: 'Guliston', landmark: null },
        clientRequestId: randomUUID(),
      });
      if (o.status !== 201) continue;
      orders++;
      // measured from the order's answer to the rider hearing "driver assigned"
      const started = performance.now();
      offerWaiters.set(o.body.id, started);
      rideWaiters.set(o.body.id, () => done(performance.now() - started));
      const ms = await Promise.race([assignedAt, sleep(45_000).then(() => null)]);
      rideWaiters.delete(o.body.id);
      if (ms === null) missed++;
      else cycleMs.push(ms);
      // the rider app shows the ride once
      await call('rides/:id', 'GET', `/rides/${o.body.id}`, r.token);
      await sleep(2000);
    }
  }),
]);
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
console.table(rows.map(({ codes, ...r }) => ({ ...r, codes: JSON.stringify(codes) })));
console.log(JSON.stringify(rows));
agent.destroy();
