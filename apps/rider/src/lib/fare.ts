/**
 * What the rider sees about money (pure, unit-tested): the lines of a fixed fare, ride
 * options, the intercity seat share, paid waiting and what cancelling costs right now.
 * The API computes every price (apps/api/src/lib/tariff.ts); this only explains them.
 */
import type {
  Fare,
  RideClass,
  RideOption,
  RideRulesView,
  RideStatus,
  WaitingRule,
} from '../api/types';
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
  return (
    `Haydovchi yetib kelgach ${rules.waiting.free_minutes} daqiqa kutish bepul, keyin har daqiqa ` +
    `${formatMoney(rules.waiting.per_minute)}. Shu vaqt tugagach bekor qilish ` +
    `${formatMoney(rules.cancellationFee)}.`
  );
}

export const CLASS_LABELS: Record<RideClass, string> = {
  economy: 'Ekonom',
  comfort: 'Komfort',
};

export const CLASS_NOTES: Record<RideClass, string> = {
  economy: 'Cobalt, Nexia, Lacetti',
  comfort: 'Yangi va keng mashinalar',
};

export const OPTION_LABELS: Record<RideOption, string> = {
  child_seat: 'Bolalar o‘rindig‘i',
  luggage: 'Katta yukxona',
  pets: 'Uy hayvoni bilan',
  ac: 'Konditsioner',
};

/** Why an option matters: many Cobalts/Nexias carry a gas tank in the trunk. */
export const OPTION_HINTS: Record<RideOption, string> = {
  child_seat: 'Haydovchida bolalar o‘rindig‘i bo‘ladi',
  luggage: 'Yukxonasida gaz balloni yo‘q mashina',
  pets: 'Uy hayvonini olib ketishga rozi haydovchi',
  ac: 'Konditsionerli mashina, qo‘shimcha to‘lovsiz',
};

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
          ? `Yo‘nalish narxi: o‘rindiq × ${fare.fixed.passengers}`
          : 'Yo‘nalish narxi: butun mashina',
      amount: fare.base,
    });
  } else if (fare.kind === 'intercity') {
    lines.push({ label: `Shaharlararo, ${formatDistance(fare.distanceM)}`, amount: fare.base });
  } else {
    lines.push({
      label: `Shahar ichida, ${formatDistance(fare.insideM)}`,
      amount: fare.base - fare.outside,
    });
    if (fare.outside > 0) {
      lines.push({
        label: `Shahar tashqarisi, ${formatDistance(fare.outsideM)}`,
        amount: fare.outside,
      });
    }
  }
  if (fare.night > 0) lines.push({ label: 'Tungi qo‘shimcha', amount: fare.night });
  for (const option of RIDE_OPTIONS) {
    const price = fare.options[option];
    if (price !== undefined) lines.push({ label: OPTION_LABELS[option], amount: price });
  }
  // the API rounds the total up to 100 so‘m for cash: show the difference honestly
  const sum = lines.reduce((s, l) => s + l.amount, 0);
  if (fare.total > sum) lines.push({ label: 'Yaxlitlash', amount: fare.total - sum });
  if (waiting > 0) lines.push({ label: 'Pullik kutish', amount: waiting });
  return lines;
}

/** The option price as shown next to its switch: "+2 000 so‘m" or "Bepul". */
export function optionPriceLabel(price: number | undefined): string {
  if (price === undefined) return '';
  return price > 0 ? `+${formatMoney(price)}` : 'Bepul';
}

