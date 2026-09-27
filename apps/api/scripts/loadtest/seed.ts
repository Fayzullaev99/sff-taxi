/**
 * Seeds a THROWAWAY database with realistic volumes for the load test (docs/audit.md "Load
 * test"): drivers and riders in Guliston and months of ride history, in bulk SQL.
 *
 *   DATABASE_MIGRATION_URL=postgres://taxi_owner:…@localhost:5460/taxi_load_x \
 *   LOAD_DRIVERS=2000 LOAD_RIDERS=50000 LOAD_RIDES=500000 \
 *   npx tsx scripts/loadtest/seed.ts
 *
 * Refuses any database whose name does not contain "load". Run the migrations first.
 * Riders' phones are +99893xxxxxxx (index), drivers' +99894xxxxxxx; the operator +998900000001.
 */
import pg from 'pg';
import { DEFAULT_TARIFF } from '../../src/lib/tariff.js';

const url = process.env.DATABASE_MIGRATION_URL ?? '';
if (!/\/[\w]*load[\w]*$/.test(url)) throw new Error('Refusing to seed a database without "load"');
const DRIVERS = Number(process.env.LOAD_DRIVERS ?? 2000);
const RIDERS = Number(process.env.LOAD_RIDERS ?? 50_000);
const RIDES = Number(process.env.LOAD_RIDES ?? 500_000);
const DAYS = 180;

