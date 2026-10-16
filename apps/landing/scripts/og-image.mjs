/**
 * Renders the Open Graph cards (public/og.png, og-invite.png, og-promo.png, 1200x630) and the
 * PNG icons (apple-touch-icon.png 180x180, icon-512.png) from scripts/og-template.html and
 * public/favicon.svg with headless Chromium (Playwright). The results are committed, so this
 * only runs when the texts or the brand change:
 *
 *   npm run og -w apps/landing
 *
 * Playwright is not a dependency of the repository: it is resolved from the usual places
 * (node_modules, NODE_PATH, a global install). Without it the script explains and exits 1.
 */
/* global process, console, document */
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const site = (process.env.VITE_SITE_URL ?? 'https://taxi.sff.uz').replace(/^https?:\/\//, '');

const CARDS = [
  {
    file: 'og.png',
    title: 'Guliston taksisi — qat’iy narx, surge yo‘q',
    sub: 'Narx buyurtmadan oldin ko‘rinadi va yo‘lda o‘zgarmaydi. Naqd yoki karta, tekshirilgan haydovchilar.',
    code: null,
  },
  {
    file: 'og-invite.png',
    title: 'Do‘stingiz sizni SFF Taxiga taklif qildi',
    sub: 'Birinchi safaringizga 50% chegirma (10 000 so‘mgacha). Ilovani o‘rnating va kodni kiriting.',
    code: null,
  },
  {
    file: 'og-promo.png',
    title: 'Birinchi safarga 50% chegirma',
    sub: 'Promokodni ilovaning «Promokod» qatoriga yozing — 10 000 so‘mgacha chegirma.',
    code: process.env.VITE_LAUNCH_PROMO_CODE ?? 'GULISTON',
  },
];

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return require(name);
    } catch {
      // next
    }
  }
  console.error(
    'Playwright not found. Install it once (npm i -g playwright && npx playwright install chromium)\n' +
      'or point NODE_PATH at a node_modules that has it, then run again.',
  );
  process.exit(1);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  const template = await readFile(join(here, 'og-template.html'), 'utf8');
  await mkdir(publicDir, { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  for (const card of CARDS) {
    await page.setContent(template, { waitUntil: 'load' });
    await page.evaluate(
      (c) => {
        document.getElementById('title').textContent = c.title;
        document.getElementById('title').classList.toggle('small', c.title.length > 34);
        document.getElementById('sub').textContent = c.sub;
        const code = document.getElementById('code');
        code.hidden = !c.code;
        if (c.code) code.textContent = c.code;
        document.getElementById('site').textContent = c.site;
      },
      { ...card, site },
    );
    const png = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    await writeFile(join(publicDir, card.file), png);
    console.log(`${card.file}: ${png.length} bytes`);
  }

  // icons from the favicon
  const svg = await readFile(join(publicDir, 'favicon.svg'), 'utf8');
  for (const [file, size] of [
    ['apple-touch-icon.png', 180],
    ['icon-512.png', 512],
  ]) {
    const icon = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await icon.setContent(
      `<!doctype html><html><body style="margin:0;background:#ffc400"><div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body></html>`,
    );
    const png = await icon.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: size, height: size },
    });
    await writeFile(join(publicDir, file), png);
    console.log(`${file}: ${png.length} bytes`);
    await icon.close();
  }
  console.log(`written to ${pathToFileURL(publicDir)}`);
} finally {
  await browser.close();
}
