import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, scrubSecrets, secretHint } from '../vault';

describe('connection vault (BR-M17-02)', () => {
  it('round-trips a secret and never stores it readable', () => {
    const { ciphertext, keyVersion } = encryptSecret({ password: 'sup3r-secret-pw' }, 'org1', 'conn1');
    expect(ciphertext).not.toContain('sup3r');
    expect(Buffer.from(ciphertext, 'base64').toString('utf8')).not.toContain('sup3r');
    expect(keyVersion).toBe(1);
    expect(decryptSecret(ciphertext, 'org1', 'conn1')).toEqual({ password: 'sup3r-secret-pw' });
  });

  it('uses a fresh nonce each time', () => {
    expect(encryptSecret({ a: 'same-value' }, 'o', 'c').ciphertext).not.toBe(encryptSecret({ a: 'same-value' }, 'o', 'c').ciphertext);
  });

  it('refuses a ciphertext moved to another organization or connection', () => {
    const { ciphertext } = encryptSecret({ apiKey: 'k-123456789' }, 'org1', 'conn1');
    expect(() => decryptSecret(ciphertext, 'org2', 'conn1')).toThrow();
    expect(() => decryptSecret(ciphertext, 'org1', 'conn2')).toThrow();
  });

  it('refuses a tampered or truncated value', () => {
    const { ciphertext } = encryptSecret({ apiKey: 'k-123456789' }, 'o', 'c');
    const raw = Buffer.from(ciphertext, 'base64');
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(raw.toString('base64'), 'o', 'c')).toThrow();
    expect(() => decryptSecret('AAAA', 'o', 'c')).toThrow();
  });

  it('shows only the last four characters', () => {
    expect(secretHint('abcdefghijkl')).toBe('••••ijkl');
    expect(secretHint('short')).toBe('••••');
  });

  it('scrubs known secret values from text', () => {
    expect(scrubSecrets('login with hunter2-pass then hunter2-pass', ['hunter2-pass'])).toBe('login with •••• then ••••');
    expect(scrubSecrets('a b c', ['a'])).toBe('a b c');
  });
});
