import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../../core/auth/auth-context.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { MAX_REAR_SEATS, MAX_TRIP_SEATS } from '../../lib/intercity.js';
import { DECLINE_REASONS, DRIVER_CANCEL_REASONS } from '../../lib/reasons.js';
import { TRIP_SPACING_HOURS } from '../intercity/intercity.service.js';
import { enabledProviders, TOPUP_MAX, TOPUP_MIN } from '../payments/payment-config.js';
import { SettingsService } from '../settings/settings.module.js';
import { storageConfig } from '../uploads/object-storage.js';

@Injectable()
export class AppConfigService {
  constructor(
    private readonly settings: SettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  support() {
    return {
      phone: this.env.SUPPORT_PHONE ?? null,
      telegram: this.env.SUPPORT_TELEGRAM ?? null,
      officeAddress: this.env.OFFICE_ADDRESS ?? null,
    };
  }

  /** What every app reads on start: contacts, required versions, what is switched on. */
  async public() {
    const providers = enabledProviders(this.env);
    const [intercity, booking] = await Promise.all([
      this.settings.intercity(),
      this.settings.booking(),
    ]);
    return {
      support: this.support(),
      // null: no forced update (set MIN_*_APP_VERSION to require one)
      minAppVersion: {
        rider: this.env.MIN_RIDER_APP_VERSION ?? null,
        driver: this.env.MIN_DRIVER_APP_VERSION ?? null,
      },
      // where the update screens send people; null: the apps use their own fallback
      storeUrls: {
        rider: {
          android: this.env.STORE_URL_ANDROID_RIDER ?? null,
          ios: this.env.STORE_URL_IOS_RIDER ?? null,
        },
        driver: {
          android: this.env.STORE_URL_ANDROID_DRIVER ?? null,
          ios: this.env.STORE_URL_IOS_DRIVER ?? null,
        },
      },
      features: {
        cardPayments: providers.length > 0,
        uploads: storageConfig(this.env) !== null,
        intercity: true,
        maskedCalls: false,
        scheduledRides: true,
        // operators can order a ride for later for a caller (a quote with scheduledFor)
        scheduledPhoneOrders: true,
        // a cash ride collects cancellation fees owed from earlier cash rides (a quote line)
        owedCancellationFees: true,
      },
      cardProviders: providers,
      // the seat board's cancellation rules riders agree to when booking
      intercity: {
        freeCancelMinutes: intercity.free_cancel_minutes,
        lateCancelFeePercent: intercity.late_cancel_fee_percent,
        // the seating rule: 1 front + 2 rear passengers at most
        maxSeats: MAX_TRIP_SEATS,
        maxRearSeats: MAX_REAR_SEATS,
      },
      // bookings in advance: this share of the price is paid by card first, the rest in cash
      // (0 percent: no deposit); unpaid within paymentMinutes the booking is dropped
      deposits: {
        percent: booking.deposit_percent,
        min: booking.deposit_min,
        paymentMinutes: booking.payment_minutes,
      },
      shareBaseUrl: this.env.SHARE_BASE_URL,
    };
  }

  /** The rules a driver works under, in one place for the app's "money" and help screens. */
  async driver() {
    const [billing, dispatch, tariff, intercity] = await Promise.all([
      this.settings.billing(),
      this.settings.dispatch(),
      this.settings.tariff(),
      this.settings.intercity(),
    ]);
    return {
      billing: {
        promoUntil: billing.promo_until,
        commissionPercent: billing.commission_percent,
        dailyCap: billing.daily_cap,
        weeklyCap: billing.weekly_cap,
        intercityCommissionPercent: billing.intercity_commission_percent,
        intercityTripCap: billing.intercity_trip_cap,
        taxPercent: billing.tax_percent,
        passes: { day: billing.pass_day_price, week: billing.pass_week_price },
        minBalance: billing.min_balance,
      },
      rides: {
        offerTimeoutSeconds: dispatch.offer_timeout_seconds,
        broadcastTimeoutSeconds: dispatch.broadcast_timeout_seconds,
        noShowAfterMinutes: dispatch.no_show_after_minutes,
        freeWaitingMinutes: tariff.waiting.free_minutes,
        waitingPerMinute: tariff.waiting.per_minute,
        cancellationFee: tariff.cancellation_fee,
      },
      // the trip board's timing and price rules (the band itself comes per route with fares)
      intercity: {
        publishMinMinutesAhead: intercity.publish_min_minutes_ahead,
        publishMaxDaysAhead: intercity.publish_max_days_ahead,
        tripSpacingHours: TRIP_SPACING_HOURS,
        boardingOpensMinutes: intercity.boarding_opens_minutes,
        priceBandPercent: intercity.price_band_percent,
        freeCancelMinutes: intercity.free_cancel_minutes,
        lateCancelFeePercent: intercity.late_cancel_fee_percent,
        // the seating rule: at most 3 seats offered, never more than 2 in the back
        maxSeats: MAX_TRIP_SEATS,
        maxRearSeats: MAX_REAR_SEATS,
        // riders between other towns the trip passes may book a seat for their part
        alongRouteMaxKm: intercity.along_route_max_km,
      },
      declineReasons: DECLINE_REASONS,
      cancelReasons: DRIVER_CANCEL_REASONS,
      topups: { min: TOPUP_MIN, max: TOPUP_MAX, providers: enabledProviders(this.env) },
      support: this.support(),
    };
  }
}

@Controller('config')
export class PublicConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Public()
  @RateLimit({ name: 'config', by: 'ip', max: 120, windowSeconds: 60 })
  @Get()
  get() {
    return this.config.public();
  }
}

@Controller('driver/config')
export class DriverConfigController {
  constructor(private readonly config: AppConfigService) {}

  /** Commission, caps, passes, minimum balance, waiting and no-show rules, reasons, support. */
  @Get()
  get() {
    return this.config.driver();
  }
}

@Module({
  controllers: [PublicConfigController, DriverConfigController],
  providers: [AppConfigService],
})
export class AppConfigModule {}
