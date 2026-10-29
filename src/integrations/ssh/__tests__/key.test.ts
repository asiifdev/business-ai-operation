import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
import { describe, expect, it } from 'vitest';
import { checkPrivateKey, normalizePrivateKey } from '../key';

const { utils } = ssh2;

/** Real keys in the three shapes people paste: OpenSSH, legacy PEM (RSA), and legacy PEM protected by a passphrase. */
const openssh = utils.generateKeyPairSync('ed25519').private;
const opensshEnc = utils.generateKeyPairSync('ed25519', { passphrase: 'hunter2-pass', cipher: 'aes256-ctr', rounds: 8 }).private;
const rsaPem = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
const rsaPemEnc = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase: 'hunter2-pass' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;

describe('private key tidying', () => {
  it('leaves a clean key usable as it is', () => {
    for (const k of [openssh, rsaPem]) {
      const n = normalizePrivateKey(k)!;
      expect(checkPrivateKey(n)).toBe('ok');
      expect(n.endsWith('\n')).toBe(true);
    }
  });

  it('survives the shell marker glued to the END line (the real failure of 2026-10-29)', () => {
    const broken = rsaPem.trimEnd() + '%           ';
    expect(utils.parseKey(broken)).toBeInstanceOf(Error); // the parser refuses it as pasted
    expect(checkPrivateKey(normalizePrivateKey(broken)!)).toBe('ok');
  });

  it.each([
    ['Windows line breaks', (k: string) => k.replace(/\n/g, '\r\n')],
    ['indentation and trailing spaces', (k: string) => k.split('\n').map((l) => `   ${l}   `).join('\n')],
    ['blank lines between rows', (k: string) => k.split('\n').join('\n\n')],
    ['text around the key', (k: string) => `$ cat server.key\n${k}\nuser@host ~ %`],
    ['no final newline', (k: string) => k.trimEnd()],
  ])('survives %s', (_n, mangle) => {
    for (const k of [openssh, rsaPem]) expect(checkPrivateKey(normalizePrivateKey(mangle(k))!)).toBe('ok');
  });

  it('keeps the headers of a passphrase-protected PEM key and its blank line, even when mangled', () => {
    const mangled = rsaPemEnc.replace(/\n/g, '\r\n').split('\r\n').map((l) => `  ${l}`).join('\r\n');
    const n = normalizePrivateKey(mangled)!;
    expect(n).toContain('Proc-Type: 4,ENCRYPTED\nDEK-Info:');
    expect(checkPrivateKey(n, 'hunter2-pass')).toBe('ok');
  });

  it('refuses what is not a private key', () => {
    expect(normalizePrivateKey('hello')).toBeNull();
    expect(normalizePrivateKey('-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----')).toBeNull();
    expect(normalizePrivateKey('/Users/a/Documents/server.key')).toBeNull(); // a path, not the key
    expect(checkPrivateKey(normalizePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----')!)).toBe('unreadable');
  });

  it('says whether a passphrase is missing or wrong', () => {
    for (const k of [opensshEnc, rsaPemEnc]) {
      expect(checkPrivateKey(k)).toBe('needs_passphrase');
      expect(checkPrivateKey(k, 'not-it')).toBe('wrong_passphrase');
      expect(checkPrivateKey(k, 'hunter2-pass')).toBe('ok');
    }
  });
});
