import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { exchangeCode, listUserInstallations, type UserInstallation } from '../../integrations/github/oauth';
import type { Fetch } from '../../integrations/github/client';
import { env } from '../../lib/env';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';

/**
 * Proof that the person linking a GitHub installation can reach it (BR-M17-01, security review 2026-10-29). An
 * `installation_id` typed or sent by a client is never trusted: it must come out of a verification token that THIS server
 * signed after asking GitHub which installations the signed-in GitHub user may access. The token is bound to the
 * organization and the person, expires in 10 minutes, and lists the installations it vouches for.
 *
 * Both tokens (`state` for the round trip, `verification` for the result) are HMAC-SHA256 under a key derived from
 * `CONNECTIONS_KEY`, so nothing new has to be configured and a token cannot be used for any other purpose.
 */
const STATE_TTL_MS = 10 * 60_000;

function key(purpose: 'state' | 'verification'): Buffer {
  const master = env('CONNECTIONS_KEY');
  if (!master) throw new Error('CONNECTIONS_KEY is not set');
  return Buffer.from(hkdfSync('sha256', Buffer.from(master, 'base64'), Buffer.alloc(0), `orbyte-github-${purpose}`, 32));
}

function seal(purpose: 'state' | 'verification', payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', key(purpose)).update(body).digest('base64url')}`;
}

function open<T>(purpose: 'state' | 'verification', token: string): T | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', key(purpose)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
  } catch {
    return null;
  }
}

interface StatePayload {
  org: string;
  user: string;
  nonce: string;
  exp: number;
}
interface VerificationPayload {
  org: string;
  user: string;
  installations: UserInstallation[];
  exp: number;
}

/** Starts the round trip: a `state` for GitHub to echo and a nonce the browser keeps in a cookie (forgery defence). */
export function startVerification(ctx: Ctx): { state: string; nonce: string } {
  assertCan(ctx, 'connection.write');
  const nonce = randomBytes(16).toString('hex');
  return { state: seal('state', { org: ctx.orgId, user: ctx.userId, nonce, exp: ctx.clock.now().getTime() + STATE_TTL_MS } satisfies StatePayload), nonce };
}

export interface VerifyDeps {
  fetch: Fetch;
}

/** The return trip: checks `state` and the cookie nonce, asks GitHub what this person can reach, and returns the proof. */
export async function completeVerification(ctx: Ctx, input: { code: string; state: string; nonce: string; redirectUri: string }, deps: VerifyDeps = { fetch }): Promise<string> {
  assertCan(ctx, 'connection.write');
  const s = open<StatePayload>('state', input.state);
  const nonce = Buffer.from(input.nonce);
  if (!s || s.org !== ctx.orgId || s.user !== ctx.userId || s.exp < ctx.clock.now().getTime() || nonce.length !== s.nonce.length || !timingSafeEqual(nonce, Buffer.from(s.nonce))) {
    throw new DomainError('forbidden', 'GitHub verification does not match this session');
  }
  const userToken = await exchangeCode(input.code, input.redirectUri, deps.fetch);
  const installations = await listUserInstallations(userToken, deps.fetch); // the user token is dropped right after this
  return seal('verification', { org: ctx.orgId, user: ctx.userId, installations, exp: ctx.clock.now().getTime() + STATE_TTL_MS } satisfies VerificationPayload);
}

/** What a verification token vouches for, or `null` when it is forged, expired, or belongs to someone else. */
export function readVerification(ctx: Ctx, token: string): UserInstallation[] | null {
  const v = open<VerificationPayload>('verification', token);
  if (!v || v.org !== ctx.orgId || v.user !== ctx.userId || v.exp < ctx.clock.now().getTime()) return null;
  return v.installations;
}

/** Used by `createConnection`: the installation must be one the token vouches for. */
export function assertVerifiedInstallation(ctx: Ctx, token: string, installationId: number): UserInstallation {
  const found = readVerification(ctx, token)?.find((i) => i.id === installationId);
  if (!found) throw new DomainError('forbidden', 'installation is not verified for this person');
  return found;
}

/** Test helper: signs a verification the way `completeVerification` does, without calling GitHub. */
export function sealVerificationForTest(ctx: Ctx, installations: UserInstallation[], expMs = 10 * 60_000): string {
  return seal('verification', { org: ctx.orgId, user: ctx.userId, installations, exp: ctx.clock.now().getTime() + expMs } satisfies VerificationPayload);
}
