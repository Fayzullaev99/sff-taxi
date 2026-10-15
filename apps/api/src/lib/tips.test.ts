import { describe, expect, it } from 'vitest';
import { checkTip, type TipRules } from './tips.js';

const RULES: TipRules = {
  enabled: true,
  presets: [2000, 5000, 10_000],
  max_amount: 50_000,
  min_amount: 1000,
  card_enabled: true,
  window_hours: 24,
};
const NOW = new Date('2026-10-14T07:00:00Z');
const at = (hoursAgo: number) => ({
  completedAt: new Date(NOW.getTime() - hoursAgo * 3600_000),
  now: NOW,
});

describe('tips', () => {
  it('takes the presets and custom amounts within the limits', () => {
    for (const amount of RULES.presets) expect(checkTip(amount, at(1), RULES).ok).toBe(true);
    expect(checkTip(7500, at(1), RULES).ok).toBe(true);
    expect(checkTip(50_000, at(23), RULES).ok).toBe(true);
  });

  it('refuses with the reason in Uzbek', () => {
    const reason = (amount: number, hours = 1, rules = RULES) => {
      const r = checkTip(amount, at(hours), rules);
      return r.ok ? null : [r.reason, r.message];
    };
    expect(reason(500)).toEqual(['too_small', 'Choychaqa kamida 1 000 so‘m']);
    expect(reason(60_000)).toEqual(['too_big', 'Choychaqa ko‘pi bilan 50 000 so‘m']);
    expect(reason(2550)?.[0]).toBe('not_round');
    expect(reason(2000, 25)?.[0]).toBe('late');
    expect(reason(2000, 1, { ...RULES, enabled: false })?.[0]).toBe('disabled');
  });
});
