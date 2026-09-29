/* global process, console, fetch, setTimeout, performance */
/**
 * Wave-4 end-to-end smoke test against a RUNNING dev API + worker (not the test harness):
 * sign-in, driver approval, a shared ride with a second rider joining on the way, the
 * start codes, completion with the split price, a women-only ride, a fixed route seat,
 * the seating rule. Accounts sign in with fixed OTP codes (OTP_FIXED_CODES on the API):
 * +998900000001 (operator) and +99897700000x / +9989770000xx : 111111.
 *
 *   QA_API=http://localhost:3200 node qa/wave4-smoke.mjs
 */
import { randomUUID } from 'node:crypto';

const API = process.env.QA_API ?? 'http://localhost:3200';
const CODE = '111111';
const GULISTON = { lat: 40.49598, lng: 68.77587 };
const east = (m) => ({
  lat: GULISTON.lat,
  lng: GULISTON.lng + m / (111_320 * Math.cos((GULISTON.lat * Math.PI) / 180)),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const timings = [];

function check(ok, what, detail) {
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${what}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures++;
}

async function call(token, method, path, body) {
  const t0 = performance.now();
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  timings.push({
    name: `${method} ${path.replace(/[0-9a-f-]{36}/g, ':id')}`,
    ms: performance.now() - t0,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, body: json };
}

async function signIn(phone, client) {
  await call(null, 'POST', '/auth/code', { phone });
  const r = await call(null, 'POST', '/auth/verify', { phone, code: CODE, client });
  if (r.status !== 200) throw new Error(`sign-in ${phone}: ${JSON.stringify(r.body)}`);
  return r.body.accessToken;
}

const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const L = 'ABCDEFGHJKLMNPRSTUVXYZ';
const letter = () => L[Math.floor(Math.random() * L.length)];

async function driver(admin, phone, at, extra = {}) {
  const token = await signIn(phone, 'driver');
  const me = await call(token, 'GET', '/driver/me');
  let id = me.body?.id;
  if (me.status !== 200 || me.body.status !== 'active') {
    const applied = await call(token, 'POST', '/driver/application', {
      fullName: extra.fullName ?? 'Sinov Haydovchi',
      birthDate: '1990-05-01',
      pinfl: `3${digits(13)}`,
      licenceNumber: `A${letter()}${digits(7)}`,
      licenceCategories: ['B'],
      licenceIssuedOn: '2012-03-01',
      licenceCardNumber: `LK-${digits(8)}`,
      licenceCardExpiresOn: '2030-01-01',
      ...(extra.gender ? { gender: extra.gender } : {}),
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
    });
    if (applied.status !== 200) throw new Error(`apply: ${JSON.stringify(applied.body)}`);
    id = applied.body.id;
    for (const kind of [
      'licence_card',
      'driver_licence',
      'passport',
      'vehicle_registration',
      'insurance',
      'vehicle_photo',
      'selfie',
    ]) {
      await call(token, 'PUT', `/driver/documents/${kind}`, {
        url: `https://files.example.uz/${id}/${kind}.jpg`,
      });
    }
    await call(admin, 'POST', `/admin/drivers/${id}/licence`, {
      result: 'valid',
      note: 'QA: reyestrda tekshirildi',
    });
    const ok = await call(admin, 'POST', `/admin/drivers/${id}/approve`, {});
    if (ok.status !== 200) throw new Error(`approve: ${JSON.stringify(ok.body)}`);
  }
  if (extra.gender)
    await call(admin, 'POST', `/admin/drivers/${id}/gender`, { gender: extra.gender });
  await call(token, 'PUT', '/driver/preferences', {
    poolEnabled: false,
    extraPassengers: 0,
    destination: null,
    ...(extra.prefs ?? {}),
  });
  await call(token, 'POST', '/driver/shift', { online: true });
  const loc = await call(token, 'POST', '/driver/location', { ...at, accuracy: 8 });
  check(
    loc.status === 204,
    `driver ${phone} online at ${at.lat.toFixed(4)},${at.lng.toFixed(4)}`,
    loc.body,
  );
  return { token, id };
}

async function waitOffer(d, rideId, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const r = await call(d.token, 'GET', '/driver/offers');
    const o = (r.body ?? []).find((x) => x.ride.id === rideId);
    if (o) return o;
    await sleep(500);
  }
  return null;
}

async function order(token, pickup, dropoff, extra = {}) {
  const q = await call(token, 'POST', '/rides/quote', { pickup, dropoff, options: [] });
  if (q.status !== 200) throw new Error(`quote: ${JSON.stringify(q.body)}`);
  const r = await call(token, 'POST', '/rides', {
    quoteId: q.body.quoteId,
    class: 'economy',
    pickup: { address: 'QA olib ketish', landmark: null },
    dropoff: { address: 'QA manzil', landmark: null },
    clientRequestId: randomUUID(),
    ...extra,
  });
  return { quote: q.body, ride: r.body, status: r.status };
}

async function drive(d, riderToken, rideId) {
  await call(d.token, 'POST', `/driver/rides/${rideId}/arrive`);
  const pin = (await call(riderToken, 'GET', `/rides/${rideId}`)).body.startPin;
  const s = await call(d.token, 'POST', `/driver/rides/${rideId}/start`, { pin });
  check(s.status === 200, `ride started with the rider's code (${pin ?? 'no code'})`, s.body);
}

async function main() {
  const admin = await signIn('+998900000001', 'admin');
  // clear leftovers of earlier runs: every QA account off shift, open rides cancelled
  const open = await call(admin, 'GET', '/admin/rides?status=open');
  const openRides = Array.isArray(open.body) ? open.body : (open.body?.items ?? []);
  if (open.status !== 200)
    console.log('open rides:', open.status, JSON.stringify(open.body).slice(0, 200));
  for (const r of openRides) {
    if (String(r.riderPhone).startsWith('+99897700')) {
      await call(admin, 'POST', `/admin/rides/${r.id}/cancel`, { reason: 'QA tozalash' });
    }
  }

  // 1. shared ride ------------------------------------------------------------------------
  const d1 = await driver(admin, '+998977000011', GULISTON, { prefs: { poolEnabled: true } });
  const riderA = await signIn('+998977000001', 'rider');
  const riderB = await signIn('+998977000002', 'rider');
  const a = await order(riderA, GULISTON, east(6000), { shareable: true });
  check(
    a.status === 201 && a.ride.shareable && a.ride.hasStartPin,
    'A orders a shared ride (start code set)',
    a.ride,
  );
  const offerA = await waitOffer(d1, a.ride.id);
  check(Boolean(offerA), 'the worker offers A to the pool driver');
  if (!offerA) return;
  const accA = await call(d1.token, 'POST', `/driver/offers/${offerA.id}/accept`);
  check(accA.status === 200, 'driver accepts A', accA.body);
  const accAgain = await call(d1.token, 'POST', `/driver/offers/${offerA.id}/accept`);
  check(accAgain.status === 200, 'a repeated accept (lost answer) is safe', accAgain.body);
  await drive(d1, riderA, a.ride.id);

  const qB = await call(riderB, 'POST', '/rides/quote', {
    pickup: east(3000),
    dropoff: east(6000),
    options: [],
  });
  check(qB.body.pool?.cars?.length >= 1, 'B sees the car on its way before ordering', qB.body.pool);
  if (qB.body.pool?.cars?.[0]) {
    const c = qB.body.pool.cars[0];
    console.log(
      `      car: ${c.inCar} in the car, ${c.free} free (front ${c.front}, rear ${c.rear}), ~${Math.round(c.etaS / 60)} min`,
    );
  }
  const b = await order(riderB, east(3000), east(6000), { shareable: true });
  const offerB = await waitOffer(d1, b.ride.id);
  check(
    Boolean(offerB?.along),
    'the worker offers B to the car already carrying A (along)',
    offerB,
  );
  if (!offerB) return;
  const accB = await call(d1.token, 'POST', `/driver/offers/${offerB.id}/accept`);
  check(accB.status === 200, 'driver takes B on the way', accB.body);
  const vA = (await call(riderA, 'GET', `/rides/${a.ride.id}`)).body;
  const vB = (await call(riderB, 'GET', `/rides/${b.ride.id}`)).body;
  console.log(
    `      A: ${vA.fare.quoted} -> ${vA.fare.pays}; B: ${vB.fare.quoted} -> ${vB.fare.pays}`,
  );
  check(vA.fare.poolDiscount > 0 && vB.fare.poolDiscount > 0, 'both riders pay less', {
    a: vA.fare,
    b: vB.fare,
  });
  const cur = (await call(d1.token, 'GET', '/driver/rides/current')).body.ride;
  check(
    cur?.pool?.stops?.[0]?.type === 'pickup' && cur.id === b.ride.id,
    'driver: next stop is B’s pickup',
    cur?.pool,
  );
  await drive(d1, riderB, b.ride.id);
  const doneA = await call(d1.token, 'POST', `/driver/rides/${a.ride.id}/complete`);
  const doneB = await call(d1.token, 'POST', `/driver/rides/${b.ride.id}/complete`);
  check(
    doneA.body.fare.total === vA.fare.pays && doneB.body.fare.total === vB.fare.pays,
    'completed at the shared prices',
    { a: doneA.body.fare, b: doneB.body.fare },
  );
  check(
    doneA.body.fare.total + doneB.body.fare.total > vA.fare.quoted,
    'the driver earns more than from A alone',
  );

  // 2. the seating rule -------------------------------------------------------------------
  const riderC = await signIn('+998977000003', 'rider');
  const four = await order(riderC, GULISTON, east(2000), { passengers: 4 });
  check(four.status === 400, 'four people are refused (1 front + at most 2 rear)', four.ride);

  // 3. a woman driver ---------------------------------------------------------------------
  await call(d1.token, 'POST', '/driver/shift', { online: false });
  const w = await driver(admin, '+998977000012', east(800), {
    gender: 'female',
    fullName: 'Sinov Haydovchi Ayol',
  });
  const me = await call(riderC, 'PATCH', '/me', { gender: 'female' });
  check(me.status === 200 || me.status === 409, 'rider declares gender', me.body);
  const wq = await order(riderC, GULISTON, east(2500), { womenOnly: true });
  check(wq.status === 201 && wq.quote.womenOnly?.available, 'women-only ride ordered', wq.ride);
  const wo = await waitOffer(w, wq.ride.id);
  check(Boolean(wo), 'offered to the verified woman driver');
  await call(riderC, 'POST', `/rides/${wq.ride.id}/cancel`, {});
  await call(w.token, 'POST', '/driver/shift', { online: false });

  // 4. a fixed route seat -----------------------------------------------------------------
  const yq = await order(riderC, { lat: 40.2700751, lng: 68.8165984 }, GULISTON, {
    fareMode: 'seat',
    passengers: 2,
  });
  check(
    yq.status === 201 && yq.ride.fare.quoted === 2 * (yq.quote.route?.prices?.economy?.seat ?? 0),
    `Yangiyer → Guliston seat x2 = ${yq.ride.fare?.quoted}`,
    yq.ride,
  );
  await call(riderC, 'POST', `/rides/${yq.ride.id}/cancel`, {});

  // latency summary
  const by = new Map();
  for (const t of timings) by.set(t.name, [...(by.get(t.name) ?? []), t.ms]);
  console.log('\nlatency (ms)  p50 / max');
  for (const [name, ms] of [...by].sort()) {
    ms.sort((x, y) => x - y);
    console.log(
      `  ${name.padEnd(42)} ${Math.round(ms[Math.floor(ms.length / 2)])} / ${Math.round(ms.at(-1))}`,
    );
  }
}

await main().catch((e) => {
  console.error(e);
  failures++;
});
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
