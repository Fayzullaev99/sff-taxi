/**
 * What the rider sees about money (pure, unit-tested): the lines of a fixed fare, ride
 * options, the intercity seat share, paid waiting and what cancelling costs right now.
 * The API computes every price (apps/api/src/lib/tariff.ts); this only explains them.
 */
import type {
  Fare,
  Quote,
  RideClass,
  RideStop,
  StopRules,
  RideOption,
  RideRulesView,
  RideStatus,
  WaitingRule,
} from '../api/types';
import { t, type TKey } from '../i18n/dictionary';
import { rideDepositCancel } from './deposit';
import { formatDistance, formatMoney } from './format';

/** A ride's waiting and cancellation rules, as the countdowns and the cancel sheet use them. */
export interface RideRules {
  waiting: WaitingRule;
  cancellationFee: number;
}

/**
 * The ride's own rules (the tariff it was ordered under, whatever changed since), from the
 * rider view; null for an older API without them.
 */
export function rideRules(ride: { rules?: RideRulesView | null }): RideRules | null {
  const r = ride.rules;
  if (!r) return null;
  return {
    waiting: { free_minutes: r.freeWaitingMinutes, per_minute: r.waitingPerMinute },
    cancellationFee: r.cancellationFee,
  };
}

/** The waiting rule in one sentence, for the order and ride screens. */
export function waitingRuleText(rules: RideRules): string {
  return t('order.fare.waitingRule', {
    minutes: rules.waiting.free_minutes,
    perMinute: formatMoney(rules.waiting.per_minute),
    fee: formatMoney(rules.cancellationFee),
  });
}

const CLASS_LABEL_KEYS: Record<RideClass, TKey> = {
  economy: 'common.classes.economy',
  comfort: 'common.classes.comfort',
  minivan: 'common.classes.minivan',
  business: 'common.classes.business',
};

/** A taxi class's name in the app's language: "Ekonom" / "Эконом". */
export function rideClassLabel(rideClass: RideClass): string {
  return t(CLASS_LABEL_KEYS[rideClass]);
}

/**
 * The class names as a table, read in the app's language at access time (getters), for
 * screens that index it: `CLASS_LABELS[trip.class]`. New code calls `rideClassLabel`.
 */
export const CLASS_LABELS: Readonly<Record<RideClass, string>> = {
  get economy() {
    return rideClassLabel('economy');
  },
  get comfort() {
    return rideClassLabel('comfort');
  },
  get minivan() {
    return rideClassLabel('minivan');
  },
  get business() {
    return rideClassLabel('business');
  },
};

const CLASS_NOTE_KEYS: Record<RideClass, TKey> = {
  economy: 'order.classes.notes.economy',
  comfort: 'order.classes.notes.comfort',
  minivan: 'order.classes.notes.minivan',
  business: 'order.classes.notes.business',
};

/** Car examples of a class, when the quote does not name them. */
export function classNote(rideClass: RideClass): string {
  return t(CLASS_NOTE_KEYS[rideClass]);
}

/** The taxi classes in display order. */
export const RIDE_CLASSES: readonly RideClass[] = ['economy', 'comfort', 'minivan', 'business'];

/** People one ride of the class carries when the quote does not say: a minivan 6, others 3. */
const DEFAULT_MAX_PASSENGERS: Record<RideClass, number> = {
  economy: 3,
  comfort: 3,
  minivan: 6,
  business: 3,
};

export interface ClassChoice {
  id: RideClass;
  label: string;
  /** The card's second line: car examples and how many people. */
  note: string;
  maxPassengers: number;
}

/**
 * The classes the rider can order on this quote, in order: what the API says (only the
 * classes switched on are priced), else the priced ones with the app's own names.
 */
