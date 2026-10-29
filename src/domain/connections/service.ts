import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { newId } from '../../db/ids';
import { connections, deployments, playbookRuns, productSetups } from '../../db/schema';
import { AapanelError, aapanelPing } from '../../integrations/aapanel/client';
import { GithubError, githubClient, type GithubClient } from '../../integrations/github/client';
import { checkPrivateKey, normalizePrivateKey } from '../../integrations/ssh/key';
import { sshConnect, SshError, type AuthMethod, type SshConfig, type SshSecret, type SshSession } from '../../integrations/ssh/client';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { who } from '../portfolio/shared';
import { assertVerifiedInstallation, readVerification } from './github-verify';
import { assertPublicHost, resolvePublicHost } from './network';
import { currentKeyVersion, decryptSecret, encryptSecret, secretHint } from './vault';

const name = z.string().trim().min(2).max(80);
const host = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9.:-]{1,253}$/)
  .refine((h) => !h.startsWith('-') && !h.includes('..'), 'host');
const username = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,64}$/);
const privateKey = z.string().max(20_000).refine((k) => k.includes('-----BEGIN') && k.includes('PRIVATE KEY'), 'key');
const AUTH_METHODS = ['password', 'private_key', 'key_and_password'] as const;

/** `verification` is the proof `completeVerification` signed: a bare installation id is never accepted (security review). */
const githubInput = z.object({ kind: z.literal('github'), name: name.optional(), installationId: z.number().int().positive(), verification: z.string().min(10).max(4000) });
const sshInput = z
  .object({
    kind: z.literal('ssh'),
    name,
    host,
    port: z.number().int().min(1).max(65_535).default(22),
    username,
    authMethod: z.enum(AUTH_METHODS),
    password: z.string().min(1).max(500).optional(),
    privateKey: privateKey.optional(),
    passphrase: z.string().max(500).optional(),
  })
  .refine((v) => (v.authMethod === 'private_key' ? true : Boolean(v.password)), { message: 'password', path: ['password'] })
  .refine((v) => (v.authMethod === 'password' ? true : Boolean(v.privateKey)), { message: 'privateKey', path: ['privateKey'] });
const aapanelInput = z.object({
  kind: z.literal('aapanel'),
  name,
  url: z
    .string()
    .trim()
    .transform((u) => {
      try {
        const x = new URL(u);
        if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password) return '';
        return x.origin;
      } catch {
        return '';
      }
    })
    .pipe(z.string().min(1)),
  apiKey: z.string().min(8).max(200),
  tlsInsecure: z.boolean().default(false),
});
export const connectionSchema = z.discriminatedUnion('kind', [githubInput, sshInput, aapanelInput]);
export type ConnectionInput = z.input<typeof connectionSchema>;

/** Tidies a pasted key and proves it can be used with its passphrase, before anything is stored (BR-M17-08). */
function acceptPrivateKey(raw: string, passphrase: string | undefined): string {
  const key = normalizePrivateKey(raw);
  if (!key) throw new DomainError('key_unreadable');
  const check = checkPrivateKey(key, passphrase);
  if (check === 'needs_passphrase') throw new DomainError('key_needs_passphrase');
  if (check === 'wrong_passphrase') throw new DomainError('key_wrong_passphrase');
  if (check !== 'ok') throw new DomainError('key_unreadable');
  return key;
}

/** What a screen or an API may see of a connection. Never a secret, never the ciphertext (BR-M17-02). */
export interface ConnectionView {
  id: string;
  kind: 'github' | 'ssh' | 'aapanel';
  name: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  secretHint: string | null;
  hostKeyFingerprint: string | null;
  testStatus: 'untested' | 'ok' | 'failed';
  testedAt: Date | null;
  /** A failure code (`auth_failed`, `host_key_mismatch`, ...) or a short fact; the screen translates it. */
  testMessage: string | null;
  createdAt: Date;
}

type Row = typeof connections.$inferSelect;
const view = (r: Row): ConnectionView => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  config: r.config,
  hasSecret: r.secretCiphertext !== null,
  secretHint: r.secretHint,
  hostKeyFingerprint: r.hostKeyFingerprint,
  testStatus: r.testStatus,
  testedAt: r.testedAt,
  testMessage: r.testMessage,
  createdAt: r.createdAt,
});

const isUniqueViolation = (e: unknown) => /uq_connections_name|duplicate key/i.test(String((e as { message?: string; cause?: { message?: string } })?.message) + String((e as { cause?: { message?: string } })?.cause?.message));

/** A generous ceiling per organization: it stops a runaway script or a hostile account from filling the table (D-059). */
export const MAX_CONNECTIONS_PER_ORG = 20;

