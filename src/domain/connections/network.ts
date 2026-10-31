import type { LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { env } from '../../lib/env';
import { DomainError } from '../errors';

/**
 * A connection makes Orbyte's server call an address a user typed. Without a check, that is a way to reach the platform's
 * own internal network (loopback, cloud metadata, private ranges). Addresses like these are refused unless the operator
 * explicitly allows them for local development (`ALLOW_PRIVATE_CONNECTIONS=1`, never in production).
 *
 * The name is resolved ONCE, here, and the caller connects to the address returned: a hostile DNS answer that changes
 * between the check and the connection (DNS rebinding) cannot send the request somewhere else (D-059).
 */
const blocked = new BlockList();
/**
 * Ranges a user-supplied host must never point into: loopback, private, link-local (cloud metadata lives at 169.254.169.254),
 * shared and reserved space, multicast, and every IPv6 form that can carry an IPv4 address inside it (mapped, compatible,
 * NAT64, 6to4, Teredo). The address is parsed and matched against these subnets; it is never classified by text prefix,
 * which expanded or mixed notations such as `0:0:0:0:0:ffff:7f00:1` or `::127.0.0.1` slip past (security review, D-059).
 */
const IPV4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const IPV6_BLOCKED: Array<[string, number]> = [
  ['::', 96], // unspecified, loopback, and IPv4-compatible (::a.b.c.d)
  // IPv4-mapped (::ffff:a.b.c.d) needs no rule of its own: BlockList matches it against the IPv4 ranges above.
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], ['fec0::', 10], // link-local, site-local
  ['ff00::', 8], // multicast
];
for (const [net, prefix] of IPV4_BLOCKED) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of IPV6_BLOCKED) blocked.addSubnet(net, prefix, 'ipv6');

/** True for anything that is not a plain public address. Fails closed: text that is not an address counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 0 || ip.includes('%')) return true; // not an address, or carries a zone id
  return blocked.check(ip, version === 6 ? 'ipv6' : 'ipv4');
}

export async function resolvePublicHost(host: string): Promise<{ address: string; family: 4 | 6 }> {
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) as 4 | 6 }] : ((await lookup(host, { all: true }).catch(() => [])) as Array<{ address: string; family: number }>).map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
  if (addresses.length === 0) throw new DomainError('validation', 'host cannot be resolved');
  if (env('ALLOW_PRIVATE_CONNECTIONS') === '1') return addresses[0];
  // One private answer among several is enough to refuse: a name must not mix public and internal addresses.
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new DomainError('validation', 'host points to a private address');
  return addresses[0];
}

/**
 * A `lookup` for `http(s).request` that always answers with the address that passed the check. Node 20+ asks for a list of
 * addresses (`options.all`) and fails with "Invalid IP address: undefined" when given a single one, so both shapes are handled.
 */
export function pinnedLookup(pinned: { address: string; family: 4 | 6 }) {
  return (_host: string, options: { all?: boolean }, callback: (error: null, address: string | LookupAddress[], family?: number) => void): void => {
    if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  };
}

/** Validation at save time, when nothing is connected yet. */
export async function assertPublicHost(host: string): Promise<void> {
  await resolvePublicHost(host);
}
