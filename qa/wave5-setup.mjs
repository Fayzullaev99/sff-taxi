/* global process, console, fetch, setTimeout, Buffer */
/**
 * Wave-5 emulator QA helpers against a RUNNING dev API + worker (not the test harness).
 * Accounts sign in with fixed OTP codes (OTP_FIXED_CODES on the API): +998900000001
 * (operator) and +9989770001xx : 111111.
 *
 *   QA_API=http://localhost:3200 node qa/wave5-setup.mjs setup
 *     enables the Miniven and Biznes classes, creates and approves API-driven drivers
 *     (+998977000113 minivan, +998977000114 business), tops them up and puts them online.
 *   node qa/wave5-setup.mjs serve +998977000113 [--stop-wait=20] [--pickup-wait=10]
 *     a driver bot: accepts offers, arrives, starts, visits the stops, completes.
 *   node qa/wave5-setup.mjs token +998977000102 rider
 *     prints an access token for curl.
 *   node qa/wave5-setup.mjs geo emulator-5554 40.4960 68.7759 [40.4995 68.7840 30]
 *     sets the emulator's GPS, or walks it to a target at a speed (km/h) with a fix every 2 s.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const API = process.env.QA_API ?? 'http://localhost:3200';
const CODE = '111111';
export const GULISTON = { lat: 40.49598, lng: 68.77587 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);
const ADB = `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;

async function call(token, method, path, body) {
  const res = await fetch(`${API}/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
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
const DOCUMENTS = [
  'licence_card',
  'driver_licence',
  'passport',
  'vehicle_registration',
  'insurance',
  'vehicle_photo',
  'selfie',
];

/** A driver with the given car, approved and topped up; online at `at`. */
async function driver(admin, phone, at, { fullName, vehicle, topup = 50_000 }) {
  const token = await signIn(phone, 'driver');
  const me = await call(token, 'GET', '/driver/me');
  let id = me.body?.id;
  if (me.status !== 200 || me.body.status !== 'active') {
    const applied = await call(token, 'POST', '/driver/application', {
      fullName,
      birthDate: '1988-04-12',
      pinfl: `3${digits(13)}`,
      licenceNumber: `A${letter()}${digits(7)}`,
      licenceCategories: ['B'],
      licenceIssuedOn: '2010-03-01',
      licenceCardNumber: `LK-${digits(8)}`,
      licenceCardExpiresOn: '2030-01-01',
      vehicle: {
        colour: 'qora',
        plate: `20 ${letter()} ${digits(3)} ${letter()}${letter()}`,
        features: ['ac'],
        ...vehicle,
      },
    });
    if (applied.status !== 200) throw new Error(`apply ${phone}: ${JSON.stringify(applied.body)}`);
    id = applied.body.id;
    for (const kind of DOCUMENTS) {
      await call(token, 'PUT', `/driver/documents/${kind}`, {
        url: `https://files.example.uz/${id}/${kind}.jpg`,
      });
    }
    await call(admin, 'POST', `/admin/drivers/${id}/licence`, {
      result: 'valid',
      note: 'QA: reyestrda tekshirildi',
    });
    const ok = await call(admin, 'POST', `/admin/drivers/${id}/approve`, {});
    if (ok.status !== 200) throw new Error(`approve ${phone}: ${JSON.stringify(ok.body)}`);
    if (topup) {
      await call(admin, 'POST', `/admin/billing/drivers/${id}/ledger`, {
        kind: 'topup',
        amount: topup,
      });
    }
  }
  await call(token, 'PUT', '/driver/preferences', {
    poolEnabled: false,
    extraPassengers: 0,
    destination: null,
  });
  await call(token, 'POST', '/driver/shift', { online: true });
  const loc = await call(token, 'POST', '/driver/location', { ...at, accuracy: 8 });
  console.log(`driver ${phone} (${fullName}) ${loc.status === 204 ? 'online' : 'location failed'}`);
  return { token, id };
}

