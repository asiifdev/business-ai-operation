import { db } from '../../db/client';
import { emailLog } from '../../db/schema';
import { getEmailProvider } from '../../integrations/email';
import { EmailError, type EmailProvider } from '../../integrations/email/provider';
import { render, type EmailTemplate, type Locale } from './templates';

export type SendResult = { status: 'sent'; providerId: string } | { status: 'failed'; kind: string } | { status: 'skipped' };

interface Input {
  orgId: string;
  to: string;
  locale: Locale;
  message: EmailTemplate;
  /** The same key never mails twice within a day, even if this is called again (a retry, a double click). */
  idempotencyKey: string;
}

const RETRIES = 1;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The one way an email leaves the system (D-096). It renders the template, sends through the provider with a retry for
 * temporary trouble, records the attempt in `email_log` (never the message, the token or the link) and NEVER throws: a mail
 * that cannot be sent must not undo the thing the person just did. Callers read the result and tell the person.
 * Without a configured provider the result is `skipped`.
 */
export async function sendEmail(input: Input, deps: { provider?: EmailProvider | null; wait?: (ms: number) => Promise<void> } = {}): Promise<SendResult> {
  const provider = deps.provider === undefined ? getEmailProvider() : deps.provider;
  const log = (status: 'sent' | 'failed' | 'skipped', extra: { providerId?: string; error?: string } = {}) =>
    db.insert(emailLog).values({ orgId: input.orgId, template: input.message.template, recipient: input.to, status, providerId: extra.providerId ?? null, error: extra.error ?? null }).catch((err) => {
      console.error('email log failed', err);
    });

  if (!provider) {
    await log('skipped');
    return { status: 'skipped' };
  }
  const rendered = render(input.message, input.locale);
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { id } = await provider.send({ to: input.to, ...rendered }, { idempotencyKey: input.idempotencyKey });
      await log('sent', { providerId: id });
      return { status: 'sent', providerId: id };
    } catch (err) {
      const kind = err instanceof EmailError ? err.kind : 'transient';
      if (kind === 'transient' && attempt < RETRIES) {
        await (deps.wait ?? sleep)(800);
        continue;
      }
      if (!(err instanceof EmailError)) console.error('email send failed', err);
      await log('failed', { error: kind });
      return { status: 'failed', kind };
    }
  }
}
