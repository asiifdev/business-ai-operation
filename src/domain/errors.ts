export type DomainErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'email_taken'
  | 'last_owner'
  | 'invalid_state'
  | 'duplicate'
  | 'rate_limited';

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
};
