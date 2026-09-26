import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EskizSmsProvider } from './eskiz.provider.js';
import { newMessageId, PlaymobileSmsProvider } from './playmobile.provider.js';
import { SmsDeliveryError } from './sms.provider.js';

// Contract tests: a local HTTP server stands in for the provider and records
// exactly what the adapter sends, so the wire format is checked against the
// provider documentation without real credentials.

interface Recorded {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Reply = { status: number; body: unknown };

let server: Server | undefined;

async function stub(
  handler: (req: Recorded) => Reply,
): Promise<{ baseUrl: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const recorded = { method: req.method!, path: req.url!, headers: req.headers, body };
      requests.push(recorded);
      const reply = handler(recorded);
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, requests };
}

/** Extracts fields from a multipart/form-data body. */
function formFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const m of body.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) fields[m[1]!] = m[2]!;
  return fields;
}

afterEach(async () => {
  if (!server) return;
  const closing = server;
  server = undefined;
  closing.closeAllConnections(); // fetch keeps connections alive
  await new Promise((resolve) => closing.close(resolve));
});

describe('EskizSmsProvider', () => {
  const credentials = { email: 'ops@example.uz', password: 's3cret', from: '4546' };

  it('logs in, then sends with the bearer token in Eskiz format', async () => {
    const { baseUrl, requests } = await stub((req) =>
      req.path === '/api/auth/login'
        ? {
            status: 200,
            body: { message: 'token_generated', data: { token: 'tok-1' }, token_type: 'bearer' },
          }
        : {
            status: 200,
            body: { id: 'eskiz-msg-1', message: 'Waiting for SMS provider', status: 'waiting' },
          },
    );
    const provider = new EskizSmsProvider({ baseUrl, ...credentials });

    const receipt = await provider.send({ to: '+998901234567', text: 'Kod 123456' });

    expect(receipt).toEqual({ provider: 'eskiz', providerMessageId: 'eskiz-msg-1' });
    const [login, send] = requests;
    expect(login?.method).toBe('POST');
    expect(formFields(login!.body)).toEqual({ email: 'ops@example.uz', password: 's3cret' });
    expect(send?.path).toBe('/api/message/sms/send');
    expect(send?.headers.authorization).toBe('Bearer tok-1');
    expect(formFields(send!.body)).toEqual({
      mobile_phone: '998901234567',
      message: 'Kod 123456',
      from: '4546',
    });
  });

  it('reuses the token across sends', async () => {
    const { baseUrl, requests } = await stub((req) =>
      req.path === '/api/auth/login'
        ? { status: 200, body: { data: { token: 'tok-1' } } }
        : { status: 200, body: { id: 'x', status: 'waiting' } },
    );
    const provider = new EskizSmsProvider({ baseUrl, ...credentials });
    await provider.send({ to: '+998901234567', text: 'a' });
    await provider.send({ to: '+998901234567', text: 'b' });
    expect(requests.filter((r) => r.path === '/api/auth/login')).toHaveLength(1);
  });

  it('logs in again once when the token has expired', async () => {
    let logins = 0;
    const { baseUrl, requests } = await stub((req) => {
      if (req.path === '/api/auth/login') {
        logins += 1;
        return { status: 200, body: { data: { token: `tok-${logins}` } } };
      }
      return req.headers.authorization === 'Bearer tok-1'
        ? { status: 401, body: { message: 'Expired' } }
        : { status: 200, body: { id: 'after-relogin', status: 'waiting' } };
    });
    const provider = new EskizSmsProvider({ baseUrl, ...credentials });

    const receipt = await provider.send({ to: '+998901234567', text: 'a' });

    expect(receipt.providerMessageId).toBe('after-relogin');
    expect(requests.map((r) => r.path)).toEqual([
      '/api/auth/login',
      '/api/message/sms/send',
      '/api/auth/login',
      '/api/message/sms/send',
    ]);
  });

  it('reports a rejected send without leaking credentials', async () => {
    const { baseUrl } = await stub((req) =>
      req.path === '/api/auth/login'
        ? { status: 200, body: { data: { token: 'tok-1' } } }
        : { status: 400, body: { message: 'Template not approved', status: 'error' } },
    );
    const provider = new EskizSmsProvider({ baseUrl, ...credentials });

    const error = await provider.send({ to: '+998901234567', text: 'a' }).catch((e) => e);
    expect(error).toBeInstanceOf(SmsDeliveryError);
    expect(error.httpStatus).toBe(400);
    expect(error.message).toContain('Template not approved');
    expect(error.message).not.toContain('s3cret');
  });

  it('fails clearly when login is refused', async () => {
    const { baseUrl } = await stub(() => ({
      status: 401,
      body: { message: 'Invalid credentials' },
    }));
    const provider = new EskizSmsProvider({ baseUrl, ...credentials });
    await expect(provider.send({ to: '+998901234567', text: 'a' })).rejects.toThrow(
      /eskiz: login failed/,
    );
  });
});

describe('PlaymobileSmsProvider', () => {
  const credentials = { username: 'sff', password: 'pm-pass', originator: '3700' };

  it('posts the broker JSON with basic auth', async () => {
    const { baseUrl, requests } = await stub(() => ({ status: 200, body: 'Request is received' }));
    const provider = new PlaymobileSmsProvider({
      baseUrl: `${baseUrl}/broker-api`,
      ...credentials,
    });

    const receipt = await provider.send({ to: '+998901234567', text: 'Kod 123456' });

    const [req] = requests;
    expect(req?.method).toBe('POST');
    expect(req?.path).toBe('/broker-api/send');
    expect(req?.headers.authorization).toBe(
      `Basic ${Buffer.from('sff:pm-pass').toString('base64')}`,
    );
    expect(req?.headers['content-type']).toMatch(/^application\/json/);
    const body = JSON.parse(req!.body);
    expect(body).toEqual({
      messages: [
        {
          recipient: '998901234567',
          'message-id': receipt.providerMessageId,
          sms: { originator: '3700', content: { text: 'Kod 123456' } },
        },
      ],
    });
  });

  it('surfaces broker error codes', async () => {
    const { baseUrl } = await stub(() => ({
      status: 400,
      body: { error_code: '202', error_description: 'Empty recipient' },
    }));
    const provider = new PlaymobileSmsProvider({ baseUrl, ...credentials });
    await expect(provider.send({ to: '+998901234567', text: 'a' })).rejects.toThrow(
      /Empty recipient/,
    );
  });

  it('generates message ids within the 20-character limit', () => {
    const ids = new Set(Array.from({ length: 1000 }, newMessageId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(20);
  });

  it('turns network failures into delivery errors', async () => {
    const provider = new PlaymobileSmsProvider({ baseUrl: 'http://127.0.0.1:9', ...credentials });
    await expect(provider.send({ to: '+998901234567', text: 'a' })).rejects.toBeInstanceOf(
      SmsDeliveryError,
    );
  });
});
