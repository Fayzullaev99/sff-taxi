import { describe, expect, it } from 'vitest';
import { normalizeUzPhone, UzPhone } from './phone.js';

describe('normalizeUzPhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['901234567', '+998901234567'],
    ['+998 90 123-45-67', '+998901234567'],
    ['(90) 123 45 67', '+998901234567'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it.each(['+79161234567', '12345', '+9989012345678', 'phone'])('rejects %s', (input) => {
    expect(UzPhone.safeParse(input).success).toBe(false);
  });
});
