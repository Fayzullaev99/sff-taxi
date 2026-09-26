/**
 * HTTP client for the SFF Taxi API: bearer auth, refresh-token rotation with a
 * single refresh in flight, Uzbek error messages. No React Native imports, so
 * it is unit-tested under Node.
 */

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires (ms since epoch). */
  accessExpiresAt: number;
}

/** What `POST /v1/auth/verify` and `/v1/auth/refresh` return. */
export interface TokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

export interface TokenStore {
  load(): Promise<Tokens | null>;
  save(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

export const NETWORK_ERROR_MESSAGE = 'Internet aloqasi yo‘q yoki server javob bermayapti';

export class ApiError extends Error {
  constructor(
    /** HTTP status; 0 when the request never got an answer. */
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/** The message to show for any error thrown by the client (or anything else). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Kutilmagan xatolik yuz berdi';
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'Qaytadan tizimga kiring';
  if (status === 403) return 'Bu amalga ruxsat yo‘q';
  if (status === 404) return 'Topilmadi';
  if (status === 409) return 'Amalni bajarib bo‘lmadi';
  if (status === 429) return 'Juda ko‘p urinish, birozdan so‘ng qayta urinib ko‘ring';
  if (status >= 500) return 'Serverda xatolik, birozdan so‘ng qayta urinib ko‘ring';
  return 'So‘rov bajarilmadi';
}

/** NestJS's English defaults, replaced by Uzbek ones. */
const HTTP_DEFAULT_MESSAGES = new Set([
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Conflict',
  'Bad Request',
  'Too Many Requests',
  'Internal Server Error',
  'Service Unavailable',
]);

/** Pulls the human message out of a NestJS error body. */
export function messageFromBody(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; issues?: unknown };
    const issue = Array.isArray(b.issues)
      ? (b.issues[0] as { message?: unknown } | undefined)?.message
      : undefined;
    if (typeof issue === 'string' && issue) return issue;
    if (typeof b.message === 'string' && b.message && !HTTP_DEFAULT_MESSAGES.has(b.message)) {
      return b.message;
    }
    if (Array.isArray(b.message) && typeof b.message[0] === 'string') return b.message[0];
  }
  return fallbackMessage(status);
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  store: TokenStore;
  fetch?: Fetch;
  /** Called once the refresh token is rejected: the user must sign in again. */
  onSessionExpired?: () => void;
  now?: () => number;
  timeoutMs?: number;
  /**
   * Called with the server's clock (the HTTP Date header, ms) and the local time the answer
   * arrived, so offer countdowns survive a phone whose clock is wrong.
   */
  onServerTime?: (serverMs: number, localMs: number) => void;
}

export interface RequestOptions {
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
  signal?: AbortSignal;
}

/** Refresh a little before the access token actually expires. */
const EXPIRY_SKEW_MS = 30_000;

export function toTokens(pair: TokenPair, now: number): Tokens {
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    accessExpiresAt: now + pair.accessTokenExpiresIn * 1000,
  };
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 20_000;

  /** undefined: not loaded from the store yet. */
  let tokens: Tokens | null | undefined;
  let refreshing: Promise<Tokens | null> | null = null;

  async function current(): Promise<Tokens | null> {
    if (tokens === undefined) tokens = await options.store.load();
    return tokens;
  }

  async function send(
    method: string,
    path: string,
    body: unknown,
    accessToken: string | null,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    try {
      const res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const date = options.onServerTime ? res.headers?.get?.('date') : null;
      const serverMs = date ? Date.parse(date) : Number.NaN;
      if (Number.isFinite(serverMs)) options.onServerTime?.(serverMs, now());
      return res;
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(0, NETWORK_ERROR_MESSAGE);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    const text = res.status === 204 ? '' : await res.text().catch(() => '');
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    if (!res.ok) throw new ApiError(res.status, messageFromBody(res.status, body), body);
    return (body ?? undefined) as T;
  }

  async function expire(): Promise<void> {
    tokens = null;
    await options.store.clear();
    options.onSessionExpired?.();
  }

  /**
   * Exchanges `used` for a new pair. Concurrent callers share one request: the
   * API revokes the whole session when a rotated refresh token is presented
   * again, so two parallel refreshes would sign the driver out.
   */
  function refresh(used: Tokens): Promise<Tokens | null> {
    if (refreshing) return refreshing;
    if (tokens && tokens.refreshToken !== used.refreshToken) return Promise.resolve(tokens);
    const run = async (): Promise<Tokens | null> => {
      const res = await send('POST', '/v1/auth/refresh', { refreshToken: used.refreshToken }, null);
      if (res.status === 401) {
        await expire();
        return null;
      }
      const pair = await parse<TokenPair>(res);
      const next = toTokens(pair, now());
      tokens = next;
      await options.store.save(next);
      return next;
    };
    refreshing = run().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let used: Tokens | null = null;
    if (auth) {
      used = refreshing ? await refreshing : await current();
      if (!used) throw new ApiError(401, fallbackMessage(401));
      if (used.accessExpiresAt - EXPIRY_SKEW_MS <= now()) {
        used = await refresh(used);
        if (!used) throw new ApiError(401, fallbackMessage(401));
      }
    }
    let res = await send(method, path, opts.body, used?.accessToken ?? null, opts.signal);
    if (res.status === 401 && used) {
      // another request may already have rotated the pair while this one was out
      const latest = await current();
      const fresh =
        latest && latest.accessToken !== used.accessToken ? latest : await refresh(used);
      if (!fresh) throw new ApiError(401, fallbackMessage(401));
      res = await send(method, path, opts.body, fresh.accessToken, opts.signal);
      if (res.status === 401) await expire();
    }
    return parse<T>(res);
  }

  return {
    baseUrl,
    request,
    get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
    post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>('POST', path, { ...opts, body }),
    patch: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      request<T>('PATCH', path, { ...opts, body }),
    delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),

    async hasSession(): Promise<boolean> {
      return (await current()) !== null;
    },

    /** Stores the pair returned by a successful sign-in. */
    async signIn(pair: TokenPair): Promise<void> {
      tokens = toTokens(pair, now());
      await options.store.save(tokens);
    },

    /** Revokes the session on the server when reachable; always forgets it locally. */
    async signOut(): Promise<void> {
      const t = await current();
      tokens = null;
      await options.store.clear();
      if (t) {
        await send('POST', '/v1/auth/logout', { refreshToken: t.refreshToken }, null).catch(
          () => undefined,
        );
      }
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
