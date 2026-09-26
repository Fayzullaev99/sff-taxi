import { z } from 'zod';

const UZ_E164 = /^\+998\d{9}$/;

/**
 * Normalises the ways Uzbek numbers are commonly typed into E.164:
 * "+998 90 123-45-67", "998901234567", "90 123 45 67" -> "+998901234567".
 * Anything else is returned unchanged and fails validation.
 */
export function normalizeUzPhone(input: string): string {
  const digits = input.replace(/[\s\-()]/g, '');
  if (/^\+998\d{9}$/.test(digits)) return digits;
  if (/^998\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+998${digits}`;
  return input;
}

export const UzPhone = z
  .string()
  .trim()
  .transform(normalizeUzPhone)
  .refine((v) => UZ_E164.test(v), {
    message: 'O‘zbekiston raqamini kiriting, masalan +998901234567',
  });