export async function createConnection(ctx: Ctx, raw: ConnectionInput): Promise<{ id: string }> {
  assertCan(ctx, 'connection.write');
  const input = connectionSchema.parse(raw);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(connections).where(eq(connections.orgId, ctx.orgId));
  if (n >= MAX_CONNECTIONS_PER_ORG) throw new DomainError('invalid_state', 'too many connections');
  const id = newId();
  let config: Record<string, unknown> = {};
  let secret: Record<string, string> | null = null;
  let hint: string | null = null;
  if (input.kind === 'github') {
    // The person must have shown, through GitHub, that they can reach this installation; and one installation belongs to one
    // organization, so a second organization cannot take one that is already linked.
    const verified = assertVerifiedInstallation(ctx, input.verification, input.installationId);
    const taken = await db.select({ id: connections.id }).from(connections).where(and(eq(connections.kind, 'github'), sql`${connections.config}->>'installationId' = ${String(input.installationId)}`)).limit(1);
    if (taken.length > 0) throw new DomainError('duplicate', 'installation already linked');
    config = { installationId: input.installationId, account: verified.account };
  } else if (input.kind === 'ssh') {
    await assertPublicHost(input.host);
    config = { host: input.host, port: input.port, username: input.username, authMethod: input.authMethod };
    secret = {};
    if (input.password) secret.password = input.password;
    if (input.privateKey) secret.privateKey = acceptPrivateKey(input.privateKey, input.passphrase);
    if (input.passphrase) secret.passphrase = input.passphrase;
    hint = input.password ? secretHint(input.password) : '••••';
  } else {
    await assertPublicHost(new URL(input.url).hostname);
    config = { url: input.url, tlsInsecure: input.tlsInsecure };
    secret = { apiKey: input.apiKey };
    hint = secretHint(input.apiKey);
  }
  const enc = secret ? encryptSecret(secret, ctx.orgId, id) : null;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(connections).values({ id, orgId: ctx.orgId, kind: input.kind, name: input.name ?? `GitHub @${(config.account as string) || input.kind}`.slice(0, 80), config, secretCiphertext: enc?.ciphertext ?? null, secretKeyVersion: enc?.keyVersion ?? null, secretHint: hint, createdBy: ctx.actor });
      await recordAudit(tx, who(ctx), { action: 'connection.created', entityType: 'connection', entityId: id, summary: { kind: input.kind } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError('duplicate', 'connection name');
    throw e;
  }
  return { id };
}

export async function listConnections(ctx: Ctx, filter: { kind?: Row['kind'] } = {}): Promise<ConnectionView[]> {
  assertCan(ctx, 'connection.read');
  const rows = await db.select().from(connections).where(and(eq(connections.orgId, ctx.orgId), filter.kind ? eq(connections.kind, filter.kind) : undefined)).orderBy(asc(connections.name));
  return rows.map(view);
}

async function load(orgId: string, id: string): Promise<Row> {
  const [row] = await db.select().from(connections).where(and(eq(connections.orgId, orgId), eq(connections.id, id)));
  if (!row) throw new DomainError('not_found', 'connection');
  return row;
}

export async function getConnection(ctx: Ctx, id: string): Promise<ConnectionView> {
  assertCan(ctx, 'connection.read');
  return view(await load(ctx.orgId, id));
}

const patchSchema = z.object({
  name: name.optional(),
  host: host.optional(),
  port: z.number().int().min(1).max(65_535).optional(),
  username: username.optional(),
  authMethod: z.enum(AUTH_METHODS).optional(),
  password: z.string().min(1).max(500).optional(),
  privateKey: privateKey.optional(),
  passphrase: z.string().max(500).optional(),
  url: aapanelInput.shape.url.optional(),
  apiKey: z.string().min(8).max(200).optional(),
  tlsInsecure: z.boolean().optional(),
});

/** Changing where a connection points, or how it logs in, forgets the pinned host key and the last test (BR-M17-08, -10). */
export async function updateConnection(ctx: Ctx, id: string, raw: z.input<typeof patchSchema>): Promise<void> {
  assertCan(ctx, 'connection.write');
  const p = patchSchema.parse(raw);
  const before = await load(ctx.orgId, id);
  if (before.kind === 'github' && Object.keys(p).some((k) => k !== 'name')) throw new DomainError('validation', 'a GitHub connection only has a name to change');
  const config = { ...before.config } as Record<string, unknown>;
  let secret = before.secretCiphertext ? decryptSecret(before.secretCiphertext, ctx.orgId, id, before.secretKeyVersion ?? undefined) : null;
  let moved = false;
  let hint = before.secretHint;
  if (before.kind === 'ssh') {
    for (const k of ['host', 'port', 'username', 'authMethod'] as const) {
      if (p[k] !== undefined && p[k] !== config[k]) {
        config[k] = p[k];
        moved = true;
      }
    }
    if (p.host) await assertPublicHost(p.host);
    if (p.password || p.privateKey || p.passphrase !== undefined) {
      const nextPassphrase = p.passphrase !== undefined ? p.passphrase : secret?.passphrase;
      const nextKey = p.privateKey ?? secret?.privateKey;
      secret = { ...(secret ?? {}), ...(p.password ? { password: p.password } : {}), ...(nextKey ? { privateKey: p.privateKey || p.passphrase !== undefined ? acceptPrivateKey(nextKey, nextPassphrase) : nextKey } : {}), ...(p.passphrase !== undefined ? { passphrase: p.passphrase } : {}) };
      if (p.password) hint = secretHint(p.password);
      moved = true;
    }
    const method = config.authMethod as AuthMethod;
    if ((method !== 'private_key' && !secret?.password) || (method !== 'password' && !secret?.privateKey)) throw new DomainError('validation', 'secret does not match the login method');
  } else if (before.kind === 'aapanel') {
    if (p.url && p.url !== config.url) {
      await assertPublicHost(new URL(p.url).hostname);
      config.url = p.url;
      moved = true;
    }
    if (p.tlsInsecure !== undefined && p.tlsInsecure !== config.tlsInsecure) config.tlsInsecure = p.tlsInsecure;
    if (p.apiKey) {
      secret = { apiKey: p.apiKey };
      hint = secretHint(p.apiKey);
      moved = true;
    }
  }
  // Seal again only when a secret was actually replaced: a rename must not rewrite the stored secret.
  const secretChanged = Boolean(p.password || p.privateKey || p.passphrase !== undefined || p.apiKey);
  const enc = secretChanged && secret && before.kind !== 'github' ? encryptSecret(secret, ctx.orgId, id) : null;
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(connections)
        .set({
          name: p.name ?? before.name,
          config,
          ...(enc ? { secretCiphertext: enc.ciphertext, secretKeyVersion: enc.keyVersion, secretHint: hint } : {}),
          ...(moved ? { hostKeyFingerprint: null, testStatus: 'untested' as const, testedAt: null, testMessage: null } : {}),
        })
        .where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, id)));
      await recordAudit(tx, who(ctx), { action: 'connection.updated', entityType: 'connection', entityId: id, summary: { fields: Object.keys(p).filter((k) => !['password', 'privateKey', 'passphrase', 'apiKey'].includes(k)), secretChanged } });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError('duplicate', 'connection name');
    throw e;
  }
}

