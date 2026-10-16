import { type Lang, t } from './i18n.ts';
import { cityFare, intercityFare, money, type PublicTariffs } from './tariffs.ts';

/**
 * The "Narxlar" section as HTML strings: rendered at build time with the launch tariff
 * (vite.config.ts), then again in the browser with the live tariff and on a language
 * change. Pure, so both sides produce the same markup.
 */

const CLASS_LABEL: Record<string, { uz: string; ru: string }> = {
  economy: { uz: 'Ekonom', ru: 'Эконом' },
  comfort: { uz: 'Komfort', ru: 'Комфорт' },
  minivan: { uz: 'Miniven', ru: 'Минивэн' },
  business: { uz: 'Biznes', ru: 'Бизнес' },
};

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const classLabel = (id: string, lang: Lang, fallback: string) =>
  CLASS_LABEL[id]?.[lang] ?? fallback;

/** Classes riders can order now (operators switch Miniven and Biznes on when cars qualify). */
export const enabledClasses = (tariffs: PublicTariffs) =>
  tariffs.classes.filter((c) => c.enabled && c.bands.length > 0);

export function renderPriceTable(tariffs: PublicTariffs, lang: Lang): string {
  const classes = enabledClasses(tariffs);
  const bands = classes[0]?.bands ?? [];
  const head = classes.map((c) => `<th class="num">${esc(classLabel(c.id, lang, c.label))}</th>`);
  const rows = bands.map((band, i) => {
    const cells = classes.map((c) => {
      const b = c.bands[i] ?? c.bands[c.bands.length - 1];
      return `<td class="num">${money(b?.price ?? 0)}</td>`;
    });
    return `<tr><td>${esc(t('prices.upTo', lang, { km: band.upToM / 1000 }))}</td>${cells.join('')}</tr>`;
  });
  const beyond = classes.map((c) => `<td class="num">+${money(c.beyondPerKm)}</td>`);
  rows.push(`<tr><td>${esc(t('prices.beyond', lang))}</td>${beyond.join('')}</tr>`);
  return `<table class="price-table"><thead><tr><th>${esc(t('prices.colDistance', lang))}</th>${head.join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function renderRules(tariffs: PublicTariffs, lang: Lang): string {
  const economy = enabledClasses(tariffs)[0];
  const items = [
    t('prices.night', lang, {
      from: tariffs.night.from,
      to: tariffs.night.to,
      percent: tariffs.night.percent,
    }),
    t('prices.waiting', lang, {
      free: tariffs.waiting.freeMinutes,
      perMin: money(tariffs.waiting.perMinute),
    }),
    economy ? t('prices.outside', lang, { perKm: money(economy.outsidePerKm) }) : null,
    economy
      ? t('prices.intercity', lang, {
          perKm: money(economy.intercityPerKm),
          min: money(economy.intercityMin),
          seat: tariffs.seats.sharePercent,
        })
      : null,
    t('prices.cancel', lang, { fee: money(tariffs.cancellationFee) }),
    t('prices.stops', lang, {
      fee: money(tariffs.stops.perStop),
      free: tariffs.stops.freeMinutes,
    }),
    t('prices.options', lang, {
      child: money(tariffs.options.childSeat),
      luggage: money(tariffs.options.luggage),
      pets: money(tariffs.options.pets),
    }),
  ];
  return items
    .filter((s): s is string => Boolean(s))
    .map((s) => `<li>${esc(s)}</li>`)
    .join('');
}

export function renderExamples(tariffs: PublicTariffs, lang: Lang): string {
  const economy = enabledClasses(tariffs)[0];
  if (!economy) return '';
  const som = t('misc.som', lang);
  const rows: [string, number][] = [
    [t('prices.example1', lang), cityFare(economy, 2000)],
    [t('prices.example2', lang), cityFare(economy, 4000)],
    [t('prices.example3', lang), cityFare(economy, 7000)],
    [t('prices.exampleIntercity', lang), intercityFare(economy, 30_000)],
  ];
  return rows
    .map(
      ([label, price]) =>
        `<div class="example"><span>${esc(label)}</span><b>${money(price)} ${som}</b></div>`,
    )
    .join('');
}
