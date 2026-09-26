/**
 * Alerting: synthesized sounds (no audio files), browser notifications, a tab-title
 * badge and a favicon badge.
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  return ctx;
}

/** Browsers only allow sound after a user gesture; call from a click to unlock it. */
export async function unlockAudio(): Promise<boolean> {
  const c = audio();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  return c.state === 'running';
}

export function audioReady(): boolean {
  return ctx?.state === 'running';
}

function tone(
  c: AudioContext,
  freq: number,
  delay: number,
  length: number,
  type: OscillatorType,
  peak: number,
) {
  const start = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** Two-tone "ding-dong", about 0.7 s: something new to look at. */
export function ring(): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  tone(c, 880, 0, 0.4, 'sine', 0.5);
  tone(c, 660, 0.28, 0.4, 'sine', 0.5);
}

/**
 * A loud, harsh alarm (about 1.6 s) that cannot be mistaken for the ring: a ride found
 * no driver and a person must act now.
 */
export function alarm(): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  for (let i = 0; i < 4; i++) {
    tone(c, 1320, i * 0.4, 0.18, 'square', 0.35);
    tone(c, 990, i * 0.4 + 0.2, 0.18, 'square', 0.35);
  }
}

/**
 * SOS: a rising and falling wail (about 2.4 s), unlike any other sound of the panel.
 */
export function sosAlarm(): void {
  const c = audio();
  if (!c || c.state !== 'running') return;
  for (let i = 0; i < 3; i++) {
    tone(c, 700, i * 0.8, 0.38, 'sawtooth', 0.4);
    tone(c, 1400, i * 0.8 + 0.4, 0.38, 'sawtooth', 0.4);
  }
}

const SOUND_KEY = 'taxi.sound';

/** The panel's sound switch. */
export const soundPreference = {
  get(): boolean {
    try {
      return localStorage.getItem(SOUND_KEY) !== 'off';
    } catch {
      return true;
    }
  },
  set(on: boolean): void {
    try {
      localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
    } catch {
      // not remembered
    }
  },
};

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notify(title: string, body: string, tag: string, onClick?: () => void): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, { body, tag, icon: '/icon.svg', requireInteraction: true });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
  } catch {
    // some browsers only allow notifications from a service worker
  }
}

const BASE_TITLE = 'SFF Taxi — dispetcher paneli';

/** "(3) Diqqat — SFF Taxi" while something waits; the plain title otherwise. */
export function titleWithBadge(count: number, label = 'Diqqat'): string {
  return count > 0 ? `(${count}) ${label} — SFF Taxi` : BASE_TITLE;
}

export function setTitleBadge(count: number, label?: string): void {
  document.title = titleWithBadge(count, label);
  setFaviconBadge(count);
}

/** The panel icon with a red counter (a dot above 99), as an SVG data URL. */
export function faviconSvg(count: number): string {
  const icon =
    '<rect width="64" height="64" rx="14" fill="#111"/>' +
    '<path d="M14 38l4-11a5 5 0 0 1 4.7-3.3h18.6A5 5 0 0 1 46 27l4 11v8a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-2H21v2a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z" fill="#FFC400"/>';
  const text = count > 99 ? '' : String(count);
  const badge =
    count > 0
      ? '<circle cx="46" cy="18" r="17" fill="#dc2626" stroke="#fff" stroke-width="3"/>' +
        (text
          ? `<text x="46" y="25" font-family="Arial,sans-serif" font-size="${text.length > 1 ? 18 : 22}" ` +
            `font-weight="700" fill="#fff" text-anchor="middle">${text}</text>`
          : '')
      : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${icon}${badge}</svg>`;
}

export function setFaviconBadge(count: number): void {
  if (typeof document === 'undefined') return;
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href =
    count > 0 ? `data:image/svg+xml,${encodeURIComponent(faviconSvg(count))}` : '/icon.svg';
}
