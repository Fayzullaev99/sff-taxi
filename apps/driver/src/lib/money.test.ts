import { describe, expect, it } from 'vitest';
import { DEFAULT_BILLING } from './driver-config';
import { balanceStatus, passAdvice, passBreakEven, promoStatus } from './money';

const until = (promoUntil: string | null) => ({ ...DEFAULT_BILLING, promoUntil });
import { biggestGain, priorityParts, scoreLevel } from './priority';

describe('promoStatus', () => {
  it('shows the 0% period with the days left', () => {
    expect(promoStatus('2026-09-26', until('2026-12-31'))).toMatchObject({
      active: true,
      daysLeft: 97,
    });
    expect(promoStatus('2026-12-31', until('2026-12-31'))).toMatchObject({
      active: true,
      daysLeft: 1,
    });
    expect(promoStatus('2026-12-31', until('2026-12-31')).text).toMatch(/31\.12 gacha 0%/);
  });

  it('explains the capped commission after it', () => {
    const p = promoStatus('2027-01-01', until('2026-12-31'));
    expect(p.active).toBe(false);
    expect(p.text).toMatch(/5%/);
    expect(p.text).toMatch(/10 000 so‘m/);
    expect(promoStatus('2026-09-26', until(null)).active).toBe(false);
    // the API's rules, not the launch defaults
    const later = promoStatus('2027-02-01', {
      ...DEFAULT_BILLING,
      commissionPercent: 4,
      dailyCap: 8_000,
    });
    expect(later.text).toMatch(/4%, kuniga ko‘pi bilan 8 000 so‘m/);
  });
});

describe('balanceStatus', () => {
  it('blocks work below the minimum and says how much is missing', () => {
    expect(balanceStatus(-12_500, -10_000)).toEqual({
      level: 'blocked',
      canWork: false,
      shortBy: 2_500,
    });
    expect(balanceStatus(-10_000, -10_000)).toMatchObject({ level: 'low', canWork: true });
    expect(balanceStatus(5_000, -10_000)).toMatchObject({ level: 'ok', canWork: true, shortBy: 0 });
  });
});

describe('passes', () => {
  it('knows when a pass pays off and when it is pointless', () => {
    expect(passBreakEven('day')).toBe(180_000);
    expect(
      passBreakEven('week', { ...DEFAULT_BILLING, passWeek: 40_000, commissionPercent: 4 }),
    ).toBe(1_000_000);
    expect(passAdvice(promoStatus('2026-09-26'), false)).toMatch(/0%/);
    expect(passAdvice(promoStatus('2027-02-01'), true)).toMatch(/amalda/);
    expect(passAdvice(promoStatus('2027-02-01'), false)).toBeNull();
  });
});

describe('priority explanation', () => {
  // a new driver: priors only (API: score 91)
  const fresh = { score: 91, acceptance: 0.8, reliability: 1, rating: 0.95, stars: 4.8 };

  it('splits the score into points per part', () => {
    const parts = priorityParts(fresh);
    expect(parts.map((p) => [p.key, p.points, p.maxPoints, p.value])).toEqual([
      ['acceptance', 32, 40, '80%'],
      ['reliability', 30, 30, '100%'],
      ['rating', 29, 30, '4.8 ★'],
    ]);
    expect(parts.reduce((s, p) => s + p.points, 0)).toBe(91);
  });

  it('points at the part with the most to gain', () => {
    expect(biggestGain(fresh)?.key).toBe('acceptance');
    expect(
      biggestGain({ score: 70, acceptance: 0.9, reliability: 0.5, rating: 0.9, stars: 4.6 })?.key,
    ).toBe('reliability');
    expect(
      biggestGain({ score: 100, acceptance: 1, reliability: 1, rating: 1, stars: 5 }),
    ).toBeNull();
  });

  it('labels the level', () => {
    expect(scoreLevel(91).level).toBe('high');
    expect(scoreLevel(70).level).toBe('good');
    expect(scoreLevel(40).level).toBe('low');
  });
});
