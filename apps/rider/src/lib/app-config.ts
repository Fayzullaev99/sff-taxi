/**
 * What GET /config tells the app (pure, unit-tested): whether this version is too old to
 * run, and the support contacts.
 */

/** "1.2.3" -> [1, 2, 3]; anything else -> null. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative when a < b, 0 when equal, positive when a > b; null when either is unreadable. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) {
    if (x[i]! !== y[i]!) return x[i]! - y[i]!;
  }
  return 0;
}

/** True only when both versions are known and this one is below the minimum. */
export function updateRequired(
  current: string | null | undefined,
  minimum: string | null | undefined,
): boolean {
  if (!current || !minimum) return false;
  const c = compareVersions(current, minimum);
  return c !== null && c < 0;
}

/** The support Telegram as a link: "@sff_taxi", "sff_taxi", "t.me/sff_taxi" -> https://t.me/sff_taxi. */
export function telegramLink(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const url = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_+/-]{2,100})$/.exec(
    v,
  );
  if (url) return `https://t.me/${url[1]}`;
  const handle = /^@?([A-Za-z0-9_]{3,64})$/.exec(v);
  return handle ? `https://t.me/${handle[1]}` : null;
}

/** "@sff_taxi" for display. */
export function telegramHandle(value: string | null | undefined): string | null {
  const link = telegramLink(value);
  if (!link) return null;
  const path = link.slice('https://t.me/'.length);
  return /^[A-Za-z0-9_]+$/.test(path) ? `@${path}` : `t.me/${path}`;
}

/** The dispatch office's number: the API's, else the build's fallback, else none. */
export function supportPhone(
  fromApi: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  return fromApi?.trim() || fallback?.trim() || null;
}
