export interface SmsMessage {
  /** E.164, e.g. +998901234567. Adapters convert to the provider's format. */
  to: string;
  text: string;
}

export interface SmsReceipt {
  provider: string;
  /** The provider's id for the message, for delivery tracking and support tickets. */
  providerMessageId: string | null;
}

export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsReceipt>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

/** The provider refused or could not be reached. Message is safe to log (no credentials). */
export class SmsDeliveryError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(`${provider}: ${message}`);
  }
}

const TIMEOUT_MS = 10_000;

/** fetch with a hard timeout; network failures surface as SmsDeliveryError. */
export async function providerFetch(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new SmsDeliveryError(provider, `request failed: ${(error as Error).message}`);
  }
}

/** First 300 chars of a response body, for error messages. */
export async function bodySnippet(res: Response): Promise<string> {
  return (await res.text().catch(() => '')).slice(0, 300);
}
