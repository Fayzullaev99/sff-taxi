# SFF Taxi landing site (`apps/landing`)

The public site at `taxi.<domain>`: the marketing page for riders and drivers, the invitation
and promo-code pages the apps link to, the share-trip page and the legal texts. Static,
bilingual (Uzbek Latin by default, Russian with one switch), mobile first, no framework:
Vite + TypeScript + plain HTML/CSS, Leaflet only on the share-trip page.

| Path            | What                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Hero, launch promo, services, prices (live from `GET /v1/tariffs`, else the built-in launch tariff), safety, driver recruitment, FAQ        |
| `/invite/CODE`  | A friend's invitation: tries `sfftaxi://invite/CODE`, shows the code, store buttons with the code in the Play Store install referrer        |
| `/promo/CODE`   | Same for a promo code (`sfftaxi://invite/CODE`: the app's code box takes both kinds)                                                        |
| `/t/TOKEN`      | Share-trip page (`GET /v1/share/TOKEN`): car, driver's first name, stops, live position on a map; 410 after the ride (`SHARE_BASE_URL`)     |
| `/privacy/`     | Privacy policy (uz/ru) under O‘RQ-547 (data stored in Uzbekistan, art. 27¹) and Resolution 200                                              |
| `/terms/`       | Terms of use / public offer (uz/ru)                                                                                                         |
| `/.well-known/` | `assetlinks.json` (Android App Links) and `apple-app-site-association` (iOS Universal Links): placeholders for the signing fingerprint/team |

The API's `invite_url` setting (`PUT /v1/admin/settings/promo`, default `https://taxi.sff.uz/invite`)
and `SHARE_BASE_URL` must point at this site: the apps' share texts use them.

## Run

```bash
npm install                      # repo root
cp apps/landing/.env.example apps/landing/.env   # optional: links, phone, legal entity
npm run dev -w apps/landing      # http://localhost:5290
npm run build -w apps/landing    # dist/ (type-checks first)
npm test -w apps/landing
```

In development the API is reached through `VITE_API_URL` (e.g. `http://localhost:3200`; add
`http://localhost:5290` to the API's `CORS_ORIGINS`). In production the variable stays empty:
the edge Caddy proxies `/v1/*` on the landing domain to the API, so there is no CORS.

## How the texts work

`src/i18n.ts` holds every string in both languages. Pages reference them as `{{t:key}}`
(escaped), `{{{t:key_html}}}` (HTML fragments) and `{{c:name}}` (site configuration); the
Vite plugin in `vite.config.ts` fills the Uzbek text at build time, so each page is a complete
static document that works without JavaScript and reads well to crawlers. At runtime
`src/lang.ts` swaps the texts (`data-i18n` attributes) when the visitor picks Russian
(`?lang=ru`, the saved choice, or a Russian browser). The legal pages carry both languages in
full (`data-lang` sections). A key missing from the dictionary fails the build; the tests
check that every key used in the pages exists and that both languages are complete.

The price section is rendered from the same code at build time (launch tariff,
`src/tariffs.ts` `FALLBACK_TARIFFS`, mirrors `apps/api/src/lib/tariff.ts`) and in the browser
with the live tariff (`src/prices.ts`). Classes operators have not switched on (Miniven,
Biznes at launch) show "Tez kunda".

## Open Graph images and icons

`public/og.png`, `og-invite.png`, `og-promo.png` (1200×630) and the PNG icons are rendered
from `scripts/og-template.html` and `public/favicon.svg` by headless Chromium:

```bash
npm run og -w apps/landing       # needs Playwright (npm i -g playwright; npx playwright install chromium)
```

They are committed; rerun only when the texts or the brand change.

## Analytics

Off by default. `VITE_ANALYTICS_SRC` (a Plausible script URL, or the Yandex Metrika loader)
and `VITE_ANALYTICS_SITE` switch it on; `src/analytics.ts` then reports coarse events
(store button, promo copy, language) and never personal data. Update the privacy policy
(§3.4) when switching it on.

## Deploy

`Dockerfile.landing` builds the site and serves it with Caddy (non-root, `/healthz`), with
`deploy/landing.Caddyfile` rewriting `/invite/CODE`, `/promo/CODE` and `/t/TOKEN` to their
pages. The production stack adds the `landing` service and the `LANDING_DOMAIN` site to the
edge Caddy: see [docs/deploy.md](../../docs/deploy.md) ("Landing site"). Site texts and
links are build arguments (`LANDING_*` in `deploy/.env.prod`).

## Placeholders to fill before the campaign

`VITE_SUPPORT_PHONE`, `VITE_OFFICE_ADDRESS`, `VITE_LEGAL_NAME`, `VITE_INN`,
`VITE_LEGAL_EMAIL`, the App Store links (`VITE_APPSTORE_*`, the buttons say "Tez kunda" until
then), the Play Store links once the apps are published, `public/.well-known/assetlinks.json`
(the SHA-256 of the Play App Signing key) and `apple-app-site-association` (the Apple team id),
and the bracketed fields of the legal texts (register number, responsible person).
