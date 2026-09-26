/**
 * What the rider sees about money (pure, unit-tested): the lines of a fixed fare, ride
 * options, the intercity seat share, paid waiting and what cancelling costs right now.
 * The API computes every price (apps/api/src/lib/tariff.ts); this only explains them.
 */
import type { Fare, RideClass, RideOption, RideStatus, WaitingRule } from '../api/types';
import { formatDistance, formatMoney } from './format';

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
  if (fare.kind === 'intercity') {
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
  if (ride.status === 'searching') {
    return { fee: 0, message: 'Haydovchi hali topilmadi. Bekor qilish bepul.' };
  }
  return {
    fee: 0,
    message:
      'Bekor qilish bepul, lekin haydovchi allaqachon yo‘lda. Iltimos, zarur bo‘lsagina bekor qiling.',
  };
}
