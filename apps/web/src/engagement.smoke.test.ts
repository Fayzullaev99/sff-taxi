/**
 * Mounts the rider-engagement screens (promo codes, referrals, their rules, a ride's chat) against a
 * mocked API, like app.smoke.test.ts does for the rest of the panel, and drives the
 * operator's flows: create a code, switch one off, revoke a referral, save the rules.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionStore } from './api/client';
import type { AdminPromo, PromoRules, Referral } from './api/promo-types';
import Promos from './promos/Promos';
import { RideChat } from './rides/RideChat';
import { RideTip } from './rides/RideTip';
import { FeedbackProvider } from './ui/feedback';

type Init = RequestInit | undefined;
const method = (init: Init) => init?.method ?? 'GET';
const body = (init: Init) =>
  (init?.body ? JSON.parse(String(init.body)) : {}) as Record<string, unknown>;

const promo: AdminPromo = {
  id: '01a0de48-6666-7000-8000-0000000000a1',
  code: 'KUZ20',
  kind: 'percent',
  value: 20,
  maxDiscount: 5000,
  minFare: 0,
  validFrom: null,
  validUntil: '2030-01-01T00:00:00.000Z',
  usageLimit: 500,
  perRiderLimit: 1,
  firstRideOnly: false,
  services: [],
  classes: [],
  cityId: null,
  isActive: true,
  description: 'Kuzgi aksiya',
  descriptionRu: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  stats: { redeemed: 12, reserved: 2, discountTotal: 16_800, saved: 30 },
};
const referral: Referral = {
  id: '01a0de48-6666-7000-8000-0000000000b1',
  code: 'ABC234',
  status: 'rewarded',
  rewardAmount: 10_000,
  rewardRideId: '01a0de48-0000-7000-8000-000000000001',
  rewardedAt: '2026-10-10T10:00:00.000Z',
  revokedAt: null,
  revokeNote: null,
  deviceId: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  referrerId: 'u1',
  referrerPhone: '+998901112233',
  referrerName: 'Dilnoza',
  inviteeId: 'u2',
  inviteePhone: '+998907778899',
  inviteeName: 'Kamola',
};
const rules: PromoRules = {
  referral_enabled: true,
  invitee_discount_percent: 50,
  invitee_max_discount: 10_000,
  invitee_rides: 1,
  referrer_bonus: 10_000,
  monthly_reward_cap: 10,
  credit_max_percent: 50,
  min_rider_pays: 1000,
  invite_url: 'https://taxi.sff.uz/invite',
};

const routes: [RegExp, (init: Init, path: string) => unknown][] = [
  [
    /^\/v1\/admin\/promos\/[^/]+$/,
    (init) =>
      method(init) === 'PATCH'
        ? { ...promo, ...body(init) }
        : {
            ...promo,
            rides: [
              {
                rideId: '01a0de48-0000-7000-8000-000000000001',
                number: 1001,
                riderPhone: '+998901112233',
                class: 'economy',
                fare: 7000,
                paymentMethod: 'cash',
                rideStatus: 'completed',
                discount: 1400,
                status: 'redeemed',
                createdAt: '2026-10-10T10:00:00.000Z',
              },
            ],
          },
  ],
  [
    /^\/v1\/admin\/promos$/,
    (init) => (method(init) === 'POST' ? { ...promo, ...body(init), id: 'new' } : [promo]),
  ],
  [/^\/v1\/admin\/referrals\/[^/]+\/revoke$/, () => ({ ...referral, status: 'revoked' })],
  [/^\/v1\/admin\/referrals$/, () => ({ items: [referral], nextCursor: null })],
  [/^\/v1\/admin\/settings\/promo$/, (init) => (method(init) === 'PUT' ? body(init) : rules)],
  [
    /^\/v1\/admin\/rides\/[^/]+\/tip$/,
    () => ({
      tip: {
        id: 't1',
        rideId: 'r1',
        amount: 5000,
        method: 'card',
        status: 'paid',
        paidAt: '2026-10-10T10:30:00.000Z',
        createdAt: '2026-10-10T10:29:00.000Z',
        payments: [{ id: 'i1', amount: 5000, status: 'paid', provider: 'payme' }],
      },
    }),
  ],
  [
    /^\/v1\/admin\/rides\/[^/]+\/messages$/,
    () => ({
      rideId: 'r1',
      writable: true,
      messages: [
        {
          id: 'm1',
          authorRole: 'driver',
          authorId: 'd1',
          authorName: 'Aziz Karimov',
          authorPhone: '+998901234001',
          driverId: 'd1',
          text: 'Yetib keldim',
          quickReply: 'arrived',
          readAt: '2026-10-10T10:01:00.000Z',
          createdAt: '2026-10-10T10:00:00.000Z',
        },
        {
          id: 'm2',
          authorRole: 'rider',
          authorId: 'u1',
          authorName: 'Dilnoza',
          authorPhone: '+998901112233',
          driverId: 'd1',
          text: 'Podyezd 3, chiqyapman',
          quickReply: null,
          readAt: null,
          createdAt: '2026-10-10T10:02:00.000Z',
        },
      ],
    }),
  ],
];

const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
const unmatched: string[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const pathOnly = path.split('?')[0]!;
      calls.push({ path, method: method(init), body: body(init) });
      const hit = routes.find(([re]) => re.test(pathOnly));
      if (!hit) unmatched.push(path);
      return new Response(JSON.stringify(hit ? hit[1](init, path) : { message: 'not mocked' }), {
        status: hit ? 200 : 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  sessionStore.set({ accessToken: 'a', refreshToken: 'r' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  calls.length = 0;
});

async function settle(rounds = 12) {
  for (let i = 0; i < rounds; i++) await act(() => new Promise((r) => setTimeout(r, 20)));
}

async function render(element: ReactElement, path = '/promos'): Promise<string> {
  container = document.createElement('div');
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(FeedbackProvider, null, element),
        ),
      ),
    );
  });
  await settle();
  return document.body.textContent ?? '';
}

function button(text: string): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>('button, a, label')].filter((b) =>
    (b.textContent ?? '').includes(text),
  );
  const hit = all[all.length - 1];
  if (!hit) throw new Error(`no button "${text}"`);
  return hit;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle(4);
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const sent = (path: string | RegExp, verb: string) =>
  calls.filter(
    (c) => c.method === verb && (typeof path === 'string' ? c.path === path : path.test(c.path)),
  );

describe('promo codes and referrals in the panel', () => {
  it('lists codes with their use and opens one with its rides', async () => {
    const text = await render(createElement(Promos));
    for (const t of [
      'Promokodlar va takliflar',
      'KUZ20',
      '20% (5 000 so‘mgacha)',
      '14 / 500',
      '16 800 so‘m',
      'Faol',
    ]) {
      expect(text).toContain(t);
    }
    await click(button('KUZ20'));
    expect(document.body.textContent).toContain('#1001');
    expect(document.body.textContent).toContain('−1 400 so‘m');
  });

  it('creates a fixed-amount code for comfort only', async () => {
    await render(createElement(Promos));
    await click(button('Yangi promokod'));
    const dialog = document.querySelector('dialog')!;
    const [code] = [...dialog.querySelectorAll<HTMLInputElement>('input:not([type])')];
    await typeInto(code!, 'yangi5');
    await click(button('Summa'));
    const value = dialog.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"]')[0]!;
    await typeInto(value, '5000');
    await click(button('Komfort'));
    // the Russian wording riders of Russian apps see (the Uzbek one is optional too)
    const ru = [...dialog.querySelectorAll('label')].find(
      (l) => l.textContent === 'Tavsif (ruscha)',
    )!;
    await typeInto(document.getElementById(ru.htmlFor) as HTMLInputElement, 'Новичкам 5 000');
    await click(button('Saqlash'));
    const [post] = sent('/v1/admin/promos', 'POST');
    expect(post?.body).toMatchObject({
      code: 'YANGI5',
      kind: 'fixed',
      value: 5000,
      maxDiscount: null,
      classes: ['comfort'],
      isActive: true,
      description: null,
      descriptionRu: 'Новичкам 5 000',
    });
  });

  it('switches a code off after confirmation', async () => {
    await render(createElement(Promos));
    await click(button('Tahrirlash'));
    await click(button('Yoqilgan'));
    await click(button('Saqlash'));
    expect(document.body.textContent).toContain('KUZ20 o‘chirilsinmi?');
    await click(button('O‘chirish'));
    const [patch] = sent(/^\/v1\/admin\/promos\/.+$/, 'PATCH');
    expect(patch?.body).toMatchObject({ code: 'KUZ20', isActive: false });
  });

  it('revokes a referral with a reason', async () => {
    const text = await render(createElement(Promos), '/promos?tab=referrals');
    expect(text).toContain('+998 90 111 22 33');
    expect(text).toContain('Bonus berildi');
    await click(button('Bekor qilish'));
    await click(button('Bitta odam, ikki raqam'));
    const dialogs = [...document.querySelectorAll('dialog')];
    const confirmButton = [...dialogs.at(-1)!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Bekor qilish' && b.className.includes('danger'),
    )!;
    await click(confirmButton);
    const [post] = sent(/\/revoke$/, 'POST');
    expect(post?.body).toEqual({ note: 'Bitta odam, ikki raqam' });
  });

  it('saves the referral and credit rules', async () => {
    const text = await render(createElement(Promos), '/promos?tab=settings');
    expect(text).toContain('Taklif dasturi yoqilgan');
    await click(button('Saqlash'));
    const [put] = sent('/v1/admin/settings/promo', 'PUT');
    expect(put?.body).toEqual(rules);
  });

  it('shows a ride’s chat to operators, read-only', async () => {
    const text = await render(createElement(RideChat, { rideId: 'r1' }));
    for (const t of [
      'Suhbat (2)',
      'Suhbat ochiq',
      'Haydovchi',
      'Aziz Karimov',
      'Yetib keldim',
      'tezkor javob',
      'o‘qildi 15:01',
      'Podyezd 3, chiqyapman',
      '+998 90 111 22 33',
    ]) {
      expect(text).toContain(t);
    }
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('shows a ride’s tip, whole to the driver', async () => {
    const text = await render(createElement(RideTip, { rideId: 'r1' }));
    for (const t of ['Choychaqa', '5 000 so‘m', 'Kartadan to‘landi', 'komissiyasiz']) {
      expect(text).toContain(t);
    }
  });

  it('called only mocked endpoints', () => {
    expect(unmatched).toEqual([]);
  });
});
