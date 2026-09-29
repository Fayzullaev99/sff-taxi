import { Body, Controller, Get, Global, Injectable, Module, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../../core/auth/auth-context.js';
import { Database, type Tx } from '../../core/db/database.js';
import { ZodPipe } from '../../core/http/zod.pipe.js';
import { CargoRules, DEFAULT_CARGO } from '../../lib/cargo.js';
import { DEFAULT_POOL, PoolRules } from '../../lib/pool.js';
import { DEFAULT_TARIFF, Tariff } from '../../lib/tariff.js';

type Db = Tx | Database['kysely'];
const seconds = (min: number, max: number) => z.number().int().min(min).max(max);
const soum = z.number().int().min(0).max(10_000_000);

/** How rides find drivers (market analysis §6.4; src/modules/dispatch). */
export const DispatchRules = z
  .object({
    /** A direct offer waits this long for the driver's answer. */
    offer_timeout_seconds: seconds(5, 120),
    /** Direct offers, one driver at a time, before the ride is broadcast. */
    direct_offers: z.number().int().min(1).max(10),
    /** Drivers further than this (straight line) from the pickup get no direct offer. */
    search_radius_m: z.number().int().min(500).max(50_000),
    /** How many of the nearest drivers are compared by road ETA. */
    candidates: z.number().int().min(1).max(50),
    /** After the direct offers: every free driver within this radius sees the ride. */
    broadcast_radius_m: z.number().int().min(500).max(50_000),
    /** A broadcast offer waits this long; then operators are alerted. */
    broadcast_timeout_seconds: seconds(10, 600),
    /** A ride nobody took for this long is cancelled by the system. */
    search_timeout_seconds: seconds(60, 3600),
    /** A driver whose last good GPS fix is older than this is not offered rides. */
    location_max_age_seconds: seconds(30, 3600),
    /** Drivers whose road ETAs differ by at most this much are ranked by priority score. */
    tie_window_seconds: seconds(0, 600),
    /** The driver may mark the rider as a no-show this many minutes after arriving. */
    no_show_after_minutes: z.number().int().min(1).max(60),
  })
  .refine((r) => r.broadcast_radius_m <= r.search_radius_m, {
    message: 'Efir radiusi qidiruv radiusidan katta bo‘lmasligi kerak',
    path: ['broadcast_radius_m'],
  });
export type DispatchRules = z.infer<typeof DispatchRules>;

export const DEFAULT_DISPATCH: DispatchRules = {
  offer_timeout_seconds: 15,
  direct_offers: 3,
  search_radius_m: 5000,
  candidates: 10,
  broadcast_radius_m: 3000,
  broadcast_timeout_seconds: 30,
  search_timeout_seconds: 600,
  location_max_age_seconds: 120,
  tie_window_seconds: 60,
  no_show_after_minutes: 5,
};

/** Driver fees and the tax the platform withholds (market analysis §6.3 "Driver fee model"). */
export const BillingRules = z.object({
  /** No platform commission on rides completed before this Tashkent date (launch promo). */
  promo_until: z.iso.date().nullable(),
  /** City rides: percent of the fare ... */
  commission_percent: z.number().min(0).max(50),
  /** ... but at most this much per Tashkent day and per Monday-Sunday week (0 = no cap). */
  daily_cap: soum,
  weekly_cap: soum,
  /** Intercity rides: percent of the fare, capped per ride (0 = no cap); not in the daily cap. */
  intercity_commission_percent: z.number().min(0).max(50),
  intercity_trip_cap: soum,
  /** Self-employed turnover tax the platform withholds as tax agent (PP-247, 1% in 2026). */
  tax_percent: z.number().min(0).max(20),
  /** Passes: unlimited city rides without commission for a day or a week. */
  pass_day_price: soum,
  pass_week_price: soum,
  /** A driver whose balance is below this cannot go online nor get offers. */
  min_balance: z.number().int().min(-10_000_000).max(0),
});
export type BillingRules = z.infer<typeof BillingRules>;

export const DEFAULT_BILLING: BillingRules = {
  // ~3 months of 0% from launch (autumn 2026)
  promo_until: '2026-12-31',
  commission_percent: 5,
  daily_cap: 10_000,
  weekly_cap: 55_000,
  intercity_commission_percent: 5,
  intercity_trip_cap: 10_000,
  tax_percent: 1,
  pass_day_price: 9000,
  pass_week_price: 50_000,
  min_balance: -10_000,
};

/** The intercity trip board (src/modules/intercity). */
export const IntercityRules = z.object({
  /** A driver may ask this much more or less than the reference seat price. */
  price_band_percent: z.number().int().min(0).max(50),
  /** How far ahead a trip may be published. */
  publish_max_days_ahead: z.number().int().min(1).max(30),
  /** A trip is published at least this long before it leaves. */
  publish_min_minutes_ahead: z.number().int().min(0).max(720),
  /** Riders cancel free until this long before departure. */
  free_cancel_minutes: z.number().int().min(0).max(1440),
  /** A later cancellation owes this share of the booking (recorded, like ride fees). */
  late_cancel_fee_percent: z.number().int().min(0).max(100),
  /** The driver may open boarding this long before departure. */
  boarding_opens_minutes: z.number().int().min(0).max(240),
  /**
   * Seats along the way: a trip is offered to riders between other towns when going through
   * them adds at most this many km (straight lines between the towns). Documents saved
   * before this rule existed read the default.
   */
  along_route_max_km: z.number().min(0).max(100).default(15),
});
export type IntercityRules = z.infer<typeof IntercityRules>;

export const DEFAULT_INTERCITY: IntercityRules = {
  price_band_percent: 15,
  publish_max_days_ahead: 7,
  publish_min_minutes_ahead: 15,
  free_cancel_minutes: 60,
  late_cancel_fee_percent: 30,
  boarding_opens_minutes: 60,
  along_route_max_km: 15,
};

/**
 * Deposits for bookings made in advance (src/lib/deposit.ts): the seat board now, rides for
 * later next. Part of the price is paid by card to hold the booking; the rest is cash.
 */
export const BookingRules = z.object({
  /** Share of the price paid in advance; 0 turns deposits off. */
  deposit_percent: z.number().int().min(0).max(100),
  /** At least this much (so'm), never more than the price. */
  deposit_min: soum,
  /** A booking whose deposit is not paid within this many minutes is cancelled. */
  payment_minutes: z.number().int().min(5).max(120),
});
export type BookingRules = z.infer<typeof BookingRules>;

export const DEFAULT_BOOKING: BookingRules = {
  deposit_percent: 20,
  deposit_min: 5000,
  payment_minutes: 15,
};

/**
 * What goes on the electronic fiscal receipt of a ride or a seat (src/modules/fiscal). The
 * codes are PLACEHOLDERS until the classifier codes are confirmed with the tax authority
 * (tasnif.soliq.uz): see docs/fiscal-and-licence.md.
 */
export const FiscalRules = z.object({
  /** Item names on the receipt. */
  city_item_name: z.string().trim().min(3).max(128),
  intercity_item_name: z.string().trim().min(3).max(128),
  /** Cargo and delivery orders (optional in a stored document: the defaults apply). */
  cargo_item_name: z.string().trim().min(3).max(128).default('Yuk tashish xizmati'),
  delivery_item_name: z
    .string()
    .trim()
    .min(3)
    .max(128)
    .default('Yetkazib berish xizmati (posilka)'),
  /** MXIK (IKPU): the 17-digit product/service classifier code of passenger transport. */
  mxik_code: z.string().regex(/^\d{17}$/, '17 ta raqam'),
  /** The package (unit) code the classifier gives for the MXIK code. */
  package_code: z.string().regex(/^\d{1,10}$/, 'raqamlar'),
  /** Self-employed drivers under the turnover tax are not VAT payers: 0. */
  vat_percent: z.number().min(0).max(20),
});
export type FiscalRules = z.infer<typeof FiscalRules>;

export const DEFAULT_FISCAL: FiscalRules = {
  city_item_name: 'Taksi xizmati (yo‘lovchi tashish)',
  intercity_item_name: 'Shaharlararo yo‘lovchi tashish (o‘rindiq)',
  cargo_item_name: 'Yuk tashish xizmati',
  delivery_item_name: 'Yetkazib berish xizmati (posilka)',
  // placeholders: no receipt is sent while FISCAL_PROVIDER=none
  mxik_code: '00000000000000000',
  package_code: '0000000',
  vat_percent: 0,
};

const RULES = {
  tariff: { key: 'tariff', schema: Tariff, fallback: DEFAULT_TARIFF },
  dispatch: { key: 'dispatch', schema: DispatchRules, fallback: DEFAULT_DISPATCH },
  billing: { key: 'billing', schema: BillingRules, fallback: DEFAULT_BILLING },
  intercity: { key: 'intercity', schema: IntercityRules, fallback: DEFAULT_INTERCITY },
  fiscal: { key: 'fiscal', schema: FiscalRules, fallback: DEFAULT_FISCAL },
  pool: { key: 'pool', schema: PoolRules, fallback: DEFAULT_POOL },
  booking: { key: 'booking', schema: BookingRules, fallback: DEFAULT_BOOKING },
  cargo: { key: 'cargo', schema: CargoRules, fallback: DEFAULT_CARGO },
} as const;
type RuleName = keyof typeof RULES;
type RuleValue<N extends RuleName> = z.infer<(typeof RULES)[N]['schema']>;

/**
 * Platform rules, one validated JSON document per key in `settings`. A missing (or no
 * longer valid) row falls back to the built-in default, so a deploy never breaks pricing.
 */
@Injectable()
export class SettingsService {
  /**
   * Rules read outside a transaction are kept for a few seconds: the dispatch loop, quotes
   * and availability read them on every request. A change made here is seen at once; one
   * made by another process (API vs worker) within CACHE_MS.
   */
  private readonly cache = new Map<string, { value: unknown; until: number }>();
  static readonly CACHE_MS = 5000;

  constructor(private readonly db: Database) {}

  async get<N extends RuleName>(name: N, db?: Db): Promise<RuleValue<N>> {
    const rule = RULES[name];
    if (!db) {
      const hit = this.cache.get(rule.key);
      if (hit && hit.until > Date.now()) return hit.value as RuleValue<N>;
    }
    const row = await (db ?? this.db.kysely)
      .selectFrom('settings')
      .select('value')
      .where('key', '=', rule.key)
      .executeTakeFirst();
    const parsed = rule.schema.safeParse(row?.value);
    const value = (parsed.success ? parsed.data : rule.fallback) as RuleValue<N>;
    if (!db) this.cache.set(rule.key, { value, until: Date.now() + SettingsService.CACHE_MS });
    return value;
  }

  async set<N extends RuleName>(name: N, value: RuleValue<N>): Promise<RuleValue<N>> {
    const json = JSON.stringify(value);
    await this.db.kysely
      .insertInto('settings')
      .values({ key: RULES[name].key, value: json })
      .onConflict((oc) => oc.column('key').doUpdateSet({ value: json, updated_at: new Date() }))
      .execute();
    this.cache.delete(RULES[name].key);
    return this.get(name);
  }

  tariff(db?: Db) {
    return this.get('tariff', db);
  }

  dispatch(db?: Db) {
    return this.get('dispatch', db);
  }

  billing(db?: Db) {
    return this.get('billing', db);
  }

  intercity(db?: Db) {
    return this.get('intercity', db);
  }

  fiscal(db?: Db) {
    return this.get('fiscal', db);
  }

  pool(db?: Db) {
    return this.get('pool', db);
  }

  booking(db?: Db) {
    return this.get('booking', db);
  }

  cargo(db?: Db) {
    return this.get('cargo', db);
  }
}

@Controller('admin/settings')
@AdminOnly()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** The global tariff; a city may have its own (PATCH /admin/geo/cities/:id). */
  @Get('tariff')
  tariff() {
    return this.settings.tariff();
  }

  @Put('tariff')
  setTariff(@Body(new ZodPipe(Tariff)) body: Tariff) {
    return this.settings.set('tariff', body);
  }

  @Get('dispatch')
  dispatch() {
    return this.settings.dispatch();
  }

  @Put('dispatch')
  setDispatch(@Body(new ZodPipe(DispatchRules)) body: DispatchRules) {
    return this.settings.set('dispatch', body);
  }

  @Get('billing')
  billing() {
    return this.settings.billing();
  }

  @Put('billing')
  setBilling(@Body(new ZodPipe(BillingRules)) body: BillingRules) {
    return this.settings.set('billing', body);
  }

  @Get('intercity')
  intercity() {
    return this.settings.intercity();
  }

  @Put('intercity')
  setIntercity(@Body(new ZodPipe(IntercityRules)) body: IntercityRules) {
    return this.settings.set('intercity', body);
  }

  @Get('fiscal')
  fiscal() {
    return this.settings.fiscal();
  }

  @Put('fiscal')
  setFiscal(@Body(new ZodPipe(FiscalRules)) body: FiscalRules) {
    return this.settings.set('fiscal', body);
  }

  /** Shared rides: the discount, detour limits, search radius (src/lib/pool.ts). */
  @Get('pool')
  pool() {
    return this.settings.pool();
  }

  @Put('pool')
  setPool(@Body(new ZodPipe(PoolRules)) body: PoolRules) {
    return this.settings.set('pool', body);
  }

  /** Deposits for bookings made in advance: share, minimum, payment window. */
  @Get('booking')
  booking() {
    return this.settings.booking();
  }

  @Put('booking')
  setBooking(@Body(new ZodPipe(BookingRules)) body: BookingRules) {
    return this.settings.set('booking', body);
  }

  /** Cargo and delivery: cargo class prices, loaders, the delivery share (src/lib/cargo.ts). */
  @Get('cargo')
  cargo() {
    return this.settings.cargo();
  }

  @Put('cargo')
  setCargo(@Body(new ZodPipe(CargoRules)) body: CargoRules) {
    return this.settings.set('cargo', body);
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
