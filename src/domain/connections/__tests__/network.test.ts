import { describe, expect, it } from 'vitest';
import { DomainError } from '../../errors';
import { assertPublicHost, isPrivateAddress, pinnedLookup } from '../network';

describe('private address check (SSRF guard)', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255', '224.0.0.1',
    '::1', '::', 'fd00::1', 'FD00::1', 'fc00::', 'fe80::1', 'fec0::1', 'ff02::1', 'not-an-ip', '',
    // The notations a prefix check misses (security review):
    '::ffff:10.0.0.1', '::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '0000:0000:0000:0000:0000:ffff:a9fe:a9fe', '::127.0.0.1', '::7f00:1', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001',
    '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:a9fe:a9fe::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '2001:db8::1', 'fe80::1%eth0',
  ])('refuses %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '1.1.1.1', '103.127.96.158', '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e'])('accepts %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it('rejects a literal private host before any connection', async () => {
    await expect(assertPublicHost('169.254.169.254')).rejects.toBeInstanceOf(DomainError);
    await expect(assertPublicHost('8.8.8.8')).resolves.toBeUndefined();
  });
});

describe('resolve once, connect to what was checked', () => {
  it('returns the literal address for an IP and refuses a private one', async () => {
    const { resolvePublicHost } = await import('../network');
    expect(await resolvePublicHost('8.8.8.8')).toEqual({ address: '8.8.8.8', family: 4 });
    await expect(resolvePublicHost('10.0.0.1')).rejects.toBeInstanceOf(DomainError);
    await expect(resolvePublicHost('localhost')).rejects.toBeInstanceOf(DomainError); // resolves to loopback
  });
});

describe('pinnedLookup', () => {
  it('answers with a list when Node asks for all addresses (Node 20+), and with one address otherwise', () => {
    const lookup = pinnedLookup({ address: '203.0.113.7', family: 4 });
    let all: unknown;
    lookup('example.com', { all: true }, (_e, a) => { all = a; });
    expect(all).toEqual([{ address: '203.0.113.7', family: 4 }]);
    let single: unknown[] = [];
    lookup('example.com', {}, (_e, a, f) => { single = [a, f]; });
    expect(single).toEqual(['203.0.113.7', 4]);
  });
});