export function quoteClasses(quote: Pick<Quote, 'fares' | 'classes'>): ClassChoice[] {
  const listed = quote.classes?.filter((c) => quote.fares[c.id]);
  const items = listed?.length
    ? listed.map((c) => ({ id: c.id, label: c.label, examples: c.examples, max: c.maxPassengers }))
    : RIDE_CLASSES.filter((c) => quote.fares[c]).map((c) => ({
        id: c,
        label: rideClassLabel(c),
        examples: classNote(c),
        max: DEFAULT_MAX_PASSENGERS[c],
      }));
  return items.map((c) => ({
    id: c.id,
    label: c.label,
    note: t('order.classes.note', { examples: c.examples, max: c.max }),
    maxPassengers: c.max,
  }));
}

/** The class to keep selected: the rider's if the quote offers it, else the first offered. */
export function orderableClass(
  quote: Pick<Quote, 'fares' | 'classes'>,
  wanted: RideClass,
): RideClass {
  if (quote.fares[wanted]) return wanted;
  return quoteClasses(quote)[0]?.id ?? 'economy';
}

/** People one ride of the class may carry (the quote's number, else the app's default). */
export function classMaxPassengers(
  quote: Pick<Quote, 'seats'> | null | undefined,
  rideClass: RideClass,
): number {
  return quote?.seats?.byClass?.[rideClass] ?? DEFAULT_MAX_PASSENGERS[rideClass];
}

const OPTION_LABEL_KEYS: Record<RideOption, TKey> = {
  child_seat: 'order.options.labels.child_seat',
  luggage: 'order.options.labels.luggage',
  pets: 'order.options.labels.pets',
  ac: 'order.options.labels.ac',
};

/** Why an option matters: many Cobalts/Nexias carry a gas tank in the trunk. */
const OPTION_HINT_KEYS: Record<RideOption, TKey> = {
  child_seat: 'order.options.hints.child_seat',
  luggage: 'order.options.hints.luggage',
  pets: 'order.options.hints.pets',
  ac: 'order.options.hints.ac',
};

/** A ride option's name on its switch and on the receipt. */
export function optionLabel(option: RideOption): string {
  return t(OPTION_LABEL_KEYS[option]);
}

export function optionHint(option: RideOption): string {
  return t(OPTION_HINT_KEYS[option]);
}

export const RIDE_OPTIONS: readonly RideOption[] = ['child_seat', 'luggage', 'pets', 'ac'];

export interface FareLine {
  label: string;
  amount: number;
}

/**
 * The parts of a fare, in the order they add up: distance, the suburb part, the night
 * add-on, options, paid waiting. Zero parts are left out (except the distance).
 */
export function fareLines(fare: Fare, waiting = 0): FareLine[] {
  const lines: FareLine[] = [];
  if (fare.fixed) {
    // a fixed route price: per seat × people, or the whole car
    lines.push({
      label:
        fare.fixed.mode === 'seat'
          ? t('order.fare.lines.routeSeat', { count: fare.fixed.passengers })
          : t('order.fare.lines.routeCar'),
      amount: fare.base,
    });
  } else if (fare.kind === 'intercity') {
    lines.push({
      label: t('order.fare.lines.intercity', { distance: formatDistance(fare.distanceM) }),
      amount: fare.base,
    });
  } else {
    lines.push({
      label: t('order.fare.lines.inside', { distance: formatDistance(fare.insideM) }),
      amount: fare.base - fare.outside,
    });
    if (fare.outside > 0) {
      lines.push({
        label: t('order.fare.lines.outside', { distance: formatDistance(fare.outsideM) }),
        amount: fare.outside,
      });
    }
  }
  if (fare.night > 0) lines.push({ label: t('order.fare.lines.night'), amount: fare.night });
  for (const option of RIDE_OPTIONS) {
    const price = fare.options[option];
    if (price !== undefined) lines.push({ label: optionLabel(option), amount: price });
  }
  if (fare.stops && fare.stops.count > 0) {
    lines.push({
      label: t('order.fare.lines.stops', { count: fare.stops.count }),
      amount: fare.stops.fee,
    });
  }
  // the API rounds the total up to 100 so‘m for cash: show the difference honestly
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (fare.total > sum) {
    lines.push({ label: t('order.fare.lines.rounding'), amount: fare.total - sum });
  }
  if (waiting > 0) lines.push({ label: t('order.fare.lines.paidWaiting'), amount: waiting });
  return lines;
}

