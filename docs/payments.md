# Card payments

Riders pay card rides and drivers top up their prepaid balance through **Payme** and **Click**.
The platform is the merchant of record: one Payme cashbox and one Click service for everything.
The provider protocols, idempotency and expiry are SFF Eats' payments module, ported
(`src/modules/payments`) and keyed by a **payment intent** instead of an order.

## Decision: card rides are prepaid

Options were: charge after completion, pre-authorise (hold) and capture, or prepay.

- **Charge after completion** needs a saved card (Payme Subscribe API / Click card tokens,
  separate contracts, PCI scope for tokens) or a checkout page at the end of the ride, where a
  rider can simply walk away.
- **Pre-authorisation** also needs card tokens and hold/confirm support from both providers.
- **Prepaying** works with the Merchant APIs we already run in SFF Eats (a hosted checkout
  page, callbacks), and our price is **fixed at the quote** (no surge, no meter): what is
  prepaid is exactly the fare.

So a card ride is **paid before dispatch**:

1. `POST /v1/rides` with `paymentMethod: "card"` creates the ride in `awaiting_payment` and a
   payment intent for the quoted fare (10 minutes, the quote's lifetime). The answer carries
   `payment.checkout.payme` and `payment.checkout.click`: the app opens one of them.
2. The provider's callback performs the payment: the ride goes to `searching` (its search
   timer starts now) and is dispatched like any other. `ride.updated` tells the app.
3. Not paid in time: the worker's housekeeping cancels the ride (`cancelledBy: system`,
   `paymentStatus: failed`). A payment the rider is completing right now (a provider
   transaction opened in the last 5 minutes) gets that grace first.
4. The rider may cancel while paying: the intent closes and a late provider call is refused.

**Paid waiting** on a card ride (after the free minutes) is collected in **cash** by the driver:
it is not known at payment time. The driver's earnings show it as cash.

**Cancelled after payment** (rider, driver no-show, operator, system): the whole payment is
queued for a **full refund** (`paymentStatus: refund_pending`, `GET admin/payments/refunds`).
Operators refund it in the Payme cabinet (Payme's `CancelTransaction` callback then records
`refunded`) or reverse it in Click and record it (`POST admin/payments/:id/refunded
{reference}`). A cancellation fee owed on a card ride is recorded like on a cash ride and not
kept from the refund (the Merchant APIs refund whole transactions only).

**The driver's money**: on completion the prepaid fare is credited to the driver's balance
(`card_fare`), the tax and commission are debited as for any ride. Operators pay balances out
to the driver's card or account and record it (`payout`, never above the balance) — the market
analysis' "card rides → payout to card at least daily".

Phone orders (operators) stay cash; intercity seats are paid in cash to the driver.

## Driver top-ups

The prepaid balance model: cash rides leave the fare with the driver; the platform's
commission and the withheld 1% tax are debited from the balance; a driver below the minimum
balance (−10 000 by default) cannot go online. Top-ups:

- cash at the office: operators record `topup` (a double click within a minute is refused);
- by card: `POST /v1/driver/topups {amount}` (5 000..5 000 000 so'm, 30 minutes to pay) →
  checkout links; the provider's confirmation credits the balance **once per payment** (a unique
  index on the ledger's `payment_intent_id`); a top-up refunded from the Payme cabinet is taken
  back with an `adjustment`.

## The protocols (as in SFF Eats)

|             | Payme Merchant API                                                                  | Click SHOP API                                                                                                |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Endpoint    | `POST /v1/payments/payme` (JSON-RPC 2.0)                                            | `POST /v1/payments/click/prepare`, `/complete` (form posts)                                                   |
| Auth        | `Authorization: Basic base64(Paycom:<PAYME_KEY>)`, compared in constant time        | MD5 `sign_string` of the fields and `CLICK_SECRET`, compared in constant time                                 |
| Our id      | account field `order_id` = the intent id                                            | `merchant_trans_id` = the intent id                                                                           |
| Amount      | tiyin, must equal the intent × 100                                                  | so'm (`"7000.00"` accepted), must equal the intent                                                            |
| Idempotency | `(provider, external_id)` unique; a repeated Create/Perform/Cancel answers the same | a repeated Prepare returns the same `merchant_prepare_id`; Complete of a performed one answers "already paid" |
| Timeouts    | a created transaction older than 12 h is cancelled on Perform                       | Complete with `error < 0` cancels                                                                             |
| Reports     | `CheckTransaction`, `GetStatement`                                                  | —                                                                                                             |

Every callback runs in one transaction that locks the intent (and the ride): of two providers
racing for one intent, the first to perform wins and the other is refused (its money never
leaves the card, or is returned by the provider). States only move forward. One performed
transaction per intent is enforced by a partial unique index.

## Setting up

In `.env.prod`: `PAYME_MERCHANT_ID`, `PAYME_KEY` (and `PAYME_TEST=true` for the sandbox),
`CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET`, optionally the page or deep link the
checkout returns to (`{intentId}` is replaced): `PAYMENT_RETURN_URL_RIDE` for ride payments (the
rider app, `sfftaxi://payments/{intentId}`), `PAYMENT_RETURN_URL_TOPUP` for driver top-ups (the
driver app, `sff-taxi-driver://topup?id={intentId}`), `PAYMENT_RETURN_URL` as the fallback for
both. A provider is offered once all its values are set; with none, riders see cash only and
top-ups are cash at the office.

Cabinets:

- Payme: endpoint `https://api.<domain>/v1/payments/payme`; one account field named `order_id`.
- Click: Prepare `https://api.<domain>/v1/payments/click/prepare`, Complete
  `https://api.<domain>/v1/payments/click/complete`.

Test with the sandbox and a 5 000 top-up before switching card rides on for riders.

## Not built (next)

- Tips by card (an intent of purpose `tip` credited 100% to the driver's balance).
- Card-on-file (Payme Subscribe / Click card tokens): one-tap payment and holds.
- Automatic payouts to drivers' cards (today operators record transfers).
- Collecting owed cancellation fees from card riders (cash rides collect them: architecture §5).

## Operators

- `GET admin/payments/intents?purpose&status&provider&driverId&rideId&phone&from&to&cursor`: every
  ride prepayment and top-up, newest first (`status=failed` = expired or cancelled);
  `GET admin/payments/intents/summary?from&to`: count and amount per purpose and status.
- `GET admin/drivers/payouts`: card money owed per driver (card fares minus payouts), with
  `payableNow` (a payout cannot exceed the balance); the driver list has `cardOwed`, the driver
  view `cardMoney`.
- Drivers get a push and `topup.updated` on their stream when a top-up is paid; riders a push and
  `ride.refund` when a refund is queued and when it is made.
