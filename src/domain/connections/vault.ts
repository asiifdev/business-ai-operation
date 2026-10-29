import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../../lib/env';

/**
 * The vault for connection secrets (BR-M17-02, PRD M17). AES-256-GCM with a fresh random nonce per value. The stored text is
 * `base64(nonce | tag | ciphertext)`. The organization and connection ids are bound in as authenticated data, so a
 * ciphertext copied to another row or another organization fails to decrypt instead of being accepted.
 *
 * The master key is `CONNECTIONS_KEY` (32 bytes, base64). Its version is stored beside the value for rotation (⚠️ the
 * rotation procedure is not built yet: version 1 is the only one).
 */
export const KEY_VERSION = 1;

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function masterKey(): Buffer {
  const raw = env('CONNECTIONS_KEY');
  if (!raw) throw new Error('CONNECTIONS_KEY is not set: connections cannot hold secrets without it');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('CONNECTIONS_KEY must be 32 bytes, base64 encoded');
  return key;
}

const aad = (orgId: string, connectionId: string) => Buffer.from(`${orgId}:${connectionId}`, 'utf8');

export function encryptSecret(secret: Record<string, string>, orgId: string, connectionId: string): { ciphertext: string; keyVersion: number } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', masterKey(), nonce);
  cipher.setAAD(aad(orgId, connectionId));
  const body = Buffer.concat([cipher.update(JSON.stringify(secret), 'utf8'), cipher.final()]);
  return { ciphertext: Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64'), keyVersion: KEY_VERSION };
}

export function decryptSecret(ciphertext: string, orgId: string, connectionId: string): Record<string, string> {
  const raw = Buffer.from(ciphertext, 'base64');
  if (raw.length < NONCE_BYTES + TAG_BYTES) throw new Error('secret is damaged');
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), raw.subarray(0, NONCE_BYTES));
  decipher.setAAD(aad(orgId, connectionId));
  decipher.setAuthTag(raw.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES));
  const plain = Buffer.concat([decipher.update(raw.subarray(NONCE_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
  return JSON.parse(plain) as Record<string, string>;
}

/** What the screen may show of a secret: its last four characters, never more (BR-M17-02). */
export const secretHint = (value: string): string => (value.length <= 8 ? '••••' : `••••${value.slice(-4)}`);

/**
 * Replaces every known secret value in text with a mask, so a step's output or an error message can be kept and shown
 * without leaking a password the command echoed (BR-M17-03). Short values are skipped: masking "a" would shred the text.
 */
export function scrubSecrets(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const value of secrets) {
    if (value.length >= 4) out = out.split(value).join('••••');
  }
  return out;
}