async function setup() {
  const admin = await signIn('+998900000001', 'admin');
  const tariff = await call(admin, 'GET', '/admin/settings/tariff');
  if (tariff.status !== 200) throw new Error(`tariff: ${JSON.stringify(tariff.body)}`);
  const classes = tariff.body.classes;
  classes.minivan.enabled = true;
  classes.business.enabled = true;
  const saved = await call(admin, 'PUT', '/admin/settings/tariff', { ...tariff.body, classes });
  console.log(
    `classes: ${saved.status === 200 ? 'minivan and business enabled' : JSON.stringify(saved.body)}`,
  );
  await driver(
    admin,
    '+998977000113',
    { lat: 40.4975, lng: 68.779 },
    {
      fullName: 'Rahimov Jasur Olimovich',
      vehicle: {
        make: 'Hyundai',
        model: 'Starex',
        year: 2022,
        seats: 7,
        class: 'minivan',
        body: 'minivan',
      },
    },
  );
  await driver(
    admin,
    '+998977000114',
    { lat: 40.4945, lng: 68.773 },
    {
      fullName: 'Karimov Bekzod Anvarovich',
      vehicle: {
        make: 'Chevrolet',
        model: 'Malibu',
        year: 2024,
        seats: 4,
        class: 'business',
        body: 'sedan',
      },
    },
  );
  console.log('setup done');
}

/** The driver bot: one ride at a time, every step after a short wait. */
async function serve(phone, opts) {
  let token = await signIn(phone, 'driver');
  await call(token, 'POST', '/driver/shift', { online: true });
  // access tokens live 15 minutes: sign in again when one expires
  const callAuth = async (method, path, body) => {
    const r = await call(token, method, path, body);
    if (r.status !== 401) return r;
    token = await signIn(phone, 'driver');
    return call(token, method, path, body);
  };
  const pickupWait = Number(opts.get('pickup-wait') ?? 8) * 1000;
  const stopWait = Number(opts.get('stop-wait') ?? 15) * 1000;
  const tripWait = Number(opts.get('trip-wait') ?? 20) * 1000;
  const [atLat, atLng] = (opts.get('at') ?? `${GULISTON.lat},${GULISTON.lng}`)
    .split(',')
    .map(Number);
  let locatedAt = 0;
  console.log(`bot ${phone}: waiting for offers (ctrl-c to stop)`);
  for (;;) {
    // a fresh position every 10 s: dispatch and availability skip a car that went quiet
    if (Date.now() - locatedAt > 10_000) {
      await callAuth('POST', '/driver/location', { lat: atLat, lng: atLng, accuracy: 8 });
      locatedAt = Date.now();
    }
    const current = await callAuth('GET', '/driver/rides/current');
    const ride = current.body?.ride ?? current.body;
    if (ride && ride.id) {
      console.log(`ride #${ride.number} ${ride.status} stops=${(ride.stops ?? []).length}`);
      if (ride.status === 'driver_assigned') {
        await sleep(pickupWait);
        const r = await callAuth('POST', `/driver/rides/${ride.id}/arrive`);
        console.log(`  arrive ${r.status}`);
      } else if (ride.status === 'driver_arrived') {
        await sleep(pickupWait);
        const pin = opts.get('pin');
        const r = await callAuth('POST', `/driver/rides/${ride.id}/start`, pin ? { pin } : {});
        console.log(`  start ${r.status} ${r.status !== 200 ? JSON.stringify(r.body) : ''}`);
        if (r.status !== 200) await sleep(10_000);
      } else if (ride.status === 'in_progress') {
        const stops = ride.stops ?? [];
        const lastArrived = stops.reduce((last, s, i) => (s.arrivedAt ? i : last), -1);
        const open = lastArrived >= 0 && !stops[lastArrived].leftAt ? lastArrived : -1;
        if (open >= 0) {
          await sleep(stopWait);
          const r = await callAuth('POST', `/driver/rides/${ride.id}/stops/${open}/leave`);
          console.log(`  leave stop ${open + 1}: ${r.status}`);
        } else if (lastArrived + 1 < stops.length) {
          await sleep(tripWait / 2);
          const i = lastArrived + 1;
          const r = await callAuth('POST', `/driver/rides/${ride.id}/stops/${i}/arrive`);
          console.log(`  arrive stop ${i + 1}: ${r.status}`);
        } else {
          await sleep(tripWait);
          const r = await callAuth('POST', `/driver/rides/${ride.id}/complete`);
          console.log(
            `  complete ${r.status} total=${r.body?.fare?.total} cash=${r.body?.collectCash}`,
          );
        }
      } else {
        await sleep(2000);
      }
      continue;
    }
    const offers = await callAuth('GET', '/driver/offers');
    const offer = (offers.body ?? [])[0];
    if (offer) {
      const a = await callAuth('POST', `/driver/offers/${offer.id}/accept`);
      console.log(`offer for #${offer.ride?.number}: accept ${a.status}`);
      continue;
    }
    await sleep(1500);
  }
}