/**
 * What intermediate stops cost, in one sentence for the order screen; null without rules
 * (an older API).
 */
export function stopRulesText(rules: StopRules | null | undefined): string | null {
  if (!rules) return null;
  return t('order.route.stopRules', {
    perStop: formatMoney(rules.perStop),
    minutes: rules.freeMinutes,
    perMinute: formatMoney(rules.waitingPerMinute),
  });
}

/** A stop on the ride screen: ahead, the car is there, or passed (with paid waiting). */
export function stopStateText(stop: Pick<RideStop, 'arrivedAt' | 'leftAt' | 'waitingFee'>) {
  if (stop.leftAt) {
    return stop.waitingFee > 0
      ? t('order.route.stopPassedWaiting', { fee: formatMoney(stop.waitingFee) })
      : t('order.route.stopPassed');
  }
  return stop.arrivedAt ? t('order.route.stopWaitingHere') : t('order.route.stopAhead');
}

/** The option price as shown next to its switch: "+2 000 so‘m" or "Bepul". */
export function optionPriceLabel(price: number | undefined): string {
  if (price === undefined) return '';
  return price > 0 ? `+${formatMoney(price)}` : t('order.options.free');
}

/** Intercity: the whole car's price, with what one seat would cost for comparison. */
export function seatShareText(fare: Fare): string | null {
  if (fare.kind !== 'intercity' || !fare.seat) return null;
  return t('order.fare.seatShare', {
    rear: formatMoney(fare.seat.rear),
    front: formatMoney(fare.seat.front),
  });
}

export interface WaitingState {
  /** Seconds of free waiting left (0 once it is over). */
  freeLeftS: number;
  /** Started minutes of paid waiting so far. */
  paidMinutes: number;
  /** The paid waiting so far, as the API will charge it at the start of the ride. */
  fee: number;
}

/** Mirrors the API's waitingFee: free minutes after arrival, then per started minute. */
export function waitingState(arrivedAt: string | Date, rule: WaitingRule, now: Date): WaitingState {
  const waitedS = Math.max(0, (now.getTime() - new Date(arrivedAt).getTime()) / 1000);
  const freeS = rule.free_minutes * 60;
  if (waitedS < freeS) return { freeLeftS: Math.ceil(freeS - waitedS), paidMinutes: 0, fee: 0 };
  const paidMinutes = Math.ceil((waitedS - freeS) / 60);
  return { freeLeftS: 0, paidMinutes, fee: paidMinutes * rule.per_minute };
}

export interface CancelTerms {
  /** What cancelling costs right now. */
  fee: number;
  /** A line for the confirmation dialog. */
  message: string;
}

/**
 * What cancelling costs now. The API is free until the driver arrived and the free
 * waiting ran out; after that the tariff's fee. `serverFee` is the ride's cancelFeeNow
 * (true when fetched); the clock catches the moment free waiting runs out in between.
 */
export function cancelTerms(
  ride: {
    status: RideStatus;
    arrivedAt: string | null;
    cancelFeeNow: number;
    paymentStatus?: string;
    paymentMethod?: string;
    scheduledFor?: string | null;
    fare?: { deposit?: number };
  },
  rules: { waiting: WaitingRule; cancellationFee: number } | null,
  now: Date,
): CancelTerms {
  const deposit = ride.fare?.deposit ?? 0;
  // a ride for later held by a paid deposit, before a driver took it: refunded in time,
  // later it is the waiting driver's
  if (
    deposit > 0 &&
    ride.paymentStatus === 'paid' &&
    (ride.status === 'scheduled' || ride.status === 'searching')
  ) {
    const d = rideDepositCancel(deposit, ride.scheduledFor ?? null, now);
    const intro =
      ride.status === 'scheduled'
        ? t('order.cancel.scheduledIntro')
        : t('order.cancel.noDriverYet');
    return { fee: d.refund ? 0 : deposit, message: `${intro} ${d.message}` };
  }
  const terms = baseCancelTerms(ride, rules, now);
  if (terms.fee > 0 && ride.paymentMethod === 'cash') {
    // the API keeps a cash ride's fee owed until the rider's next cash ride collects it
    return { ...terms, message: `${terms.message} ${t('order.cancel.owedNext')}` };
  }
  // a prepaid card ride is refunded in full (a fee, if any, is owed to the driver apart)
  return ride.paymentStatus === 'paid' && deposit <= 0
    ? { ...terms, message: `${terms.message} ${t('order.cancel.cardRefunded')}` }
    : terms;
}

