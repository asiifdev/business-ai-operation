export type TelegramErrorKind =
  /** 401: token wrong or revoked. */
  | 'auth'
  /** 403: the user blocked the bot or never started it. Mark the link blocked, do not retry. */
  | 'blocked'
  /** 400: our request is wrong (bad markup, text too long, message gone). Do not retry unchanged. */
  | 'bad_request'
  | 'not_found'
  /** 429 after the waits ran out. */
  | 'rate_limited'
  | 'unavailable'
  | 'too_large'
  | 'config';

/** Failure from the Telegram Bot API. `message` never contains the bot token, which sits in the request URL. */
export class TelegramError extends Error {
  constructor(
    public readonly kind: TelegramErrorKind,
    message: string,
    public readonly details: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}
