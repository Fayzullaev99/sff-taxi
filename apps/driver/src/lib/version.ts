/**
 * App versions ("x.y.z") against the minimum the API asks for (`GET /v1/config` →
 * `minAppVersion.driver`). Below it the app shows only the update screen: an old build may
 * not understand what the API sends any more.
 */

/** "1.2.3" → [1, 2, 3]; missing or non-numeric parts count as 0 ("1.2" = "1.2.0"). */
export function versionParts(version: string): number[] {
  const core = version.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? '';
  return core.split('.').map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

/** Negative when a < b, 0 when equal, positive when a > b. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Whether this build must be updated before use. Unknown versions (config not loaded,
 * a malformed value) never lock the driver out.
 */
export function mustUpdate(current: string | null | undefined, minimum: string | null | undefined) {
  if (!current || !minimum) return false;
  if (!/^\s*v?\d+(\.\d+)*/.test(current) || !/^\s*v?\d+(\.\d+)*/.test(minimum)) return false;
  return compareVersions(current, minimum) < 0;
}
