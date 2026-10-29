import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { env } from '../../lib/env';
import { DomainError } from '../errors';

/**
 * A connection makes Orbyte's server call an address a user typed. Without a check, that is a way to reach the platform's
 * own internal network (loopback, cloud metadata, private ranges). Addresses like these are refused unless the operator
 * explicitly allows them for local development (`ALLOW_PRIVATE_CONNECTIONS=1`). ⚠️ The name is resolved once here and again
 * when connecting, so a hostile DNS answer that changes in between is not fully covered (to be pinned to the resolved IP).
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true;
    if (x.startsWith('::ffff:')) return isPrivateAddress(x.slice(7));
    return x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
  }
  return true;
}

export async function assertPublicHost(host: string): Promise<void> {
  if (env('ALLOW_PRIVATE_CONNECTIONS') === '1') return;
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new DomainError('validation', 'host cannot be resolved');
  if (addresses.some(isPrivateAddress)) throw new DomainError('validation', 'host points to a private address');
}
