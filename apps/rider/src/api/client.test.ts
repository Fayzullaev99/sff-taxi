import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  buildUrl,
  createApiClient,
  defaultRetryDelayMs,
  errorMessage,
  OfflineError,
  type SessionTokens,
  type TokenStore,
} from './client';

function memoryStore(initial: SessionTokens | null): TokenStore & { value: SessionTokens | null } {
  const store = {
    value: initial,
    get: () => store.value,
    set: (t: SessionTokens | null) => {
      store.value = t;
    },
  };
  return store;
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (url: string, init: RequestInit) => Promise<Response> | Response;

function fakeFetch(handler: Handler) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const auth = (init: RequestInit) => (init.headers as Record<string, string>).Authorization;

describe('api client', () => {
  it('sends the bearer token and parses JSON', async () => {
    const tokens = memoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(api.request('/v1/me')).resolves.toEqual({ ok: true });
    expect(auth(calls[0]!.init)).toBe('Bearer a1');
  });

  it('refreshes once for concurrent 401s and retries with the new token', async () => {
    const tokens = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
    let refreshCalls = 0;
    const { fetch, calls } = fakeFetch(async (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshCalls++;
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: 'r1' });
        await new Promise((r) => setTimeout(r, 10));
        return json(200, { accessToken: 'new', refreshToken: 'r2', accessTokenExpiresIn: 900 });
      }
      return auth(init) === 'Bearer new' ? json(200, { url }) : json(401, { message: 'no' });
    });
    const onSignedOut = vi.fn();
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, onSignedOut });

    const results = await Promise.all([
      api.request<{ url: string }>('/v1/a'),
      api.request<{ url: string }>('/v1/b'),
      api.request<{ url: string }>('/v1/c'),
    ]);

    expect(results.map((r) => r.url)).toEqual(['http://x/v1/a', 'http://x/v1/b', 'http://x/v1/c']);
    expect(refreshCalls).toBe(1);
    expect(tokens.value).toEqual({ accessToken: 'new', refreshToken: 'r2' });
    expect(onSignedOut).not.toHaveBeenCalled();
    // 3 failed + 1 refresh + 3 retries
    expect(calls).toHaveLength(7);
  });

  it('refreshes a stale token on an optional-auth route and retries', async () => {
    const tokens = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
    const { fetch } = fakeFetch((url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        return json(200, { accessToken: 'new', refreshToken: 'r2', accessTokenExpiresIn: 900 });
      }
      return auth(init) === 'Bearer new' ? json(200, { signedIn: true }) : json(401, {});
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(
      api.request('/v1/geo/reverse', { method: 'POST', body: {}, auth: 'optional' }),
    ).resolves.toEqual({ signedIn: true });
  });

  it('asks anonymously on an optional-auth route once the session is gone', async () => {
    const tokens = memoryStore({ accessToken: 'old', refreshToken: 'dead' });
    const onSignedOut = vi.fn();
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/v1/auth/refresh')) return json(401, {});
      return auth(init) ? json(401, {}) : json(200, { anonymous: true });
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, onSignedOut });
    await expect(
      api.request('/v1/geo/reverse', { method: 'POST', body: {}, auth: 'optional' }),
    ).resolves.toEqual({ anonymous: true });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(auth(calls.at(-1)!.init)).toBeUndefined();
  });

  it('retries without refreshing when another request already rotated the token', async () => {
    const tokens = memoryStore({ accessToken: 'old', refreshToken: 'r1' });
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/refresh')) throw new Error('must not refresh');
      if (auth(init) === 'Bearer old') {
        tokens.set({ accessToken: 'rotated', refreshToken: 'r2' });
        return json(401, {});
      }
      return json(200, { token: auth(init) });
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(api.request('/v1/me')).resolves.toEqual({ token: 'Bearer rotated' });
    expect(calls).toHaveLength(2);
  });

  it('signs out when the refresh token is rejected', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch } = fakeFetch((url) =>
      url.endsWith('/refresh') ? json(401, { message: 'Unauthorized' }) : json(401, {}),
    );
    const onSignedOut = vi.fn();
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, onSignedOut });

    const error = await api.request('/v1/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(tokens.value).toBeNull();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh cannot reach the server', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch } = fakeFetch((url) => {
      if (url.endsWith('/refresh')) throw new TypeError('Network request failed');
      return json(401, {});
    });
    const onSignedOut = vi.fn();
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, onSignedOut });

    await expect(api.request('/v1/me')).rejects.toBeInstanceOf(OfflineError);
    expect(tokens.value).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('shares one refresh between concurrent explicit callers', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch, calls } = fakeFetch(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return json(200, { accessToken: 'b', refreshToken: 's', accessTokenExpiresIn: 1 });
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    const outcomes = await Promise.all([api.refresh(), api.refresh()]);
    expect(outcomes).toEqual(['ok', 'ok']);
    expect(calls).toHaveLength(1);
    // a later refresh is a new request with the rotated token
    await api.refresh();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ refreshToken: 's' });
  });

  it('never sends two refreshes at once and never reuses a rotated refresh token', async () => {
    const tokens = memoryStore({ accessToken: 'a0', refreshToken: 'r0' });
    const used: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    let n = 0;
    const { fetch } = fakeFetch(async (url, init) => {
      if (url.endsWith('/refresh')) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const sent = (JSON.parse(String(init.body)) as { refreshToken: string }).refreshToken;
        used.push(sent);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        n++;
        return json(200, { accessToken: `a${n}`, refreshToken: `r${n}` });
      }
      // only the newest access token works: requests answered after a rotation get 401
      await new Promise((r) => setTimeout(r, Math.random() * 4));
      const token = auth(init)?.slice(7);
      return token === tokens.value?.accessToken ? json(200, {}) : json(401, {});
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    // SSE tickets, queries and explicit refreshes all mixed together
    await Promise.all([
      ...Array.from({ length: 12 }, (_, i) =>
        api.request(i % 3 ? '/v1/rides/current' : '/v1/stream/ticket').catch(() => undefined),
      ),
      api.refresh(),
      api.refresh(),
    ]);
    expect(maxInFlight).toBe(1);
    expect(new Set(used).size).toBe(used.length);
  });

  it('waits for the gate (the app in the foreground) before refreshing', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const { fetch, calls } = fakeFetch((url, init) => {
      if (url.endsWith('/refresh')) return json(200, { accessToken: 'b', refreshToken: 's' });
      return auth(init) === 'Bearer b' ? json(200, { ok: 1 }) : json(401, {});
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, refreshGate: () => gate });
    const pending = api.request('/v1/me');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.map((c) => c.url)).toEqual(['http://x/v1/me']);
    open();
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(calls.map((c) => c.url)).toEqual([
      'http://x/v1/me',
      'http://x/v1/auth/refresh',
      'http://x/v1/me',
    ]);
  });

  it('persists the rotated pair before the retried request goes out', async () => {
    const order: string[] = [];
    const store = {
      value: { accessToken: 'a', refreshToken: 'r' } as SessionTokens | null,
      get: () => store.value,
      set: async (t: SessionTokens | null) => {
        store.value = t;
        await new Promise((r) => setTimeout(r, 5));
        order.push('persisted');
      },
    };
    const { fetch } = fakeFetch((url, init) => {
      if (url.endsWith('/refresh')) return json(200, { accessToken: 'b', refreshToken: 's' });
      order.push(`request ${auth(init)}`);
      return auth(init) === 'Bearer b' ? json(200, {}) : json(401, {});
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens: store, fetch });
    await api.request('/v1/me');
    expect(order).toEqual(['request Bearer a', 'persisted', 'request Bearer b']);
  });

  it('drops a refresh answer for a session that was replaced meanwhile', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch } = fakeFetch(async () => {
      // the rider signs in again while the old session's refresh is in flight
      tokens.value = { accessToken: 'fresh', refreshToken: 'fresh-r' };
      return json(200, { accessToken: 'b', refreshToken: 's' });
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(api.refresh()).resolves.toBe('ok');
    expect(tokens.value).toEqual({ accessToken: 'fresh', refreshToken: 'fresh-r' });
  });

  it('does not sign out a newer session when an old refresh token is rejected', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const onSignedOut = vi.fn();
    const { fetch } = fakeFetch(async () => {
      tokens.value = { accessToken: 'fresh', refreshToken: 'fresh-r' };
      return json(401, {});
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, onSignedOut });
    await expect(api.refresh()).resolves.toBe('ok');
    expect(tokens.value?.refreshToken).toBe('fresh-r');
    expect(onSignedOut).not.toHaveBeenCalled();
  });

  it('settles once the refresh in flight is done', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch } = fakeFetch(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return json(200, { accessToken: 'b', refreshToken: 's' });
    });
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    void api.refresh();
    await api.settled();
    expect(tokens.value?.refreshToken).toBe('s');
  });

  it('does not send tokens or refresh on public requests', async () => {
    const tokens = memoryStore({ accessToken: 'a', refreshToken: 'r' });
    const { fetch, calls } = fakeFetch(() => json(401, { message: 'x' }));
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(api.request('/v1/geo/cities', { auth: 'none' })).rejects.toBeInstanceOf(ApiError);
    expect(auth(calls[0]!.init)).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('fails fast without a session on protected requests', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, {}));
    const api = createApiClient({ baseUrl: 'http://x', tokens: memoryStore(null), fetch });
    await expect(api.request('/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(0);
  });

  it('turns network failures into OfflineError and API errors into messages', async () => {
    const tokens = memoryStore(null);
    const offline = createApiClient({
      baseUrl: 'http://x',
      tokens,
      fetch: fakeFetch(() => {
        throw new TypeError('Network request failed');
      }).fetch,
    });
    await expect(offline.request('/v1/x', { auth: 'none' })).rejects.toBeInstanceOf(OfflineError);

    const failing = createApiClient({
      baseUrl: 'http://x',
      tokens,
      fetch: fakeFetch(() =>
        json(400, { message: 'Ma’lumotlar noto‘g‘ri', issues: [{ path: 'phone', message: 'A' }] }),
      ).fetch,
    });
    await expect(failing.request('/v1/x', { auth: 'none' })).rejects.toMatchObject({
      status: 400,
      message: 'A',
    });
  });

  it('returns undefined for 204 responses', async () => {
    const api = createApiClient({
      baseUrl: 'http://x',
      tokens: memoryStore({ accessToken: 'a', refreshToken: 'r' }),
      fetch: fakeFetch(() => new Response(null, { status: 204 })).fetch,
    });
    await expect(api.request('/v1/devices/t1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('reachability', () => {
  it('reports offline on network failures and online on any answer', async () => {
    const seen: boolean[] = [];
    let down = true;
    const { fetch } = fakeFetch(() => {
      if (down) throw new TypeError('Network request failed');
      return json(500, {});
    });
    const api = createApiClient({
      baseUrl: 'http://x',
      tokens: memoryStore(null),
      fetch,
      onReachability: (online) => seen.push(online),
    });
    await expect(api.request('/v1/geo/config', { auth: 'none' })).rejects.toBeInstanceOf(
      OfflineError,
    );
    down = false;
    // a server error is still an answer: the phone is online
    await expect(api.request('/v1/geo/config', { auth: 'none' })).rejects.toBeInstanceOf(ApiError);
    expect(seen).toEqual([false, true]);
  });

  it('does not report a request the caller aborted', async () => {
    const seen: boolean[] = [];
    const controller = new AbortController();
    const { fetch } = fakeFetch(() => {
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    });
    const api = createApiClient({
      baseUrl: 'http://x',
      tokens: memoryStore(null),
      fetch,
      onReachability: (online) => seen.push(online),
    });
    await expect(
      api.request('/v1/geo/search', { auth: 'none', signal: controller.signal }),
    ).rejects.toBeDefined();
    expect(seen).toEqual([]);
  });
});

describe('helpers', () => {
  it('builds URLs with encoded, non-empty query params', () => {
    expect(
      buildUrl('http://x/', '/v1/geo/cities', { lat: 41.3, lng: 69.2, q: 'bozor & vokzal', c: '' }),
    ).toBe('http://x/v1/geo/cities?lat=41.3&lng=69.2&q=bozor%20%26%20vokzal');
  });

  it('picks the most useful error message', () => {
    expect(errorMessage(409, { message: 'Band' })).toBe('Band');
    expect(errorMessage(503, null)).toMatch(/Serverda/);
    expect(errorMessage(429, {})).toMatch(/Juda ko‘p/);
  });
});

describe('auth modes and status', () => {
  it('optional auth sends a token when there is one and never refreshes', async () => {
    const tokens = memoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }));
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await api.request('/v1/geo/reverse', { method: 'POST', auth: 'optional', body: {} });
    expect(auth(calls[0]!.init)).toBe('Bearer a1');

    tokens.set(null);
    await api.request('/v1/geo/reverse', { method: 'POST', auth: 'optional', body: {} });
    expect(auth(calls[1]!.init)).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('reports the HTTP status (201 new ride vs 200 repeated order)', async () => {
    const tokens = memoryStore({ accessToken: 'a1', refreshToken: 'r1' });
    const { fetch } = fakeFetch(() => json(201, { id: 'r1' }));
    const api = createApiClient({ baseUrl: 'http://x', tokens, fetch });
    await expect(
      api.requestWithStatus('/v1/rides/r1/cancel', { method: 'POST', body: {} }),
    ).resolves.toEqual({ status: 201, data: { id: 'r1' } });
  });
});

describe('timeouts and retries', () => {
  it('gives up after the request’s own timeout', async () => {
    vi.useFakeTimers();
    try {
      const tokens = memoryStore(null);
      const fetch = ((_: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof globalThis.fetch;
      const api = createApiClient({ baseUrl: 'http://x', tokens, fetch, timeoutMs: 20_000 });
      const result = api.request('/v1/geo/reverse', { auth: 'none', timeoutMs: 5_000 });
      const settled = expect(result).rejects.toBeInstanceOf(OfflineError);
      await vi.advanceTimersByTimeAsync(5_000);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a GET without an answer or with a gateway error, then succeeds', async () => {
    const tokens = memoryStore(null);
    let n = 0;
    const { fetch, calls } = fakeFetch(() => {
      n++;
      if (n === 1) throw new TypeError('Network request failed');
      if (n === 2) return json(503, {});
      return json(200, { ok: n });
    });
    const delays: number[] = [];
    const api = createApiClient({
      baseUrl: 'http://x',
      tokens,
      fetch,
      retryDelayMs: (a) => {
        delays.push(a);
        return 0;
      },
    });
    await expect(api.request('/v1/geo/reverse', { auth: 'none', retries: 2 })).resolves.toEqual({
      ok: 3,
    });
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([0, 1]);
  });

  it('never retries a POST, a client error or past the limit', async () => {
    const tokens = memoryStore(null);
    const offline = fakeFetch(() => {
      throw new TypeError('Network request failed');
    });
    const api = createApiClient({
      baseUrl: 'http://x',
      tokens,
      fetch: offline.fetch,
      retryDelayMs: () => 0,
    });
    await expect(
      api.request('/v1/auth/code', { method: 'POST', auth: 'none', body: {}, retries: 3 }),
    ).rejects.toBeInstanceOf(OfflineError);
    expect(offline.calls).toHaveLength(1);
    await expect(api.request('/v1/x', { auth: 'none', retries: 1 })).rejects.toBeInstanceOf(
      OfflineError,
    );
    expect(offline.calls).toHaveLength(3);

    const notFound = fakeFetch(() => json(404, { message: 'Topilmadi' }));
    const api2 = createApiClient({
      baseUrl: 'http://x',
      tokens,
      fetch: notFound.fetch,
      retryDelayMs: () => 0,
    });
    await expect(api2.request('/v1/x', { auth: 'none', retries: 3 })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(notFound.calls).toHaveLength(1);
  });

  it('backs off exponentially with jitter, capped', () => {
    expect(defaultRetryDelayMs(0, 0)).toBe(500);
    expect(defaultRetryDelayMs(1, 0)).toBe(1_000);
    expect(defaultRetryDelayMs(2, 1)).toBe(3_000);
    expect(defaultRetryDelayMs(10, 0)).toBe(8_000);
    expect(defaultRetryDelayMs(10, 1)).toBe(12_000);
  });
});