const client = new pg.Client({ connectionString: url });
await client.connect();
const step = async (label: string, text: string, values: unknown[] = []) => {
  const started = Date.now();
  const res = await client.query(text, values);
  console.log(`${label}: ${res.rowCount ?? ''} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
};

// a time-ordered uuid (v7 layout) for a moment in the past, so "newest first by id" holds
await client.query(`
  CREATE OR REPLACE FUNCTION pg_temp.uuid7(ts timestamptz) RETURNS uuid LANGUAGE sql VOLATILE AS $$
    SELECT (lpad(to_hex((extract(epoch FROM ts) * 1000)::bigint), 12, '0') || '7'
      || substr(md5(random()::text), 1, 3) || '8' || substr(md5(random()::text), 1, 15))::uuid
  $$`);
const { rows: cities } = await client.query<{ id: string }>(
  `SELECT id FROM cities WHERE slug = 'guliston'`,
);
const cityId = cities[0]!.id;
const tariff = JSON.stringify(DEFAULT_TARIFF);

await step(
  'riders',
  `INSERT INTO users (id, phone, full_name, created_at)
   SELECT pg_temp.uuid7(now() - interval '200 days' + i * interval '5 minutes'),
          '+99893' || lpad(i::text, 7, '0'), 'Yo‘lovchi ' || i,
          now() - interval '200 days' + i * interval '5 minutes'
   FROM generate_series(1, $1) i`,
  [RIDERS],
);
await step(
  'driver accounts',
  `INSERT INTO users (id, phone, full_name, created_at)
   SELECT pg_temp.uuid7(now() - interval '300 days' + i * interval '1 hour'),
          '+99894' || lpad(i::text, 7, '0'), 'Haydovchi ' || i,
          now() - interval '300 days' + i * interval '1 hour'
   FROM generate_series(1, $1) i`,
  [DRIVERS],
);
await step(
  'drivers',
  `INSERT INTO drivers (user_id, full_name, birth_date, pinfl, licence_number, licence_categories,
     licence_issued_on, licence_card_number, licence_card_expires_on, status, approved_at,
     licence_status, licence_checked_at, lat, lng, located_at, rating_sum, rating_count,
     offers_received, offers_accepted, rides_completed, updated_at)
   SELECT u.id, u.full_name, date '1985-01-01' + (n % 3000), '3' || lpad(n::text, 13, '0'),
          'AA' || lpad(n::text, 7, '0'), '{B}', date '2012-01-01', 'LK-' || lpad(n::text, 8, '0'),
          date '2030-01-01', 'active', now() - interval '100 days', 'valid', now(),
          40.49598 + (random() - 0.5) * 0.07, 68.77587 + (random() - 0.5) * 0.09,
          now() - interval '1 day', 0, 0, 0, 0, 0, now()
   FROM (SELECT id, full_name, row_number() OVER (ORDER BY phone)::int n FROM users
         WHERE phone LIKE '+99894%') u`,
);
await step(
  'vehicles',
  `INSERT INTO vehicles (driver_id, make, model, colour, plate, year, seats, class, features,
     cng_in_trunk, updated_at)
   SELECT d.user_id, 'Chevrolet', (ARRAY['Cobalt', 'Nexia 3', 'Lacetti', 'Spark'])[1 + n % 4],
          (ARRAY['oq', 'qora', 'kulrang'])[1 + n % 3],
          '20' || lpad((n % 1000)::text, 3, '0') || chr(65 + (n / 1000) % 26) || chr(65 + (n / 26000) % 26) || 'A',
          2015 + n % 10, 4, CASE WHEN n % 10 = 0 THEN 'comfort' ELSE 'economy' END,
          CASE WHEN n % 3 = 0 THEN '{ac,big_trunk}'::text[] ELSE '{ac}'::text[] END,
          n % 3 <> 0, now()
   FROM (SELECT user_id, row_number() OVER (ORDER BY pinfl)::int n FROM drivers) d`,
);
await step(
  'top-ups',
  `INSERT INTO driver_ledger (id, driver_id, kind, amount, note, created_at)
   SELECT pg_temp.uuid7(now() - interval '181 days'), user_id, 'topup', 200000, 'Seed', now() - interval '181 days'
   FROM drivers`,
);

// ride history: 85% completed, 15% cancelled, spread over DAYS days, mostly daytime
await client.query(`CREATE TEMP TABLE seed_riders AS
  SELECT id, phone, row_number() OVER (ORDER BY phone) - 1 AS n FROM users WHERE phone LIKE '+99893%'`);
await client.query(`CREATE TEMP TABLE seed_drivers AS
  SELECT d.user_id AS id, d.pinfl, v.make, v.model, v.colour, v.plate, v.class,
         row_number() OVER (ORDER BY d.pinfl) - 1 AS n
  FROM drivers d JOIN vehicles v ON v.driver_id = d.user_id`);
await client.query(`CREATE INDEX ON seed_riders (n); CREATE INDEX ON seed_drivers (n)`);
await step(
  'rides',
  `INSERT INTO rides (id, rider_id, rider_phone, rider_name, channel, created_by, client_request_id,
     city_id, kind, class, pickup, pickup_lat, pickup_lng, dropoff, dropoff_lat, dropoff_lng,
     distance_m, duration_s, fare, tariff, fare_quoted, fare_total, tax, payment_method,
     payment_status, status, driver_id, vehicle, cancelled_by, cancel_reason, requested_at,
     assigned_at, arrived_at, started_at, completed_at, cancelled_at, updated_at)
   SELECT pg_temp.uuid7(t.at), r.id, r.phone, NULL,
          CASE WHEN i % 7 = 0 THEN 'phone' ELSE 'app' END, r.id, gen_random_uuid(), $2, 'city',
          d.class, jsonb_build_object('address', 'Guliston, ' || (i % 300) || '-uy', 'landmark', NULL),
          40.49598 + t.dy1, 68.77587 + t.dx1,
          jsonb_build_object('address', 'Guliston, ' || (i % 211) || '-mavze', 'landmark', NULL),
          40.49598 + t.dy2, 68.77587 + t.dx2, t.m, (t.m / 8.3)::int,
          jsonb_build_object('total', t.fare, 'kind', 'city', 'class', d.class), $3::jsonb,
          t.fare, CASE WHEN t.done THEN t.fare END, CASE WHEN t.done THEN t.fare / 100 ELSE 0 END,
          CASE WHEN i % 20 = 0 THEN 'card' ELSE 'cash' END,
          CASE WHEN t.done THEN 'paid' ELSE 'not_charged' END,
          CASE WHEN t.done THEN 'completed' ELSE 'cancelled' END,
          CASE WHEN t.done OR i % 3 = 0 THEN d.id END,
          CASE WHEN t.done OR i % 3 = 0 THEN jsonb_build_object('make', d.make, 'model', d.model,
            'colour', d.colour, 'plate', d.plate, 'class', d.class) END,
          CASE WHEN t.done THEN NULL ELSE 'rider' END,
          CASE WHEN t.done THEN NULL ELSE 'Fikrimni o‘zgartirdim' END,
          t.at, t.at + interval '40 seconds', t.at + interval '5 minutes', t.at + interval '7 minutes',
          CASE WHEN t.done THEN t.at + interval '20 minutes' END,
          CASE WHEN t.done THEN NULL ELSE t.at + interval '2 minutes' END,
          t.at + interval '20 minutes'
   FROM generate_series(1, $1) i
   CROSS JOIN LATERAL (
     SELECT now() - (random() * $4) * interval '1 day' AS at, i % 100 >= 15 AS done,
            (random() - 0.5) * 0.06 AS dy1, (random() - 0.5) * 0.08 AS dx1,
            (random() - 0.5) * 0.06 AS dy2, (random() - 0.5) * 0.08 AS dx2,
            1000 + (random() * 7000)::int AS m,
            (5000 + round(random() * 80) * 100)::int AS fare
   ) t
   JOIN seed_riders r ON r.n = (i::bigint * 7919) % $5
   JOIN seed_drivers d ON d.n = (i::bigint * 104729) % $6`,
  [RIDES, cityId, tariff, DAYS, RIDERS, DRIVERS],
);
await step(
  'ride events',
  `INSERT INTO ride_events (id, ride_id, type, actor, actor_id, data, created_at)
   SELECT pg_temp.uuid7(e.at), r.id, e.type, e.actor, e.actor_id, e.data, e.at
   FROM rides r CROSS JOIN LATERAL (VALUES
     ('requested', 'rider', r.rider_id, jsonb_build_object('channel', r.channel, 'fare', r.fare_quoted), r.requested_at),
     ('assigned', 'driver', r.driver_id, jsonb_build_object('driverId', r.driver_id), r.assigned_at),
     (CASE WHEN r.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
      CASE WHEN r.status = 'completed' THEN 'driver' ELSE 'rider' END,
      CASE WHEN r.status = 'completed' THEN r.driver_id ELSE r.rider_id END,
      '{}'::jsonb, coalesce(r.completed_at, r.cancelled_at))
   ) e(type, actor, actor_id, data, at)
   WHERE e.type <> 'assigned' OR r.driver_id IS NOT NULL`,
);
await step(
  'accepted offers',
  `INSERT INTO ride_offers (id, ride_id, driver_id, kind, status, eta_s, distance_m, score,
     created_at, expires_at, responded_at)
   SELECT pg_temp.uuid7(requested_at), id, driver_id, 'direct', 'accepted', 240, 1800, 91,
          requested_at, requested_at + interval '15 seconds', requested_at + interval '6 seconds'
   FROM rides WHERE driver_id IS NOT NULL`,
);
await step(
  'tax ledger',
  `INSERT INTO driver_ledger (id, driver_id, kind, amount, ride_id, note, created_at)
   SELECT pg_temp.uuid7(completed_at), driver_id, 'tax', -tax, id, 'Soliq 1%', completed_at
   FROM rides WHERE status = 'completed' AND tax > 0`,
);
await step(
  'card fares',
  `INSERT INTO driver_ledger (id, driver_id, kind, amount, ride_id, note, created_at)
   SELECT pg_temp.uuid7(completed_at), driver_id, 'card_fare', fare_quoted, id, 'Karta', completed_at
   FROM rides WHERE status = 'completed' AND payment_method = 'card'`,
);
await step(
  'tax withholdings',
  `INSERT INTO tax_withholdings (id, ride_id, driver_id, pinfl, period, base_amount, rate_percent,
     amount, created_at)
   SELECT pg_temp.uuid7(r.completed_at), r.id, r.driver_id, d.pinfl,
          to_char(r.completed_at AT TIME ZONE 'Asia/Tashkent', 'YYYY-MM'), r.fare_total, 1, r.tax,
          r.completed_at
   FROM rides r JOIN drivers d ON d.user_id = r.driver_id WHERE r.status = 'completed' AND r.tax > 0`,
);
await step(
  'ratings',
  `INSERT INTO ratings (id, ride_id, author_role, author_id, subject_id, stars, created_at)
   SELECT pg_temp.uuid7(completed_at), id, 'rider', rider_id, driver_id,
          CASE WHEN random() < 0.8 THEN 5 ELSE 4 END, completed_at + interval '1 minute'
   FROM rides WHERE status = 'completed' AND random() < 0.3`,
);
await step(
  'driver counters',
  `UPDATE drivers d SET rides_completed = s.done, offers_received = s.offers,
     offers_accepted = s.offers, rating_sum = s.stars, rating_count = s.rated
   FROM (SELECT r.driver_id, count(*) FILTER (WHERE r.status = 'completed') done, count(*) offers,
                coalesce(sum(g.stars), 0) stars, count(g.id) rated
         FROM rides r LEFT JOIN ratings g ON g.ride_id = r.id
         WHERE r.driver_id IS NOT NULL GROUP BY r.driver_id) s
   WHERE s.driver_id = d.user_id`,
);
await step('analyze', 'ANALYZE');
await client.end();
