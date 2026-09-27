/**
 * HTTP client for the SFF Taxi API. Framework-free (no React Native imports) so the
 * token refresh logic is unit-tested in plain Node.
 */

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Holds the current tokens in memory. `set` may return a promise that settles once the
 * tokens are persisted: a rotated refresh token is waited for, because the old one is dead
 * on the server the moment it was used (reusing it revokes the whole session).
 */
export interface TokenStore {
  get(): SessionTokens | null;
  set(tokens: SessionTokens | null): void | Promise<void>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer: no network, server down or timed out. */
export class OfflineError extends Error {
  constructor() {
    super('Internet aloqasi yo‘q yoki server javob bermayapti');
    this.name = 'OfflineError';
  }
}

export type AuthMode = 'none' | 'optional' | 'required';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /**
   * 'required' sends the access token and refreshes it once on 401; 'optional' sends it
   * when there is one, and on a 401 for a stale token refreshes (or, with the session
   * gone, retries anonymously).
   */
  auth?: AuthMode;
  signal?: AbortSignal;
}

export interface ApiClientConfig {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
  /** Called when the session is gone for good (refresh token rejected). */
  onSignedOut?: () => void;
  timeoutMs?: number;
  /** Told after every request whether the server answered (drives the offline banner). */
  onReachability?: (online: boolean) => void;
  /**
   * Awaited before a refresh is sent, e.g. until the app is in the foreground: a refresh
   * cut off by the OS after the server rotated the token would sign the rider out.
   */
  refreshGate?: () => Promise<void>;
  /** The refresh request gets longer than ordinary requests before it is given up. */
  refreshTimeoutMs?: number;
}

type RefreshOutcome = 'ok' | 'rejected' | 'offline';

export interface ApiClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  /** Like `request`, with the HTTP status (e.g. 200 vs 202 for an order cancellation). */
  requestWithStatus<T>(
    path: string,
    options?: RequestOptions,
  ): Promise<{ status: number; data: T }>;
  /** Rotates the tokens; concurrent callers share one in-flight refresh. */
  refresh(): Promise<RefreshOutcome>;
  /** Resolves once no refresh is in flight (e.g. before signing out with the latest token). */
  settled(): Promise<void>;
  baseUrl: string;
}

export function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const base = baseUrl.replace(/\/+$/, '');
  const params = Object.entries(query ?? {})
    .filter((entry): entry is [string, string | number] => entry[1] != null && entry[1] !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${base}${path}${params ? `?${params}` : ''}`;
}

/** The message the API put in an error body (validation issues joined), or a fallback. */
export function errorMessage(status: number, body: unknown): string {
  const b = (body ?? {}) as { message?: unknown; issues?: { message?: unknown }[] };
  if (Array.isArray(b.issues) && b.issues.length) {
    const texts = b.issues.map((i) => i.message).filter((m): m is string => typeof m === 'string');
    if (texts.length) return [...new Set(texts)].join('; ');
  }
  if (typeof b.message === 'string' && b.message) return b.message;
  if (status === 429) return 'Juda ko‘p urinish. Birozdan so‘ng qayta urinib ko‘ring';
  if (status >= 500) return 'Serverda xatolik. Birozdan so‘ng qayta urinib ko‘ring';
  return `Xatolik (${status})`;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const timeoutMs = config.timeoutMs ?? 20_000;
  const refreshTimeoutMs = config.refreshTimeoutMs ?? 60_000;
  let refreshing: Promise<RefreshOutcome> | null = null;

  async function send(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
    limitMs = timeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limitMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await doFetch(url, { ...init, signal: controller.signal });
      config.onReachability?.(true);
      return res;
    } catch (error) {
      if (signal?.aborted) throw error;
      config.onReachability?.(false);
      throw new OfflineError();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * One refresh at a time, strictly: the API rotates the refresh token on every use and
   * treats a second use of the old one as theft (the whole session is revoked). So every
   * caller (401s of parallel requests, SSE tickets, explicit calls) shares the one in
   * flight; it waits for the gate (the app in the foreground) before it is sent; the new
   * pair is persisted before anyone goes on; and an answer for a session that was replaced
   * meanwhile (sign-out, another sign-in) is dropped instead of overwriting it.
   */
  function refresh(): Promise<RefreshOutcome> {
    refreshing ??= (async (): Promise<RefreshOutcome> => {
      if (config.refreshGate) await config.refreshGate().catch(() => undefined);
      // read after the gate: the tokens may have changed while waiting
      const current = config.tokens.get();
      if (!current) return 'rejected';
      const replaced = () => config.tokens.get()?.refreshToken !== current.refreshToken;
      let res: Response;
      try {
        res = await send(
          buildUrl(config.baseUrl, '/v1/auth/refresh'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: current.refreshToken }),
          },
          undefined,
          refreshTimeoutMs,
        );
      } catch {
        return 'offline';
      }
      if (res.status === 401 || res.status === 400) {
        // the refresh token is dead (expired, revoked or reused): the session is over
        if (!replaced()) {
          await config.tokens.set(null);
          config.onSignedOut?.();
          return 'rejected';
        }
        return config.tokens.get() ? 'ok' : 'rejected';
      }
      if (!res.ok) return 'offline';
      let pair: SessionTokens;
      try {
        pair = (await res.json()) as SessionTokens;
      } catch {
        return 'offline';
      }
      if (typeof pair?.accessToken !== 'string' || typeof pair.refreshToken !== 'string') {
        return 'offline';
      }
      // signed out or signed in again while this was in flight: that session wins
      if (replaced()) return config.tokens.get() ? 'ok' : 'rejected';
      await config.tokens.set({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
      return 'ok';
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function settled(): Promise<void> {
    while (refreshing) await refreshing.catch(() => undefined);
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await requestWithStatus<T>(path, options)).data;
  }

  async function requestWithStatus<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<{ status: number; data: T }> {
    const auth = options.auth ?? 'required';
    const url = buildUrl(config.baseUrl, path, options.query);
    const attempt = (token: string | null) =>
      send(
        url,
        {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        },
        options.signal,
      );

    let token = auth !== 'none' ? (config.tokens.get()?.accessToken ?? null) : null;
    if (auth === 'required' && !token) throw new ApiError(401, 'Tizimga kiring');
    let res = await attempt(token);

    // 'optional' routes answer 401 only when the token we sent is stale: refresh like
    // 'required', and when the session is gone ask again anonymously
    if (res.status === 401 && (auth === 'required' || (auth === 'optional' && token))) {
      const latest = config.tokens.get()?.accessToken ?? null;
      // someone else already rotated the tokens while this request was in flight
      const outcome = latest && latest !== token ? 'ok' : await refresh();
      if (outcome === 'offline') throw new OfflineError();
      token = config.tokens.get()?.accessToken ?? null;
      if (outcome === 'ok' && token) res = await attempt(token);
      else if (auth === 'optional') res = await attempt(null);
    }

    if (res.status === 204) return { status: 204, data: undefined as T };
    const text = await res.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!res.ok) {
      const message =
        res.status === 401 ? 'Sessiya tugadi, qaytadan kiring' : errorMessage(res.status, data);
      throw new ApiError(res.status, message, data);
    }
    return { status: res.status, data: data as T };
  }

  return { request, requestWithStatus, refresh, settled, baseUrl: config.baseUrl };
}

/** Human-readable text for any error thrown by the client or a screen. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError || error instanceof OfflineError) return error.message;
  return 'Kutilmagan xatolik yuz berdi';
}

export function isOffline(error: unknown): boolean {
  return error instanceof OfflineError;
}
