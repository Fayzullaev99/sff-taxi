import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { buildConfig } from './src/config.ts';
import { dict, isHtmlKey, t, type Key } from './src/i18n.ts';
import { renderExamples, renderPriceTable, renderRules } from './src/prices.ts';
import { FALLBACK_TARIFFS } from './src/tariffs.ts';

// The landing runs on 5290 in development (the operator panel has 5280).
const port = Number(process.env.PORT ?? 5290);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Fills the pages' `{{t:key}}` (Uzbek text, escaped), `{{{t:key_html}}}` (HTML fragment) and
 * `{{c:name}}` (site configuration) at build time, so every page is a complete static
 * document in the default language; `src/lang.ts` swaps the texts for Russian at runtime.
 * An unknown key fails the build instead of shipping a blank.
 */
function templatePlugin(env: Record<string, string>): Plugin {
  const cfg = buildConfig(env) as unknown as Record<string, string>;
  const pages = ['/', '/privacy/', '/terms/'];
  return {
    name: 'sff-landing-template',
    // robots.txt and sitemap.xml carry the site origin, so they are written here, not in public/
    generateBundle() {
      const today = new Date().toISOString().slice(0, 10);
      const urls = pages
        .map(
          (p) =>
            `  <url><loc>${cfg.siteUrl}${p}</loc><lastmod>${today}</lastmod>` +
            `<xhtml:link rel="alternate" hreflang="ru" href="${cfg.siteUrl}${p}?lang=ru"/></url>`,
        )
        .join('\n');
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        // personal pages (share-trip, invitations, promo codes) are never indexed
        source: `User-agent: *\nAllow: /\nDisallow: /t/\nDisallow: /invite/\nDisallow: /promo/\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`,
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return (
          html
            .replace(/\{\{\{t:([\w.]+)\}\}\}/g, (_, key: string) => {
              if (!(key in dict) || !isHtmlKey(key))
                throw new Error(`Unknown HTML text key ${key}`);
              return t(key as Key, 'uz');
            })
            .replace(/\{\{t:([\w.]+)\}\}/g, (_, key: string) => {
              if (!(key in dict)) throw new Error(`Unknown text key ${key}`);
              return escapeHtml(t(key as Key, 'uz'));
            })
            .replace(/\{\{c:(\w+)\}\}/g, (_, name: string) => {
              if (!(name in cfg)) throw new Error(`Unknown config value ${name}`);
              return escapeHtml(cfg[name] ?? '');
            })
            // the price section with the launch tariff, so the page is complete without JS
            .replace(/\{\{prices:(table|rules|examples)\}\}/g, (_, part: string) => {
              if (part === 'table') return renderPriceTable(FALLBACK_TARIFFS, 'uz');
              if (part === 'rules') return renderRules(FALLBACK_TARIFFS, 'uz');
              return renderExamples(FALLBACK_TARIFFS, 'uz');
            })
        );
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [templatePlugin(loadEnv(mode, process.cwd(), 'VITE_'))],
  appType: 'mpa',
  server: { port, strictPort: true },
  preview: { port, strictPort: true },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        invite: resolve(import.meta.dirname, 'invite/index.html'),
        promo: resolve(import.meta.dirname, 'promo/index.html'),
        trip: resolve(import.meta.dirname, 't/index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
        terms: resolve(import.meta.dirname, 'terms/index.html'),
        notFound: resolve(import.meta.dirname, '404.html'),
      },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'], testTimeout: 30_000 },
}));
