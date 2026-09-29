import { describe, expect, it } from 'vitest';
import { compactHero } from './layout';

describe('compactHero', () => {
  it('keeps the logo on a phone in portrait, keyboard or not', () => {
    expect(compactHero(900, 0)).toBe(false);
    expect(compactHero(900, 300)).toBe(false);
  });

  it('shrinks it on a landscape tablet with the keypad up, or a landscape phone', () => {
    expect(compactHero(800, 0)).toBe(false);
    expect(compactHero(800, 380)).toBe(true);
    expect(compactHero(400, 0)).toBe(true);
  });
});
