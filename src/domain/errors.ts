export type DomainErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'email_taken'
  | 'last_owner'
  | 'invalid_state'
  | 'duplicate'
  | 'rate_limited'
  /** An approval whose time ran out (BR-M08-05). */
  | 'expired'
  /** An approval someone else already decided, on the web or in Telegram (BR-M08-06). */
  | 'already_decided'
  /** A pasted private key that cannot be used: unreadable, needs its passphrase, or the passphrase is wrong. */
  | 'key_unreadable'
  | 'key_needs_passphrase'
  | 'key_wrong_passphrase';

/** Business-rule failure. Endpoints map `code` to an HTTP status and an i18n message; `message` is for logs only. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export const HTTP_STATUS: Record<DomainErrorCode, number> = {
  validation: 400,
  forbidden: 403,
  not_found: 404,
  email_taken: 409,
  last_owner: 409,
  invalid_state: 409,
  duplicate: 409,
  rate_limited: 429,
  expired: 409,
  already_decided: 409,
  key_unreadable: 400,
  key_needs_passphrase: 400,
  key_wrong_passphrase: 400,
};