function baseCancelTerms(
  ride: { status: RideStatus; arrivedAt: string | null; cancelFeeNow: number },
  rules: { waiting: WaitingRule; cancellationFee: number } | null,
  now: Date,
): CancelTerms {
  let fee = ride.cancelFeeNow;
  if (!fee && rules && ride.status === 'driver_arrived' && ride.arrivedAt) {
    if (waitingState(ride.arrivedAt, rules.waiting, now).freeLeftS === 0) {
      fee = rules.cancellationFee;
    }
  }
  if (fee > 0) {
    return { fee, message: t('order.cancel.feeNow', { fee: formatMoney(fee) }) };
  }
  if (ride.status === 'driver_arrived' && rules && ride.arrivedAt) {
    const left = waitingState(ride.arrivedAt, rules.waiting, now).freeLeftS;
    const minutes = Math.max(1, Math.ceil(left / 60));
    return {
      fee: 0,
      message: t('order.cancel.freeUntil', { minutes, fee: formatMoney(rules.cancellationFee) }),
    };
  }
  if (ride.status === 'scheduled') {
    return { fee: 0, message: t('order.cancel.freeScheduled') };
  }
  if (ride.status === 'awaiting_payment') {
    return { fee: 0, message: t('order.cancel.freeUnpaid') };
  }
  if (ride.status === 'searching') {
    return { fee: 0, message: t('order.cancel.freeSearching') };
  }
  return { fee: 0, message: t('order.cancel.freeOnWay') };
}

// Owed cancellation fees ---------------------------------------------------------------

/** What the owed-fee line means, said the same way on every screen (the app's language). */
export function owedFeeLabel(): string {
  return t('order.fare.owedFeeLabel');
}

/**
 * The owed-fee line of a quote for the chosen payment: a cash ride collects the fees owed
 * from earlier cancelled cash rides on top of its fare; a card ride leaves them owed (for
 * the next cash ride). Null when nothing is owed.
 */
export function quoteOwedFee(
  owed: { amount: number; rides?: { number: number }[] } | null | undefined,
  paymentMethod: 'cash' | 'card',
): { amount: number; collectedNow: boolean; note: string } | null {
  if (!owed || owed.amount <= 0) return null;
  const numbers = (owed.rides ?? []).map((r) => `#${r.number}`).join(', ');
  const rides = numbers ? ` (${numbers})` : '';
  const amount = formatMoney(owed.amount);
  if (paymentMethod === 'cash') {
    return {
      amount: owed.amount,
      collectedNow: true,
      note: t('order.fare.owedCashNote', { rides, amount }),
    };
  }
  return {
    amount: owed.amount,
    collectedNow: false,
    note: t('order.fare.owedCardNote', { rides, amount }),
  };
}

/**
 * The cash the rider hands over for a ride: the fare (a card ride: prepaid, only paid
 * waiting) plus fees owed from earlier rides this ride collects.
 */
