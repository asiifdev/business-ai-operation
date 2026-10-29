import { describe, expect, it } from 'vitest';
import { DomainError } from '../../errors';
import { assertPublicHost, isPrivateAddress } from '../network';

describe('private address check (SSRF guard)', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', 'not-an-ip'])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111'])('accepts %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it('rejects a literal private host before any connection', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toBeInstanceOf(DomainError);
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
  });
});
