# Engineering conventions

Read this before changing anything. Every change keeps the whole repo green. The API is built
on the architecture of the sister project SFF Eats (same core, same patterns); when in doubt,
do what SFF Eats does.

## Checks before every commit

```bash
npm run typecheck          # root: all workspaces (uses the local TypeScript, see below)
rtk proxy npx eslint .     # plain `npx eslint` under rtk exits 0 even on errors
npx prettier --check .
cd apps/api && rtk proxy npx vitest run --reporter=default
```

## This Windows machine

- A global TypeScript 4 `tsc` is on PATH and `npx tsc` may resolve to it: use
  `node node_modules/typescript/bin/tsc --noEmit -p apps/api` or `npm run typecheck`.
- Run vitest as `rtk proxy npx vitest run --reporter=default` (rtk mangles its output).
- Don't put JS template literals (backticks) in Bash heredocs or `node -e`: write files with the
  Write/Edit tools.
- Never `taskkill /IM node.exe`; stop only processes you started, by PID.
- No Python; helper scripts are Node.

## Monorepo

npm workspaces under `apps/*`: `apps/api` (NestJS API + worker) now; `apps/rider`,
`apps/driver` (Expo) and `apps/web` (operator panel) follow. Shared config lives at the root
(`eslint.config.mjs`, `.prettierrc.json`, `tsconfig` per app).

## API (apps/api)

- NestJS 12 + Kysely + PostgreSQL 17 + Redis. Each module is one folder under
  `src/modules/<name>` with a `<name>.module.ts` (controllers + service), registered in
  `src/app.module.ts` (and `src/worker.module.ts` for outbox handlers and jobs).
- Pure logic (fares, geometry, scores, fees) lives in `src/lib/*.ts` with unit tests next to it;
  modules do I/O and call it.
- Migrations: plain SQL `migrations/NNNN_name.sql`, never edited once committed (a checksum
  guards this). Mirror every table/column in `src/core/db/schema.ts` by hand.
- Validation: zod schemas + `ZodPipe`. User-facing messages are Uzbek (Latin), code/comments
  English.
- Money: integer so'm. Times: UTC in DB; tariff windows (night) are Tashkent local (UTC+5, no DST).
- Access: `@Public()`, `@AdminOnly()` (operators, from `ADMIN_PHONES`); drivers are checked by
  the drivers service (`status = 'active'`).
- Side effects after commit go through the outbox: `emit(trx, topic, payload)` inside the
  transaction; handlers implement `OutboxHandler` and must be idempotent.
- Anything that assigns a driver locks the ride row and the driver row (`FOR UPDATE`) inside one
  transaction; partial unique indexes back this up (one active ride per driver and per rider, one
  pending offer per driver).
- Time-dependent jobs take `now` as a parameter so tests control the clock.
- Tests: `test/*.test.ts` hit the real HTTP pipeline (`createTestApp`, helpers in
  `test/helpers.ts`, fake external services in `test/fakes.ts`). Test files run one at a time
  against one database, rebuilt from migrations. Parallel checkouts must use their own:
  `TEST_DB_NAME=taxi_test_2 TEST_REDIS_DB=<n>` (databases `taxi_test`, `taxi_test_2` exist).

## Local services

Postgres :5460 (`taxi_owner`/`taxi_owner_dev` owner, `taxi_app`/`taxi_app_dev` runtime),
Redis :6394, API :3200, worker health :3201, operator panel (apps/web) :5280, S3 (SeaweedFS) :8335. Operator phone in
dev: `+998900000001` (`ADMIN_PHONES`); with `SMS_PROVIDER=console` codes appear in the API log.
