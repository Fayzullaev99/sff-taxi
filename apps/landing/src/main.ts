import { track } from './analytics';
import { config } from './config';
import { type Lang, t } from './i18n';
import { currentLang } from './lang';
import { copyText } from './links';
import { initPage } from './page';
import { renderExamples, renderPriceTable, renderRules } from './prices';
import { FALLBACK_TARIFFS, fetchTariffs, type PublicTariffs } from './tariffs';

initPage({ campaign: 'launch' });

// --- prices: the live tariff when the API answers, else the built-in launch tariff ------
let tariffs: PublicTariffs = FALLBACK_TARIFFS;
let live = false;

function renderPrices(lang: Lang): void {
  const table = document.getElementById('price-table');
  const rules = document.getElementById('price-rules');
  const examples = document.getElementById('price-examples');
  if (table) table.innerHTML = renderPriceTable(tariffs, lang);
  if (rules) rules.innerHTML = renderRules(tariffs, lang);
  if (examples) examples.innerHTML = renderExamples(tariffs, lang);
  const source = document.getElementById('price-source');
  if (source) {
    source.className = `pill${live ? ' pill--live' : ''}`;
    source.textContent = live ? t('prices.live', lang) : t('prices.static', lang);
  }
  const city = document.getElementById('price-updated');
  if (city) {
    city.hidden = !(live && tariffs.city);
    if (live && tariffs.city) city.textContent = tariffs.city;
  }
  // service cards of classes operators have not switched on yet say "soon"
  for (const card of document.querySelectorAll<HTMLElement>('[data-class]')) {
    const cls = tariffs.classes.find((c) => c.id === card.dataset.class);
    const enabled = cls ? cls.enabled : true;
    card.classList.toggle('card--off', !enabled);
    const tag = card.querySelector<HTMLElement>('.card__tag');
    if (tag) tag.hidden = enabled;
  }
}

renderPrices(currentLang());
document.addEventListener('langchange', (e) => renderPrices((e as CustomEvent<Lang>).detail));
void fetchTariffs().then((fetched) => {
  if (!fetched) return;
  tariffs = fetched;
  live = true;
  renderPrices(currentLang());
});

// --- the launch promo code: one tap to copy --------------------------------------------
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-copy-promo]')) {
  btn.addEventListener('click', async () => {
    const ok = await copyText(config.launchPromoCode);
    if (!ok) return;
    const label = btn.textContent;
    btn.textContent = t('cta.copied', currentLang());
    track('promo_copy', { code: 'launch' });
    window.setTimeout(() => {
      btn.textContent = label;
    }, 1600);
  });
}

// --- mobile menu: the nav links scroll; nothing else to wire ---------------------------
for (const link of document.querySelectorAll<HTMLAnchorElement>('.nav a[href^="#"]')) {
  link.addEventListener('click', () => track('nav', { to: link.getAttribute('href') ?? '' }));
}
