import { config } from './config';

/**
 * Analytics hook. Off by default: nothing is loaded and nothing is sent until
 * VITE_ANALYTICS_SRC names a script (a cookie-less counter such as Plausible, or the
 * Yandex Metrika loader). Events go to `window.plausible` / `window.ym` when present and
 * are otherwise dropped, so page code calls `track()` freely.
 *
 * Personal data never goes through here: events carry names and coarse properties only
 * (a store button, a language), never a phone or a code.
 */

declare global {
  interface Window {
    plausible?: (event: string, opts?: { props?: Record<string, string> }) => void;
    ym?: (id: number, method: string, ...args: unknown[]) => void;
  }
}

export function loadAnalytics(): void {
  if (!config.analyticsSrc) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = config.analyticsSrc;
  if (config.analyticsSite) s.dataset.domain = config.analyticsSite;
  document.head.appendChild(s);
}

export function track(event: string, props: Record<string, string> = {}): void {
  if (!config.analyticsSrc) return;
  try {
    if (window.plausible) window.plausible(event, { props });
    else if (window.ym && config.analyticsSite) {
      window.ym(Number(config.analyticsSite), 'reachGoal', event, props);
    }
  } catch {
    // an ad blocker removed the script: fine
  }
}
