import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import {
  amountToCollect,
  cancelChoices,
  canCancel,
  cashToCollect,
  offerFailure,
  stepOf,
} from './ride-flow';

describe('stepOf', () => {
  it('walks pickup → waiting → trip', () => {
    expect(stepOf('driver_assigned')).toMatchObject({ action: 'arrive', navigateTo: 'pickup' });
    expect(stepOf('driver_arrived')).toMatchObject({ action: 'start', navigateTo: null });
    expect(stepOf('in_progress')).toMatchObject({
      action: 'complete',
      button: 'Yakunlash',
      navigateTo: 'dropoff',
    });
    expect(stepOf('completed')).toBeNull();
  });

  it('allows cancelling only before the trip starts', () => {
    expect(canCancel('driver_assigned')).toBe(true);
    expect(canCancel('driver_arrived')).toBe(true);
    expect(canCancel('in_progress')).toBe(false);
  });
});

describe('cancelChoices', () => {
  const noShow = (status: string, left: number | null) =>
    cancelChoices(status, left).find((c) => c.code === 'rider_no_show')!;

  it('offers a no-show only after arriving and waiting', () => {
    expect(noShow('driver_assigned', null).disabledBecause).toMatch(/Yetib keldim/);
    expect(noShow('driver_arrived', 95).disabledBecause).toBe('Yana 1:35 kuting');
    expect(noShow('driver_arrived', 0).disabledBecause).toBeNull();
  });

  it('warns that other reasons count against reliability', () => {
    const other = cancelChoices('driver_assigned', null).filter((c) => c.code !== 'rider_no_show');
    expect(other).toHaveLength(4);
    for (const c of other) {
      expect(c.disabledBecause).toBeNull();
      expect(c.effect).toMatch(/ishonchlilik/);
    }
  });
});

describe('amountToCollect', () => {
  it('uses the final total, else quote + waiting', () => {
    expect(amountToCollect({ quoted: 12_000, waiting: 1_000, total: 13_000 })).toBe(13_000);
    expect(amountToCollect({ quoted: 12_000, waiting: 500, total: null })).toBe(12_500);
  });
});

describe('offerFailure', () => {
  it('reads the API answer', () => {
    expect(offerFailure(new ApiError(409, 'Buyurtma boshqa haydovchiga berildi'))).toBe('taken');
    expect(offerFailure(new ApiError(409, 'Taklif endi amal qilmaydi'))).toBe('expired');
    expect(offerFailure(new ApiError(409, 'Avval liniyaga chiqing'))).toBe('offline');
    expect(offerFailure(new ApiError(409, 'Qayta urinib ko‘ring'))).toBe('taken');
    expect(offerFailure(new ApiError(404, 'Taklif topilmadi'))).toBe('gone');
    expect(offerFailure(new ApiError(0, 'x'))).toBe('network');
    expect(offerFailure(new Error('x'))).toBe('other');
  });
});

describe('cashToCollect', () => {
  it('takes the whole fare in cash, only the waiting on a prepaid card ride', () => {
    expect(cashToCollect('cash', { quoted: 12_000, waiting: 1_000, total: 13_000 })).toBe(13_000);
    expect(cashToCollect('card', { quoted: 12_000, waiting: 1_000, total: 13_000 })).toBe(1_000);
    expect(cashToCollect('card', { quoted: 12_000, waiting: 0, total: null })).toBe(0);
  });
});