/** A connection still in use cannot be deleted; release it first (BR-M17-13). */
export async function deleteConnection(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'connection.write');
  await db.transaction(async (tx) => {
    const before = await load(ctx.orgId, id);
    const used = await Promise.all([
      tx.select({ id: productSetups.id }).from(productSetups).where(and(eq(productSetups.orgId, ctx.orgId), eq(productSetups.githubConnectionId, id))).limit(1),
      tx.select({ id: productSetups.id }).from(productSetups).where(and(eq(productSetups.orgId, ctx.orgId), eq(productSetups.serverConnectionId, id))).limit(1),
      tx.select({ id: deployments.id }).from(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.serverConnectionId, id))).limit(1),
      tx.select({ id: playbookRuns.id }).from(playbookRuns).where(and(eq(playbookRuns.orgId, ctx.orgId), eq(playbookRuns.serverConnectionId, id))).limit(1),
    ]);
    if (used.some((r) => r.length > 0)) throw new DomainError('invalid_state', 'connection is in use');
    await tx.delete(connections).where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, id)));
    await recordAudit(tx, who(ctx), { action: 'connection.deleted', entityType: 'connection', entityId: id, summary: { kind: before.kind, name: before.name } });
  });
}

export interface ConnectionDeps {
  github: GithubClient;
  ssh: (cfg: SshConfig, secret: SshSecret, pinned: string | null) => Promise<SshSession | { fingerprint: string }>;
  aapanelPing: typeof aapanelPing;
}
const realDeps = (): ConnectionDeps => ({ github: githubClient(), ssh: sshConnect, aapanelPing });

export type TestResult = { status: 'ok'; message: string | null } | { status: 'failed'; message: string } | { status: 'needs_host_key'; fingerprint: string };

const isSession = (x: SshSession | { fingerprint: string }): x is SshSession => 'exec' in x;

/**
 * Tests a connection and records the result (BR-M17-10). For SSH the first test only reads the host fingerprint and sends no
 * credential: the person confirms it by calling again with `acceptHostKey`, which pins it (BR-M17-08). Owner only, because
 * a test uses the secret.
 */
