// `ssh2` is CommonJS: imported whole so the built server can load it (see client.ts).
import ssh2 from 'ssh2';

const { utils } = ssh2;

/**
 * Private keys arrive by copy and paste, and a paste carries debris: Windows line breaks, indentation, blank lines, a shell's
 * "no newline at end" marker (`%` in zsh) glued to the last line, or text around the key. A key that is fine on disk must not
 * fail because of that. This keeps only the key block, trims every line, and rebuilds it with plain line breaks (found
 * when a real key ending in `-----END RSA PRIVATE KEY-----%` was refused as "unsupported", 2026-10-29).
 */
const BLOCK = /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

export function normalizePrivateKey(raw: string): string | null {
  const m = BLOCK.exec(raw.replace(/\r\n?/g, '\n'));
  if (!m) return null;
  const lines = m[2].split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  // The headers of an encrypted PEM key (`Proc-Type`, `DEK-Info`) must be followed by one blank line before the body.
  const lastHeader = lines.reduce((acc, l, i) => (/^[A-Za-z-]+:\s/.test(l) ? i : acc), -1);
  const out = lastHeader >= 0 ? [...lines.slice(0, lastHeader + 1), '', ...lines.slice(lastHeader + 1)] : lines;
  return `-----BEGIN ${m[1]}-----\n${out.join('\n')}\n-----END ${m[1]}-----\n`;
}

export type KeyCheck = 'ok' | 'unreadable' | 'needs_passphrase' | 'wrong_passphrase' | 'not_private';

/** Whether this key can really be used for login with this passphrase, decided by the same parser the SSH client uses. */
export function checkPrivateKey(key: string, passphrase?: string): KeyCheck {
  const parsed = utils.parseKey(key, passphrase || undefined);
  if (parsed instanceof Error) {
    const msg = parsed.message;
    if (/no passphrase given/i.test(msg)) return 'needs_passphrase';
    if (/bad passphrase|passphrase/i.test(msg)) return 'wrong_passphrase';
    return 'unreadable';
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first && first.isPrivateKey() ? 'ok' : 'not_private';
}