/** Walks the emulator's GPS towards a target (or just sets it). */
async function geo(serial, lat, lng, toLat, toLng, kmh = 30) {
  let cur = { lat, lng };
  const fix = async (p) => {
    await run(ADB, ['-s', serial, 'emu', 'geo', 'fix', String(p.lng), String(p.lat)]);
  };
  await fix(cur);
  if (toLat === undefined) return;
  const target = { lat: toLat, lng: toLng };
  const stepM = (kmh / 3.6) * 2;
  for (;;) {
    const dLat = target.lat - cur.lat;
    const dLng = target.lng - cur.lng;
    const m = Math.hypot(dLat * 111_320, dLng * 111_320 * Math.cos((cur.lat * Math.PI) / 180));
    if (m <= stepM) {
      await fix(target);
      console.log('arrived');
      return;
    }
    const f = stepM / m;
    cur = { lat: cur.lat + dLat * f, lng: cur.lng + dLng * f };
    await fix(cur);
    process.stdout.write(`${Math.round(m)} m left\r`);
    await sleep(2000);
  }
}

/** Pays a payment intent the way Payme does (Create + Perform), PAYME_KEY as on the API. */
async function pay(intentId, amount, key = process.env.PAYME_KEY ?? 'test-payme-merchant-key') {
  const rpc = async (method, params) => {
    const res = await fetch(`${API}/v1/payments/payme`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`Paycom:${key}`).toString('base64')}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method, params }),
    });
    return res.json();
  };
  const id = `pm-${Date.now()}`;
  const created = await rpc('CreateTransaction', {
    id,
    time: Date.now(),
    amount: amount * 100,
    account: { order_id: intentId },
  });
  console.log('create', JSON.stringify(created.result ?? created.error));
  const performed = await rpc('PerformTransaction', { id });
  console.log('perform', JSON.stringify(performed.result ?? performed.error));
}

const [cmd, ...rest] = process.argv.slice(2);
const opts = new Map();
const positional = [];
for (const a of rest) {
  const m = /^--([\w-]+)(?:=(.*))?$/.exec(a);
  if (m) opts.set(m[1], m[2] ?? 'true');
  else positional.push(a);
}
if (cmd === 'setup') await setup();
else if (cmd === 'serve') await serve(positional[0], opts);
else if (cmd === 'token') console.log(await signIn(positional[0], positional[1] ?? 'rider'));
else if (cmd === 'pay') await pay(positional[0], Number(positional[1]));
else if (cmd === 'geo')
  await geo(
    positional[0],
    Number(positional[1]),
    Number(positional[2]),
    positional[3] === undefined ? undefined : Number(positional[3]),
    positional[4] === undefined ? undefined : Number(positional[4]),
    positional[5] === undefined ? 30 : Number(positional[5]),
  );
else {
  console.log(
    'usage: setup | serve <phone> | token <phone> [client] | geo <serial> <lat> <lng> [toLat toLng kmh]',
  );
  process.exit(1);
}
