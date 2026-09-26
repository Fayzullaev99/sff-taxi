import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  messageFromBody,
  NETWORK_ERROR_MESSAGE,
  type Tokens,
  type TokenStore,
} from './api-client';

const NOW = 1_800_000_000_000;

function memoryStore(initial: Tokens | null) {
  let value = initial;
  const store: TokenStore & { value: () => Tokens | null } = {
    load: vi.fn(async () => value),
    save: vi.fn(async (t: Tokens) => {
      value = t;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
    value: () => value,
  };
  return store;
}

function json(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface Call {
  url: string;
  method: string;
  auth: string | null;
  body: unknown;
}

/**
 * A fake API: `/v1/auth/refresh` rotates "rN" -> "aN+1"/"rN+1" (optionally
 * after a delay); other routes answer 200 for the current access token, 401 otherwise.
 */
function fakeApi(opts: { refreshStatus?: number; refreshDelayMs?: number } = {}) {
  const calls: Call[] = [];
  let generation = 1;
  const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const call = { url, method: init.method ?? 'GET', auth: headers.Authorization ?? null, body };
    calls.push(call);
    if (url.endsWith('/v1/auth/refresh')) {
      if (opts.refreshDelayMs) await new Promise((r) => setTimeout(r, opts.refreshDelayMs));
      if (opts.refreshStatus) return json(opts.refreshStatus, { statusCode: opts.refreshStatus });
      if ((body as { refreshToken: string }).refreshToken !== `r${generation}`) {
        return json(401, { statusCode: 401, message: 'Unauthorized' });
      }
      generation++;
      return json(200, {
        accessToken: `a${generation}`,
        accessTokenExpiresIn: 900,
        refreshToken: `r${generation}`,
      });
    }
    if (url.endsWith('/v1/auth/logout')) return json(204);
    if (call.auth !== `Bearer a${generation}`) {
      return json(401, { statusCode: 401, message: 'Unauthorized' });
    }
    return json(200, { ok: true, url });
  });
  return { fetch, calls, generation: () => generation };
}

const valid: Tokens = { accessToken: 'a1', refreshToken: 'r1', accessExpiresAt: NOW + 600_000 };

function client(store: TokenStore, api: ReturnType<typeof fakeApi>, onSessionExpired = vi.fn()) {
  return createApiClient({
    baseUrl: 'http://api.test/',
    store,
    fetch: api.fetch,
    now: () => NOW,
    onSessionExpired,
  });
}

describe('api client', () => {
  it('sends the access token and parses JSON', async () => {
    const api = fakeApi();
    const c = client(memoryStore(valid), api);
    await expect(c.get('/v1/driver/me')).resolves.toMatchObject({ ok: true });
    expect(api.calls[0]).toMatchObject({
      url: 'http://api.test/v1/driver/me',
      method: 'GET',
      auth: 'Bearer a1',
    });
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    const api = fakeApi();
    const store = memoryStore(valid);
    const c = client(store, api);
    // the server already moved on (e.g. the token was revoked by expiry)
    api.fetch.mockImplementationOnce(async () => json(401, { statusCode: 401 }));
    await expect(c.get('/v1/driver/me')).resolves.toMatchObject({ ok: true });
    expect(api.fetch.mock.calls.map(([url]) => url.replace('http://api.test', ''))).toEqual([
      '/v1/driver/me',
      '/v1/auth/refresh',
      '/v1/driver/me',
    ]);
    expect(store.value()).toEqual({
      accessToken: 'a2',
      refreshToken: 'r2',
      accessExpiresAt: NOW + 900_000,
    });
  });

  it('shares a single refresh between concurrent requests', async () => {
    const api = fakeApi({ refreshDelayMs: 20 });
    const expired = { ...valid, accessExpiresAt: NOW - 1 };
    const c = client(memoryStore(expired), api);
    const results = await Promise.all([
      c.get('/v1/driver/me'),
      c.get('/v1/driver/rides/current'),
      c.get('/v1/driver/offers'),
    ]);
    expect(results).toHaveLength(3);
    expect(api.calls.filter((x) => x.url.endsWith('/v1/auth/refresh'))).toHaveLength(1);
    expect(api.calls.filter((x) => x.auth === 'Bearer a2')).toHaveLength(3);
  });

  it('does not refresh again when another request already rotated the tokens', async () => {
    let refreshes = 0;
    const fetch = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (url.endsWith('/v1/auth/refresh')) {
        // presenting r1 twice would revoke the session
        if (refreshes++) return json(401, { statusCode: 401 });
        return json(200, { accessToken: 'a2', accessTokenExpiresIn: 900, refreshToken: 'r2' });
      }
      if (auth === 'Bearer a2') return json(200, { ok: true });
      // a1 is stale; /b's 401 arrives after /a has already refreshed
      if (url.endsWith('/b')) await new Promise((r) => setTimeout(r, 30));
      return json(401, { statusCode: 401 });
    });
    const expired = vi.fn();
    const c = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(valid),
      fetch,
      now: () => NOW,
      onSessionExpired: expired,
    });
    await expect(Promise.all([c.get('/v1/a'), c.get('/v1/b')])).resolves.toHaveLength(2);
    expect(refreshes).toBe(1);
    expect(expired).not.toHaveBeenCalled();
  });

  it('signs out when the refresh token is rejected', async () => {
    const api = fakeApi({ refreshStatus: 401 });
    const store = memoryStore({ ...valid, accessExpiresAt: NOW - 1 });
    const expired = vi.fn();
    const c = client(store, api, expired);
    const error = await c.get('/v1/driver/me').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect(expired).toHaveBeenCalledOnce();
    expect(store.value()).toBeNull();
    await expect(c.hasSession()).resolves.toBe(false);
  });

  it('keeps the session when the refresh fails for another reason', async () => {
    const api = fakeApi({ refreshStatus: 503 });
    const store = memoryStore({ ...valid, accessExpiresAt: NOW - 1 });
    const expired = vi.fn();
    const c = client(store, api, expired);
    await expect(c.get('/v1/driver/me')).rejects.toMatchObject({ status: 503 });
    expect(expired).not.toHaveBeenCalled();
    expect(store.value()).not.toBeNull();
  });

  it('turns network failures into a status-0 error', async () => {
    const store = memoryStore(valid);
    const c = createApiClient({
      baseUrl: 'http://api.test',
      store,
      fetch: async () => {
        throw new TypeError('Network request failed');
      },
      now: () => NOW,
    });
    const error = (await c.get('/v1/driver/me').catch((e: unknown) => e)) as ApiError;
    expect(error.isNetwork).toBe(true);
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('surfaces the API message on errors', async () => {
    const c = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(valid),
      fetch: async () => json(409, { statusCode: 409, message: 'Buyurtmani boshqa kuryer oldi' }),
      now: () => NOW,
    });
    await expect(c.post('/v1/driver/offers/x/accept')).rejects.toMatchObject({
      status: 409,
      message: 'Buyurtmani boshqa kuryer oldi',
    });
  });

  it('fails fast without a session and signs in/out', async () => {
    const api = fakeApi();
    const store = memoryStore(null);
    const c = client(store, api);
    await expect(c.get('/v1/driver/me')).rejects.toMatchObject({ status: 401 });
    expect(api.calls).toHaveLength(0);

    await c.signIn({ accessToken: 'a1', accessTokenExpiresIn: 900, refreshToken: 'r1' });
    await expect(c.get('/v1/driver/me')).resolves.toMatchObject({ ok: true });
    await c.signOut();
    expect(store.value()).toBeNull();
    expect(api.calls.at(-1)).toMatchObject({
      url: 'http://api.test/v1/auth/logout',
      body: { refreshToken: 'r1' },
    });
  });

  it('sends public requests without a token', async () => {
    const api = fakeApi();
    api.fetch.mockImplementationOnce(async () => json(202, { resendAfterSeconds: 60 }));
    const c = client(memoryStore(null), api);
    await expect(
      c.post('/v1/auth/code', { phone: '+998901234567' }, { auth: false }),
    ).resolves.toEqual({ resendAfterSeconds: 60 });
  });
});

