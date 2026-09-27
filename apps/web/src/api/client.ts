/** VITE_API_URL; unset = the local API, empty = same origin (one reverse proxy). */
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3200';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

const SESSION_KEY = 'taxi.session';

export const sessionStore = {
  get(): Session | null {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(session: Session | null): void {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // storage blocked: the session lasts until reload
    }
    window.dispatchEvent(new Event('taxi:session'));
  },
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
  }
}

/** The request never reached the server. */
export class OfflineError extends Error {
  constructor() {
    super('Server bilan aloqa yo‘q. Internetni tekshiring.');
  }
}

let refreshing: Promise<boolean> | null = null;

/** Rotates the refresh token once for every caller that hit a 401 at the same time. */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const session = sessionStore.get();
    if (!session) return false;
    try {
      const res = await fetch(`${API_URL}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) return false;
      const tokens = (await res.json()) as Session;
      sessionStore.set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
}

/** The body and the HTTP status (201 created vs 200 repeated, for idempotent orders). */
export async function apiResponse<T>(
  path: string,
  options: Options = {},
): Promise<{ status: number; data: T }> {
  const auth = options.auth ?? true;
  const send = () => {
    const session = auth ? sessionStore.get() : null;
    return fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  };

  let res: Response;
  try {
    res = await send();
    if (res.status === 401 && auth && (await refreshSession())) res = await send();
  } catch {
    throw new OfflineError();
  }
  if (res.status === 401 && auth) sessionStore.set(null);
  if (res.status === 204) return { status: 204, data: undefined as T };
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // not JSON (e.g. a proxy error page): fall through to the status-based message
  }
  if (!res.ok) {
    const body = (data ?? {}) as {
      message?: unknown;
      issues?: { message: string }[];
    };
    const message = body.issues?.length
      ? [...new Set(body.issues.map((i) => i.message))].join('; ')
      : typeof body.message === 'string'
        ? body.message
        : `Xatolik (${res.status})`;
    throw new ApiError(res.status, message, data);
  }
  return { status: res.status, data: data as T };
}

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  return (await apiResponse<T>(path, options)).data;
}

const GENERIC_429 = 'Juda ko‘p urinish';

export function errorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const seconds = retryAfter(error);
    // the API may explain the limit itself ("Yangi kodni bir daqiqadan so‘ng so‘rang")
    if (error.message && error.message !== GENERIC_429 && !error.message.startsWith('Xatolik')) {
      return error.message;
    }
    return seconds
      ? `Juda ko‘p urinish. ${seconds} soniyadan so‘ng qayta urinib ko‘ring.`
      : 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring.';
  }
  if (error instanceof ApiError && error.status >= 500) {
    return error.message.startsWith('Xatolik') || error.message === 'Internal server error'
      ? 'Serverda xatolik yuz berdi. Birozdan so‘ng qayta urinib ko‘ring.'
      : error.message;
  }
  if (error instanceof ApiError && error.status === 403 && error.message === 'Forbidden resource') {
    return 'Bu amal uchun huquqingiz yetarli emas';
  }
  return (error as Error)?.message ?? 'Noma’lum xatolik';
}

/** Seconds until a 429 may be retried, when the API says so. */
export function retryAfter(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const seconds = (error.body as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : null;
}

/** Validation messages keyed by field path ("price", "optionGroups.0.name"). */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 400) return {};
  const issues = (error.body as { issues?: { path: string; message: string }[] } | null)?.issues;
  const out: Record<string, string> = {};
  for (const issue of issues ?? []) out[issue.path] ??= issue.message;
  return out;
}
