import { Controller, Get, Inject, Injectable, Module } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { Public } from '../../core/auth/auth-context.js';
import { RateLimit } from '../../core/http/rate-limit.js';
import { DECLINE_REASONS } from '../dispatch/dispatch.module.js';
import { enabledProviders, TOPUP_MAX, TOPUP_MIN } from '../payments/payment-config.js';
import { DRIVER_CANCEL_REASONS } from '../rides/rides.service.js';
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
  public() {
    const providers = enabledProviders(this.env);
    return {
      support: this.support(),
      minAppVersion: {
        rider: this.env.MIN_RIDER_APP_VERSION,
        driver: this.env.MIN_DRIVER_APP_VERSION,
      },
      features: {
        cardPayments: providers.length > 0,
        uploads: storageConfig(this.env) !== null,
        intercity: true,
        maskedCalls: false,
        scheduledRides: false,
      },
      cardProviders: providers,
      shareBaseUrl: this.env.SHARE_BASE_URL,
    };
  }

  /** The rules a driver works under, in one place for the app's "money" and help screens. */
  async driver() {
    const [billing, dispatch, tariff] = await Promise.all([
      this.settings.billing(),
      this.settings.dispatch(),
      this.settings.tariff(),
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