describe('messageFromBody', () => {
  it('prefers validation issues, then the message, then an Uzbek default', () => {
    expect(
      messageFromBody(400, {
        message: 'Ma’lumotlar noto‘g‘ri',
        issues: [{ path: 'phone', message: 'O‘zbekiston raqamini kiriting' }],
      }),
    ).toBe('O‘zbekiston raqamini kiriting');
    expect(messageFromBody(403, { message: 'Avval smenaga chiqing' })).toBe(
      'Avval smenaga chiqing',
    );
    expect(messageFromBody(404, { message: 'Not Found' })).toBe('Topilmadi');
    expect(messageFromBody(502, 'Bad gateway')).toMatch(/Serverda xatolik/);
  });
});

describe('server time', () => {
  it('reports the Date header so offer countdowns run on the server clock', async () => {
    const seen: [number, number][] = [];
    const c = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(null),
      now: () => NOW,
      fetch: async () =>
        new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json', Date: 'Sat, 26 Sep 2026 10:00:00 GMT' },
        }),
      onServerTime: (server, local) => seen.push([server, local]),
    });
    await c.get('/v1/tariffs', { auth: false });
    expect(seen).toEqual([[Date.parse('2026-09-26T10:00:00Z'), NOW]]);
  });

  it('ignores a missing or broken Date header', async () => {
    const seen: number[] = [];
    const c = createApiClient({
      baseUrl: 'http://api.test',
      store: memoryStore(null),
      fetch: async () => new Response('{}', { status: 200, headers: { Date: 'nonsense' } }),
      onServerTime: (server) => seen.push(server),
    });
    await c.get('/x', { auth: false });
    expect(seen).toEqual([]);
  });
});
