import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n/dictionary';
import { ApiError } from './api-client';
import {
  amountToCollect,
  cancelChoices,
  canCancel,
  cashToCollect,
  offerFailure,
  offerFailureText,
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

describe('in Russian', () => {
  afterEach(() => setLanguage('uz'));

  it('words the steps, cancel reasons and closed offers', () => {
    setLanguage('ru');
    expect(stepOf('driver_assigned')?.button).toBe('Я на месте');
    expect(stepOf('in_progress')?.button).toBe('Завершить поездку');
    const noShow = cancelChoices('driver_arrived', 95).find((c) => c.code === 'rider_no_show')!;
    expect(noShow.label).toBe('Пассажир не вышел');
    expect(noShow.disabledBecause).toBe('Подождите ещё 1:35');
    expect(cancelChoices('driver_assigned', null)[1]!.effect).toMatch(/надёжности/);
    expect(offerFailureText('taken').title).toBe('Заказ взял другой водитель');
  });

  it('reads the API answer in Russian too', () => {
    expect(offerFailure(new ApiError(409, 'Заказ передан другому водителю'))).toBe('taken');
    expect(offerFailure(new ApiError(409, 'Предложение уже недействительно'))).toBe('expired');
    expect(offerFailure(new ApiError(409, 'Сначала выйдите на линию'))).toBe('offline');
  });
});
