import { env } from '../../lib/env';
import type { EmailProvider } from './provider';
import { ResendProvider } from './resend';

let override: EmailProvider | null | undefined;
/** Tests install a fake (or `null` for "not configured"); `undefined` goes back to the environment. */
export function setEmailProviderForTests(provider: EmailProvider | null | undefined) {
  override = provider;
}

/** Whether email is set up on this server: a Resend key and a sender address. Without them every email feature stays off, quietly. */
export const emailEnabled = (): boolean => override !== undefined ? override !== null : Boolean(env('RESEND_API_KEY') && env('EMAIL_FROM'));

export function getEmailProvider(): EmailProvider | null {
  if (override !== undefined) return override;
  const apiKey = env('RESEND_API_KEY');
  const from = env('EMAIL_FROM');
  return apiKey && from ? new ResendProvider({ apiKey, from }) : null;
}
