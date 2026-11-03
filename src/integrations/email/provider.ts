/** One email, ready to send. Both parts are always present: a mail client that cannot show HTML still gets the text. */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/**
 * Why a send failed. `transient` is worth one more try (rate limit, a busy provider, a network blip); the others are not:
 * `auth` is our key or sender domain, `rejected` is this message or address.
 */
export type EmailErrorKind = 'auth' | 'rejected' | 'transient';

export class EmailError extends Error {
  constructor(readonly kind: EmailErrorKind, message: string, readonly status?: number) {
    super(message);
    this.name = 'EmailError';
  }
}

/** The only door to an email service. `ResendProvider` is the real one; tests use `FakeEmailProvider`. */
export interface EmailProvider {
  /** `idempotencyKey` makes a retry of the same send harmless: the provider returns the first result instead of mailing twice. */
  send(message: EmailMessage, options: { idempotencyKey: string }): Promise<{ id: string }>;
}