export function cashToPay(ride: {
  paymentMethod: 'cash' | 'card';
  fare: {
    quoted: number;
    waiting: number;
    total: number | null;
    owedFee?: number;
    poolDiscount?: number;
    pays?: number;
    deposit?: number;
    /** The rider's promo / credit discount (the platform pays it; `total` stays full). */
    discount?: number;
  };
}): { total: number; fare: number; owedFee: number; deposit: number } {
  const owedFee = ride.fare.owedFee ?? 0;
  // paid by card in advance (a ride booked for later): the driver takes the rest
  const deposit = Math.max(0, ride.fare.deposit ?? 0);
  // after the shared and promo discounts (the API's total already has the shared one)
  const pays = ride.fare.pays ?? ride.fare.quoted - (ride.fare.poolDiscount ?? 0);
  const total = ride.fare.total !== null ? ride.fare.total - (ride.fare.discount ?? 0) : null;
  const fare =
    ride.paymentMethod === 'cash'
      ? Math.max(0, (total ?? pays + ride.fare.waiting) - deposit)
      : ride.fare.waiting;
  return { total: fare + owedFee, fare, owedFee, deposit };
}

/** The fields of a ride the history row's amount is read from. */
export interface HistoryRide {
  status: RideStatus;
  fare: {
    quoted: number;
    total: number | null;
    cancellationFee: number;
    cancellationFeeStatus?: 'owed' | 'collected' | 'waived' | null;
    owedFee?: number;
    pays?: number;
    discount?: number;
  };
}

/**
 * The amount a ride shows in the history: what the rider paid. A completed ride: the total
 * less the promo / credit discount, plus owed fees collected with it. A cancelled ride: its
 * cancellation fee, 0 when it was cancelled free or the fee was waived (never the price the
 * ride would have cost). An open ride: the price to pay (after discounts).
 */
export function historyAmount(ride: HistoryRide): number {
  if (ride.status === 'completed') {
    const total = ride.fare.total ?? ride.fare.quoted;
    return Math.max(0, total - (ride.fare.discount ?? 0)) + (ride.fare.owedFee ?? 0);
  }
  if (ride.status === 'cancelled') {
    return ride.fare.cancellationFeeStatus === 'waived' ? 0 : ride.fare.cancellationFee;
  }
  return ride.fare.pays ?? ride.fare.quoted;
}

/**
 * The history row's amount in words: "Bepul bekor qilindi" for a ride cancelled without a
 * fee, the fee of one cancelled with it (`caption` names it), else the money.
 */
export function historyAmountText(ride: HistoryRide): { text: string; caption: string | null } {
  const amount = historyAmount(ride);
  if (ride.status === 'cancelled') {
    return amount > 0
      ? { text: formatMoney(amount), caption: t('history.cancelFee') }
      : { text: t('history.cancelledFree'), caption: null };
  }
  return { text: formatMoney(amount), caption: null };
}

/**
 * Paid waiting on an open ride: the driver collects it in cash on top of the price, so the
 * rider sees it (and the cash total) before the end, not only on the receipt. Null without
 * paid waiting, or when the owed-fee line already spells the cash total out.
 */
export function waitingCashLine(ride: Parameters<typeof cashToPay>[0]): string | null {
  const waiting = ride.fare.waiting;
  if (waiting <= 0) return null;
  const cash = cashToPay(ride);
  if (cash.owedFee > 0) return null;
  return ride.paymentMethod === 'cash'
    ? t('order.fare.waitingCash', {
        waiting: formatMoney(waiting),
        total: formatMoney(cash.total),
      })
    : t('order.fare.waitingCashCard', { waiting: formatMoney(waiting) });
}

/** What happened to this ride's own cancellation fee, for the summary. */
export function cancellationFeeNote(fare: {
  cancellationFee: number;
  cancellationFeeStatus?: 'owed' | 'collected' | 'waived' | null;
}): string {
  switch (fare.cancellationFeeStatus) {
    case 'owed':
      return t('order.cancel.feeOwed');
    case 'collected':
      return t('order.cancel.feeCollected');
    case 'waived':
      return t('order.cancel.feeWaived');
    default:
      return t('order.cancel.feeDefault');
  }
}