export async function testConnection(ctx: Ctx, id: string, opts: { acceptHostKey?: string } = {}, deps: ConnectionDeps = realDeps()): Promise<TestResult> {
  assertCan(ctx, 'connection.write');
  const row = await load(ctx.orgId, id);
  const secret = row.secretCiphertext ? decryptSecret(row.secretCiphertext, ctx.orgId, id, row.secretKeyVersion ?? undefined) : {};
  let result: TestResult;
  let fingerprint = row.hostKeyFingerprint;
  let config = row.config;
  try {
    if (row.kind === 'github') {
      const info = await deps.github.getInstallation(Number(row.config.installationId));
      config = { ...row.config, account: info.account };
      result = { status: 'ok', message: info.account };
    } else if (row.kind === 'aapanel') {
      const url = String(row.config.url);
      const address = await resolvePublicHost(new URL(url).hostname);
      await deps.aapanelPing({ url, tlsInsecure: Boolean(row.config.tlsInsecure), address }, secret.apiKey ?? '');
      result = { status: 'ok', message: null };
    } else {
      const named = row.config as unknown as SshConfig;
      const cfg: SshConfig = { ...named, host: (await resolvePublicHost(named.host)).address }; // connect to the checked address
      if (opts.acceptHostKey || !fingerprint) {
        const learned = await deps.ssh(cfg, {}, null); // reads the fingerprint, sends no credential
        if (opts.acceptHostKey !== learned.fingerprint) {
          result = { status: 'needs_host_key', fingerprint: learned.fingerprint };
          return result;
        }
        fingerprint = learned.fingerprint;
      }
      const session = await deps.ssh(cfg, secret, fingerprint);
      if (!isSession(session)) throw new SshError('failed');
      try {
        const r = await session.exec('true', { timeoutMs: 10_000, maxBytes: 1024 });
        result = r.code === 0 ? { status: 'ok', message: null } : { status: 'failed', message: 'failed' };
      } finally {
        session.close();
      }
    }
  } catch (e) {
    const code = e instanceof AapanelError ? (e.detail ? `${e.kind}:${e.detail}` : e.kind) : e instanceof SshError ? e.kind : e instanceof GithubError ? e.kind : e instanceof DomainError ? e.message : 'failed';
    result = { status: 'failed', message: code };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(connections)
      .set({ testStatus: result.status === 'ok' ? 'ok' : 'failed', testedAt: ctx.clock.now(), testMessage: result.message, hostKeyFingerprint: fingerprint, config })
      .where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, id)));
    await recordAudit(tx, who(ctx), { action: 'connection.tested', entityType: 'connection', entityId: id, summary: { kind: row.kind, status: result.status, ...(result.status === 'failed' ? { reason: result.message } : {}) } });
  });
  return result;
}

/**
 * The decrypted secret of a connection for the code that runs it. Never exposed by an endpoint and never passed to a model
 * (BR-M17-03): only the runner and the checks call this, inside the server process.
 */
export async function openConnection(orgId: string, id: string): Promise<{ row: Row; secret: Record<string, string> }> {
  const row = await load(orgId, id);
  return { row, secret: row.secretCiphertext ? decryptSecret(row.secretCiphertext, orgId, id, row.secretKeyVersion ?? undefined) : {} };
}

/**
 * After a verification, when the person can reach exactly one installation, links it right away so they do not have to
 * pick from a list of one. It goes through `createConnection`, so the proof is checked as always. Returns whether a
 * connection was made (an installation already linked is simply left alone).
 */
export async function autoLinkVerifiedInstallation(ctx: Ctx, verification: string): Promise<boolean> {
  const installations = readVerification(ctx, verification) ?? [];
  if (installations.length !== 1) return false;
  const [only] = installations;
  try {
    await createConnection(ctx, { kind: 'github', installationId: only.id, verification });
    return true;
  } catch (e) {
    if (e instanceof DomainError && e.code === 'duplicate') return false;
    throw e;
  }
}

/**
 * Re-seals every secret that is not under the current key (`pnpm connections:rotate`). Safe to run again and again: rows
 * already on the current version are skipped, and each row changes in its own transaction.
 */
export async function rotateConnectionSecrets(): Promise<{ rotated: number; skipped: number }> {
  const current = currentKeyVersion();
  const rows = await db.select({ id: connections.id, orgId: connections.orgId, ciphertext: connections.secretCiphertext, version: connections.secretKeyVersion }).from(connections);
  let rotated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.ciphertext || r.version === current) {
      skipped++;
      continue;
    }
    const enc = encryptSecret(decryptSecret(r.ciphertext, r.orgId, r.id, r.version ?? undefined), r.orgId, r.id);
    await db.update(connections).set({ secretCiphertext: enc.ciphertext, secretKeyVersion: enc.keyVersion }).where(and(eq(connections.orgId, r.orgId), eq(connections.id, r.id)));
    rotated++;
  }
  return { rotated, skipped };
}
