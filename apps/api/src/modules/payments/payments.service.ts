import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { enabledProviders } from './payment-config.js';

/** How the rider pays: cash to the driver, or card (Payme/Click) before dispatch. */
export type PaymentMethod = 'cash' | 'card';

/** Which payment methods riders may choose (card once a provider is configured). */
@Injectable()
export class PaymentsService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  methods(): PaymentMethod[] {
    return enabledProviders(this.env).length ? ['cash', 'card'] : ['cash'];
  }

  /** The providers a card payment can go through, for the apps to show. */
  providers() {
    return enabledProviders(this.env);
  }

  assertAvailable(method: PaymentMethod): void {
    if (!this.methods().includes(method)) {
      throw new BadRequestException('Karta orqali to‘lov hali ulanmagan: naqd to‘lang');
    }
  }
}