/** Intercity: the whole car's price, with what one seat would cost for comparison. */
export function seatShareText(fare: Fare): string | null {
  if (fare.kind !== 'intercity' || !fare.seat) return null;
  return (
    `Narx butun mashina uchun. Bir o‘rindiq ulushi: orqada ${formatMoney(fare.seat.rear)}, ` +
    `oldinda ${formatMoney(fare.seat.front)}. Yo‘lovchilar bilan bo‘lishib to‘lashingiz mumkin.`
  );
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
    return {
      fee: d.refund ? 0 : deposit,
      message: `${ride.status === 'scheduled' ? 'Oldindan buyurtmani bekor qilish.' : 'Haydovchi hali topilmadi.'} ${d.message}`,
    };
  }
  const terms = baseCancelTerms(ride, rules, now);
  if (terms.fee > 0 && ride.paymentMethod === 'cash') {
    // the API keeps a cash ride's fee owed until the rider's next cash ride collects it
    return {
      ...terms,
      message: `${terms.message} U keyingi naqd safaringiz narxiga alohida qo‘shiladi.`,
    };
  }
  // a prepaid card ride is refunded in full (a fee, if any, is owed to the driver apart)
  return ride.paymentStatus === 'paid' && deposit <= 0
    ? { ...terms, message: `${terms.message} Karta orqali to‘langan pul to‘liq qaytariladi.` }
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
    return {
      fee,
      message: `Haydovchi yetib kelib, bepul kutish vaqti tugadi. Bekor qilsangiz ${formatMoney(fee)} to‘lov haydovchiga yoziladi.`,
    };
  }
  if (ride.status === 'driver_arrived' && rules && ride.arrivedAt) {
    const left = waitingState(ride.arrivedAt, rules.waiting, now).freeLeftS;
    const minutes = Math.max(1, Math.ceil(left / 60));
    return {
      fee: 0,
      message: `Hozir bekor qilish bepul. ${minutes} daqiqadan so‘ng bekor qilish ${formatMoney(rules.cancellationFee)} bo‘ladi.`,
    };
  }
  if (ride.status === 'scheduled') {
    return { fee: 0, message: 'Oldindan buyurtmani bekor qilish bepul.' };
  }
  if (ride.status === 'awaiting_payment') {
    return { fee: 0, message: 'To‘lov hali qilinmagan. Bekor qilish bepul.' };
  }
  if (ride.status === 'searching') {
    return { fee: 0, message: 'Haydovchi hali topilmadi. Bekor qilish bepul.' };
  }
  return {
    fee: 0,
    message:
      'Bekor qilish bepul, lekin haydovchi allaqachon yo‘lda. Iltimos, zarur bo‘lsagina bekor qiling.',
  };
}

// Owed cancellation fees ---------------------------------------------------------------

/** What the owed-fee line means, said the same way on every screen. */
export const OWED_FEE_LABEL = 'Oldingi bekor qilingan safar uchun';

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
  const which = numbers ? ` (${numbers})` : '';
  if (paymentMethod === 'cash') {
    return {
      amount: owed.amount,
      collectedNow: true,
      note: `${OWED_FEE_LABEL}${which} bekor qilish to‘lovi: ${formatMoney(owed.amount)}. U shu safar narxiga alohida qo‘shiladi va haydovchiga naqd beriladi.`,
    };
  }
  return {
    amount: owed.amount,
    collectedNow: false,
    note: `${OWED_FEE_LABEL}${which} ${formatMoney(owed.amount)} qarzingiz bor. Karta bilan to‘lasangiz, u keyingi naqd safaringizda olinadi.`,
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
  };
}): { total: number; fare: number; owedFee: number; deposit: number } {
  const owedFee = ride.fare.owedFee ?? 0;
  // paid by card in advance (a ride booked for later): the driver takes the rest
  const deposit = Math.max(0, ride.fare.deposit ?? 0);
  // after the shared discount (the API's total already has it)
  const pays = ride.fare.pays ?? ride.fare.quoted - (ride.fare.poolDiscount ?? 0);
  const fare =
    ride.paymentMethod === 'cash'
      ? Math.max(0, (ride.fare.total ?? pays + ride.fare.waiting) - deposit)
      : ride.fare.waiting;
  return { total: fare + owedFee, fare, owedFee, deposit };
}

/** What happened to this ride's own cancellation fee, for the summary. */
export function cancellationFeeNote(fare: {
  cancellationFee: number;
  cancellationFeeStatus?: 'owed' | 'collected' | 'waived' | null;
}): string {
  switch (fare.cancellationFeeStatus) {
    case 'owed':
      return 'Haydovchi yetib kelib, bepul kutish vaqti tugaganidan keyin bekor qilindi. To‘lov keyingi naqd safaringiz narxiga alohida qo‘shiladi.';
    case 'collected':
      return 'Haydovchi yetib kelib, bepul kutish vaqti tugaganidan keyin bekor qilindi. To‘lov keyingi safaringizda olingan.';
    case 'waived':
      return 'Operator bu to‘lovni kechirdi: siz hech narsa to‘lamaysiz.';
    default:
      return 'Haydovchi yetib kelib, bepul kutish vaqti tugaganidan keyin bekor qilindi.';
  }
}
