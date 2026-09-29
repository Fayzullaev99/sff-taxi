/**
 * Finding the phone, framework-free (the expo-location driver is plugged in by geo.ts, a
 * fake in tests). One lookup: permission → location services → the cached fix if it is
 * already good → a short watch until a good fix arrives → on timeout the best fix seen
 * (the cached one included), else "unavailable". The watch is always stopped: no GPS is
 * left running after a lookup.
 */
import { betterFix, type Fix, type FixRules, isGoodFix } from './fix';

/** Why there is no position: each has its own advice for the rider (locationProblemText). */
export type LocationProblem = 'denied' | 'blocked' | 'services_off' | 'unavailable';

export type LocateOutcome =
  | {
      ok: true;
      fix: Fix;
      /** The fix met the rules; false: the best there was when time ran out. */
      precise: boolean;
    }
  | { ok: false; problem: LocationProblem };

export interface PermissionState {
  granted: boolean;
  /** Android: false once the rider chose "don't ask again" (only the settings help). */
  canAskAgain: boolean;
}

export interface LocationDriver {
  /** Reads the permission; with `ask`, shows the system prompt when it may. */
  permission(ask: boolean): Promise<PermissionState>;
  servicesEnabled(): Promise<boolean>;
  lastKnown(): Promise<Fix | null>;
  /** Starts position updates; resolves to the function that stops them. */
  watch(highAccuracy: boolean, onFix: (fix: Fix) => void): Promise<() => void>;
}

export interface LocateOptions {
  rules: FixRules;
  /** GPS (for a pickup); else the balanced (network) provider. */
  highAccuracy: boolean;
  /** How long to wait for a good fix before settling for the best one seen. */
  timeoutMs: number;
  /** Show the permission prompt when it is not granted yet. */
  ask: boolean;
  /** Ends the lookup early (the app went to the background, the screen closed). */
  signal?: AbortSignal;
  now?: () => number;
}

export async function locate(
  driver: LocationDriver,
  options: LocateOptions,
): Promise<LocateOutcome> {
  const now = options.now ?? Date.now;
  const { rules, signal } = options;
  let permission: PermissionState;
  try {
    permission = await driver.permission(options.ask);
  } catch {
    return { ok: false, problem: 'unavailable' };
  }
  if (!permission.granted) {
    return { ok: false, problem: permission.canAskAgain ? 'denied' : 'blocked' };
  }
  const servicesOn = await driver.servicesEnabled().catch(() => true);
  if (!servicesOn) return { ok: false, problem: 'services_off' };

  const cached = await driver.lastKnown().catch(() => null);
  if (isGoodFix(cached, now(), rules)) return { ok: true, fix: cached, precise: true };
  if (signal?.aborted) return settle(cached, now(), rules);

  return new Promise<LocateOutcome>((resolve) => {
    let best: Fix | null = cached;
    let done = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (outcome: LocateOutcome) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      stop?.();
      stop = null;
      resolve(outcome);
    };
    const onAbort = () => finish(settle(best, now(), rules));

    timer = setTimeout(() => finish(settle(best, now(), rules)), options.timeoutMs);
    signal?.addEventListener('abort', onAbort);

    driver
      .watch(options.highAccuracy, (fix) => {
        if (done) return;
        best = betterFix(best, fix, now(), rules);
        if (isGoodFix(fix, now(), rules)) finish({ ok: true, fix, precise: true });
      })
      .then((stopWatching) => {
        // finished (timeout, abort, a good fix) before the watch even started
        if (done) stopWatching();
        else stop = stopWatching;
      })
      .catch(() => finish(settle(best, now(), rules)));
  });
}

function settle(best: Fix | null, now: number, rules: FixRules): LocateOutcome {
  if (!best) return { ok: false, problem: 'unavailable' };
  return { ok: true, fix: best, precise: isGoodFix(best, now, rules) };
}

export interface ProblemText {
  title: string;
  message: string;
  /** The button that helps: ask again, open the app's settings, switch location on. */
  action: { label: string; kind: 'ask' | 'settings' | 'services' } | null;
}

/** What to tell the rider when there is no position, in Uzbek (Latin). */
export function locationProblemText(problem: LocationProblem, withMap: boolean): ProblemText {
  const place = withMap ? 'pinni xaritada o‘zingiz qo‘ying' : 'manzilni qidiruvdan tanlang';
  switch (problem) {
    case 'denied':
      return {
        title: 'Joylashuvga ruxsat berilmagan',
        message: `Haydovchi sizni aniq topishi uchun joylashuvga ruxsat bering yoki ${place}.`,
        action: { label: 'Ruxsat berish', kind: 'ask' },
      };
    case 'blocked':
      return {
        title: 'Joylashuv ruxsati o‘chirilgan',
        message: `Sozlamalar → Ruxsatlar → Joylashuv bo‘limida «Ilova ishlatilayotganda»ni tanlang yoki ${place}.`,
        action: { label: 'Sozlamalarni ochish', kind: 'settings' },
      };
    case 'services_off':
      return {
        title: 'Telefonda joylashuv (GPS) o‘chiq',
        message: `Joylashuvni yoqing — shunda olib ketish joyi aniq bo‘ladi. Yoki ${place}.`,
        action: { label: 'Joylashuvni yoqish', kind: 'services' },
      };
    case 'unavailable':
      return {
        title: 'Joylashuv aniqlanmadi',
        message: `Ochiqroq joyga chiqib qayta urinib ko‘ring yoki ${place}.`,
        action: null,
      };
  }
}
