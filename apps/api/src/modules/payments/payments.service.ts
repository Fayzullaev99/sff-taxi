import { BadRequestException, Injectable } from '@nestjs/common';

export type PaymentMethod = 'cash' | 'card';

/**
 * A card acquirer the rider pays through (Payme, Click). Only the hook exists for now: the
 * market is cash-first (63% of legal taxi turnover in 2026, market analysis §5.5). To add
 * one: implement this, register it in PaymentsService, and have the ride's completion wait
 * for the provider's confirmation instead of marking cash as paid.
 */
export interface CardGateway {
  readonly name: 'payme' | 'click';
  /** Whether its credentials are configured. */
  readonly configured: boolean;
  /** Hold or charge the fare; returns the provider's checkout URL for the rider. */
  checkout(ride: { id: string; number: number; amount: number }): Promise<{ url: string }>;
}

@Injectable()
export class PaymentsService {
  /** Configured card gateways; none are wired yet. */
  private readonly gateways: CardGateway[] = [];

  /** Methods riders may choose now. */
  methods(): PaymentMethod[] {
    return this.gateways.some((g) => g.configured) ? ['cash', 'card'] : ['cash'];
  }

  assertAvailable(method: PaymentMethod): void {
    if (!this.methods().includes(method)) {
      throw new BadRequestException('Karta orqali to‘lov hali ulanmagan: naqd to‘lang');
    }
  }
}
