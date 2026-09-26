# Fiscal receipts and licence verification

Cabinet Resolution No. 200 (02.04.2025) makes two integrations a condition of operating as a
taxi aggregator (market analysis §4, backlog A4/A5):

1. every ride, **cash rides included**, gets an **electronic fiscal receipt** through the tax
   authority's systems (Soliq, via an online fiscal data operator, OFD);
2. the aggregator serves **only licensed carriers** and shares liability for unlicensed ones:
   licence cards are checked with the **Ministry of Transport**.

Both are built as adapters with a safe default, so the platform runs today and the real
integrations are one class each once the contracts exist.

| Integration     | Env                     | Default  | What the default does                                        |
| --------------- | ----------------------- | -------- | ------------------------------------------------------------ |
| Fiscal receipts | `FISCAL_PROVIDER`       | `none`   | Prepares and stores every receipt (`skipped`), sends nothing |
| Licence cards   | `LICENCE_REGISTRY`      | `manual` | Operators check the registry by hand and record the result   |
| Receipt content | `admin/settings/fiscal` | codes 0  | Item names, MXIK and package codes (placeholders), VAT 0%    |

## 1. Fiscal receipts

### How it works

- Completing a ride (`driver/rides/:id/complete`) or arriving with an intercity booking
  aboard (`driver/intercity/trips/:id/arrive`) emits `fiscal.receipt_due` in the same
  transaction: a receipt is due if and only if the ride really completed.
- The worker's `fiscal` outbox handler calls `FiscalService.issue()`:
  1. builds the payload once (`src/modules/fiscal/receipt-payload.ts`) and stores it in
     `fiscal_receipts` (unique per ride / booking);
  2. calls the `FiscalProvider` (`src/modules/fiscal/fiscal-provider.ts`);
  3. records `sent` with the provider's receipt id, fiscal sign and **receipt URL** (the QR
     link the rider opens; shown as `receipt.url` in the rider's ride view), or `skipped`
     when the provider sends nothing (`none`).
- A provider failure throws: the receipt stays `pending` with its error and attempt count,
  and the **outbox retries the event with backoff** (5 s, 10 s, 20 s … 1 h, 10 attempts).
  After that the event is dead: `GET admin/outbox?state=dead`, retry with
  `POST admin/outbox/:id/retry` once the cause is fixed.
- Idempotency: the payload's `receiptNumber` (`R-<ride id>` / `B-<booking id>`) is stable
  across retries; the provider must pass it to the OFD as the merchant's receipt id so a
  retry after a timeout never issues a second receipt. A redelivered event after `sent`
  does nothing.
- Receipts kept while `FISCAL_PROVIDER=none` can be sent later:
  `POST admin/fiscal/receipts/resend {"status":"skipped"}` (and `"pending"` to retry stuck ones).
  `GET admin/fiscal/receipts?status=` lists them with their payloads.

### The receipt

The platform issues it **as the commission agent** of the self-employed driver (the
supplier): the driver's PINFL goes into the item's commission info, the platform's TIN is the
cash register owner's. One item per receipt:

| Field                | Ride                                                                           | Intercity booking     |
| -------------------- | ------------------------------------------------------------------------------ | --------------------- |
| name                 | `city_item_name`                                                               | `intercity_item_name` |
| MXIK (IKPU), package | `mxik_code`, `package_code` (settings)                                         | same                  |
| quantity (× 1000)    | 1 000                                                                          | seats × 1 000         |
| price (tiyin)        | fare total (quote + paid waiting)                                              | booking price         |
| VAT                  | `vat_percent`, included (0 by default)                                         | same                  |
| cash / card (tiyin)  | cash rides all cash; card rides the prepaid fare as card, paid waiting as cash | all cash              |
| commission info      | driver's PINFL                                                                 | driver's PINFL        |

### What we need from Soliq (and an OFD operator) to switch it on

1. **Registration as a taxi aggregator with the tax authority** and the platform's online
   cash register (virtual CRM/"onlayn NKM") under our TIN; the agreement that allows issuing
   receipts on behalf of self-employed drivers (commission-agent scheme, the drivers'
   PINFL in the receipt).
2. **An OFD operator contract** (the providers Yandex, MyTaxi and Uklon use) with API access:
   sandbox and production URLs, credentials, the receipt schema, how the merchant's receipt id
   makes a submission idempotent, rate limits, the receipt link / QR format, and how
   refunds are receipted (a refund receipt for cancelled prepaid card rides).
3. **The classifier codes**: the MXIK (IKPU) code for passenger transport by taxi (city) and
   for intercity seats, and their package codes, from tasnif.soliq.uz, confirmed with the tax
   adviser. Until then the settings hold zeros and nothing is sent.
4. **VAT**: confirm 0% for self-employed drivers under the turnover tax (and what changes
   above the 1 bn so'm/year threshold).
5. Whether the **1% withholding report** (`GET admin/billing/taxes`) must also be submitted
   electronically, and in which format (today it is a report for the accountant).

Then: implement `FiscalProvider` for the operator's API (map `ReceiptPayload` to its fields),
add its name to `FISCAL_PROVIDER` in `src/config/env.ts`, return it from
`createFiscalProvider`, set the real codes in `admin/settings/fiscal`, deploy, and resend the
kept receipts.

## 2. Licence cards

### How it works

- Applying (or changing the licence card number on a re-application) sets the driver's
  `licence_status` to `unverified` and emits `driver.licence_check_requested`.
- The worker's `licence` handler asks the `LicenceRegistry`
  (`src/modules/drivers/licence-registry.ts`). The `manual` registry answers nothing: the
  application waits for an operator.
- Operators check the card in the Ministry of Transport's registry and record the result:
  `POST admin/drivers/:id/licence {"result":"valid"|"invalid","note":"...","expiresOn":null}`.
  Every check is kept (`licence_checks`: source, card number, result, note, who, when) and
  shown in the operator's driver view (`licenceChecks`).
- **Approval needs a valid card**, as does going online. An `invalid` result takes a driver
  off the line at once and withdraws their offers. The driver's profile shows
  `licenceCard.verification` and a blocker while it is not valid.
- Drivers approved before this check existed were migrated as valid (their approving
  operator checked them).

### What we need from the Ministry of Transport to automate it

1. Access to the licence-card registry API (the "Uztrans"/National Agency of Perspective
   Projects systems Resolution 200 names): URL, credentials, the query (card number, PINFL,
   plate) and the answer (valid/revoked/expired, valid until, the vehicle on the card).
2. Whether the aggregator must also **report** its drivers and rides to the Ministry (the
   resolution's integration clause), and the format.
3. How revocations are published: a webhook or a periodic re-check (then the worker re-checks
   active drivers daily; the handler already only applies a verdict to the card it was asked
   about).

Then: implement `LicenceRegistry` (name `mintrans`), add it to `LICENCE_REGISTRY` in
`src/config/env.ts` and `createLicenceRegistry`; verdicts are recorded with source
`mintrans`. A temporary failure throws and the outbox retries.
