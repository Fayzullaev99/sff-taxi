import { describe, expect, it } from 'vitest';
import { checkPassenger, passengerChip, passengerLine } from './passenger';

const s = (text: string | null) => text?.replace(/\u00a0/g, ' ') ?? null;

describe('ordering for someone else', () => {
  it('needs a name and a valid Uzbek phone that is not the rider’s own', () => {
    expect(checkPassenger('Onam', '90 123 45 67', '+998911112233')).toEqual({
      ok: true,
      name: 'Onam',
      phone: '+998901234567',
      nameError: null,
      phoneError: null,
    });
    expect(checkPassenger(' ', '', null)).toMatchObject({
      ok: false,
      nameError: 'Yo‘lovchining ismini yozing',
      phoneError: 'Yo‘lovchining telefonini yozing',
    });
    expect(checkPassenger('Onam', '12345', null).phoneError).toBe(
      'Telefon raqami noto‘g‘ri: +998 XX XXX XX XX',
    );
    expect(checkPassenger('Men', '+998911112233', '+998911112233').phoneError).toBe(
      'Bu sizning raqamingiz: o‘zingiz uchun bo‘lsa, bu tanlovni o‘chiring',
    );
  });

  it('shows who rides on the chips and the ride screen', () => {
    expect(s(passengerChip({ name: 'Onam', phone: '+998901234567' }))).toBe(
      'Onam · +998 90 123 45 67',
    );
    expect(s(passengerLine({ name: 'Onam', phone: '+998901234567' }))).toBe(
      'Yo‘lovchi: Onam · +998 90 123 45 67',
    );
    expect(passengerLine({ name: null, phone: null })).toBe('Yo‘lovchi: boshqa odam');
    expect(passengerLine(null)).toBeNull();
  });
});
