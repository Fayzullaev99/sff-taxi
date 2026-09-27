/**
 * Waiting at the pickup, as the API charges it (apps/api src/lib/tariff.ts): the first
 * `freeMinutes` after "Yetib keldim" are free, then every started minute costs
 * `perMinute`, fixed when the ride starts. The driver may mark the rider as a no-show
 * `noShowAfterMinutes` after arriving (the API refuses it earlier).
 */

export interface WaitingRules {
  freeMinutes: number;
  perMinute: number;
  noShowAfterMinutes: number;
}

/**
 * Launch defaults (tariff: 2 free minutes, 500 so‘m/min; dispatch: no-show after 5 min) until
 * `GET /v1/driver/config` answers; the ride's own city tariff (`GET /v1/tariffs`) refines the
 * waiting part. The API enforces the real values either way.
 */
export const DEFAULT_WAITING: WaitingRules = {
  freeMinutes: 2,
  perMinute: 500,
  noShowAfterMinutes: 5,
};

export interface WaitingState {
  /** Seconds since arrival. */
  elapsedS: number;
  /** Free seconds left (0 once paid waiting started). */
  freeLeftS: number;
  paid: boolean;
  /** Paid minutes started so far. */
  paidMinutes: number;
  /** What the rider owes for waiting if the ride started now. */
  fee: number;
  /** Seconds until a no-show may be recorded (0 = allowed now). */
  noShowInS: number;
  canNoShow: boolean;
}

export function waitingState(arrivedAt: string, now: number, rules: WaitingRules): WaitingState {
  const arrived = Date.parse(arrivedAt);
  const elapsedS = Number.isNaN(arrived) ? 0 : Math.max(0, (now - arrived) / 1000);
  const freeS = rules.freeMinutes * 60;
  const over = elapsedS - freeS;
  const paidMinutes = over > 0 ? Math.ceil(over / 60) : 0;
  const noShowInS = Math.max(0, Math.ceil(rules.noShowAfterMinutes * 60 - elapsedS));
  return {
    elapsedS: Math.floor(elapsedS),
    freeLeftS: Math.max(0, Math.ceil(freeS - elapsedS)),
    paid: over > 0,
    paidMinutes,
    fee: paidMinutes * rules.perMinute,
    noShowInS,
    canNoShow: noShowInS === 0,
  };
}

/** The tariff's waiting part (`GET /v1/tariffs` → `tariff.waiting`) merged into the rules. */
export function rulesFromTariff(
  tariff: { waiting?: { free_minutes?: unknown; per_minute?: unknown } } | null | undefined,
  base: WaitingRules = DEFAULT_WAITING,
): WaitingRules {
  const w = tariff?.waiting;
  const free = typeof w?.free_minutes === 'number' ? w.free_minutes : base.freeMinutes;
  const per = typeof w?.per_minute === 'number' ? w.per_minute : base.perMinute;
  return { ...base, freeMinutes: free, perMinute: per };
}

/** The rules `GET /v1/driver/config` publishes (global tariff and dispatch settings). */
export function rulesFromConfig(rides: {
  freeWaitingMinutes: number;
  waitingPerMinute: number;
  noShowAfterMinutes: number;
}): WaitingRules {
  return {
    freeMinutes: rides.freeWaitingMinutes,
    perMinute: rides.waitingPerMinute,
    noShowAfterMinutes: rides.noShowAfterMinutes,
  };
}
