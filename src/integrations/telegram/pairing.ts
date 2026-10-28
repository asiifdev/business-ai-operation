import { createHash, randomBytes } from 'node:crypto';

/** Deep-link parameter: at most 64 characters of `A-Za-z0-9_-`. 16 random bytes give 128 bits in 22 characters. */
export function generatePairingCode(): string {
  return randomBytes(16).toString('base64url');
}

/** Only the hash is stored, so a database leak does not hand out working codes (ERD `telegram_pairing_codes`). */
export function hashPairingCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

const CODE = /^[A-Za-z0-9_-]{16,64}$/;

/** Reads the code out of `/start <code>` (also `/start@bot <code>`). Returns null for a plain `/start` or junk. */
export function parseStartCommand(text: string | undefined): { code: string | null } | null {
  const match = text ? /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text) : null;
  if (!match) return null;
  return { code: match[1] && CODE.test(match[1]) ? match[1] : null };
}

export function pairingLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=${code}`;
}
