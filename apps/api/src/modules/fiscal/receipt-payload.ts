/**
 * The electronic fiscal receipt of a ride or an intercity booking, in the shape Uzbekistan's
 * OFD APIs use (items with the MXIK/IKPU classifier code, the package code, prices in tiyin,
 * cash and card amounts, the commission-agent details). The platform issues it as the agent
 * of the self-employed driver, who is the supplier: the driver's PINFL goes in the item's
 * commission info. The exact field names of the chosen OFD operator are mapped by its
 * FiscalProvider; this is the neutral form stored with every receipt.
 */
export interface ReceiptPayload {
  /** Our receipt number, unique and stable across retries (the idempotency key). */
  receiptNumber: string;
  /** When the rider paid (the ride's completion). */
  time: string;
  kind: 'ride' | 'intercity';
  /** The ride or booking number people see. */
  orderNumber: number;
  items: {
    name: string;
    /** MXIK (IKPU) classifier code, 17 digits. */
    mxik: string;
    packageCode: string;
    /** Units x 1000, as OFD APIs count quantities. */
    amount: number;
    /** Tiyin. */
    price: number;
    vatPercent: number;
    vat: number;
    /** The supplier the platform sells for: the self-employed driver. */
    commissionInfo: { pinfl: string };
  }[];
  /** Tiyin paid in cash (to the driver) and by card (to the platform). */
  receivedCash: number;
  receivedCard: number;
  /** For the rider's copy. */
  extra: { phone: string | null; from: string | null; to: string | null };
}

export interface ReceiptInput {
  kind: 'ride' | 'intercity';
  id: string;
  number: number;
  completedAt: Date;
  /** so'm: what the rider paid in total. */
  total: number;
  /** so'm of `total` paid by card (prepaid card rides); the rest was cash. */
  card: number;
  driverPinfl: string;
  riderPhone: string | null;
  from: string | null;
  to: string | null;
  /** For intercity bookings: seats. */
  quantity: number;
  /** A ride's service: cargo and delivery rides have their own item names. */
  service?: 'taxi' | 'cargo' | 'delivery';
  rules: {
    city_item_name: string;
    intercity_item_name: string;
    cargo_item_name?: string;
    delivery_item_name?: string;
    mxik_code: string;
    package_code: string;
    vat_percent: number;
  };
}

/** The receipt item's name: by the ride's service, or the intercity seat. */
function itemName(i: ReceiptInput): string {
  if (i.kind === 'intercity') return i.rules.intercity_item_name;
  if (i.service === 'cargo') return i.rules.cargo_item_name ?? 'Yuk tashish xizmati';
  if (i.service === 'delivery') {
    return i.rules.delivery_item_name ?? 'Yetkazib berish xizmati (posilka)';
  }
  return i.rules.city_item_name;
}

export function buildReceiptPayload(i: ReceiptInput): ReceiptPayload {
  const totalTiyin = i.total * 100;
  // VAT included in the price (0 for self-employed drivers under the turnover tax)
  const vat = Math.round((totalTiyin * i.rules.vat_percent) / (100 + i.rules.vat_percent));
  return {
    receiptNumber: `${i.kind === 'ride' ? 'R' : 'B'}-${i.id}`,
    time: i.completedAt.toISOString(),
    kind: i.kind,
    orderNumber: i.number,
    items: [
      {
        name: itemName(i),
        mxik: i.rules.mxik_code,
        packageCode: i.rules.package_code,
        amount: i.quantity * 1000,
        price: totalTiyin,
        vatPercent: i.rules.vat_percent,
        vat,
        commissionInfo: { pinfl: i.driverPinfl },
      },
    ],
    receivedCash: (i.total - i.card) * 100,
    receivedCard: i.card * 100,
    extra: { phone: i.riderPhone, from: i.from, to: i.to },
  };
}
