import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Checks `X-Hub-Signature-256` (skill `github-app-integration` §8): HMAC-SHA256 hex digest of the RAW body with the webhook
 * secret, prefixed `sha256=`, compared in constant time. The body must be the exact bytes GitHub sent.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith('sha256=') || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
