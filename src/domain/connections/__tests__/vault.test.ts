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

describe('key rotation', () => {
  it('opens a secret sealed with an older key version, and seals new ones with the current one', () => {
    const oldKey = process.env.CONNECTIONS_KEY!;
    const sealedV1 = encryptSecret({ apiKey: 'sealed-with-v1' }, 'o', 'c');
    expect(sealedV1.keyVersion).toBe(1);
    try {
      process.env.CONNECTIONS_KEY_V1 = oldKey;
      process.env.CONNECTIONS_KEY = Buffer.alloc(32, 7).toString('base64');
      process.env.CONNECTIONS_KEY_VERSION = '2';
      expect(decryptSecret(sealedV1.ciphertext, 'o', 'c', 1)).toEqual({ apiKey: 'sealed-with-v1' });
      const sealedV2 = encryptSecret({ apiKey: 'sealed-with-v2' }, 'o', 'c');
      expect(sealedV2.keyVersion).toBe(2);
      expect(decryptSecret(sealedV2.ciphertext, 'o', 'c', 2)).toEqual({ apiKey: 'sealed-with-v2' });
      expect(() => decryptSecret(sealedV1.ciphertext, 'o', 'c', 2)).toThrow(); // the wrong key does not open it
      delete process.env.CONNECTIONS_KEY_V1;
      expect(() => decryptSecret(sealedV1.ciphertext, 'o', 'c', 1)).toThrow(/CONNECTIONS_KEY_V1 is not set/);
    } finally {
      process.env.CONNECTIONS_KEY = oldKey;
      delete process.env.CONNECTIONS_KEY_VERSION;
      delete process.env.CONNECTIONS_KEY_V1;
    }
  });
});
