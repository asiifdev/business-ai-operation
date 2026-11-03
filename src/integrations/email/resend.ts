import { EmailError, type EmailMessage, type EmailProvider } from './provider';

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 15_000;

/**
 * Resend's REST API (`POST /emails`, Bearer key, `Idempotency-Key` header), called with plain `fetch`: one endpoint does
 * not need an SDK. The key and the message are never logged. Resend answers 429 when over its per-second limit and 409
 * while an earlier request with the same idempotency key is still running; both are worth a retry.
 */
export class ResendProvider implements EmailProvider {
  constructor(
    private readonly options: { apiKey: string; from: string; fetch?: typeof fetch },
  ) {}

  async send(message: EmailMessage, { idempotencyKey }: { idempotencyKey: string }): Promise<{ id: string }> {
    const doFetch = this.options.fetch ?? fetch;
    let res: Response;
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
          // Resend refuses requests that carry no User-Agent.
          'user-agent': 'orbyte-mailer/1.0',
          'idempotency-key': idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: this.options.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new EmailError('transient', 'network error or timeout');
    }
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { id?: string } | null;
      if (!body?.id) throw new EmailError('transient', 'the provider answered without an id', res.status);
      return { id: body.id };
    }
    if (res.status === 401 || res.status === 403) throw new EmailError('auth', 'the provider refused the key or the sender domain', res.status);
    if (res.status === 429 || res.status === 409 || res.status >= 500) throw new EmailError('transient', `provider answered ${res.status}`, res.status);
    throw new EmailError('rejected', `provider answered ${res.status}`, res.status);
  }
}
