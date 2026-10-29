import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { connections, flows, productSetups, products } from '../../db/schema';
import { githubClient, GithubError, type GithubClient } from '../../integrations/github/client';
import { recordAudit } from '../audit/service';
import { listConnections, type ConnectionView } from '../connections/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { optionalText, who } from '../portfolio/shared';

/**
 * The profile of a product (D-061): where its code lives, the connections it usually runs on, which flows set up a new client
 * and update one, the port range, and the working rules the assistant reads. WHAT is done to a server is a flow, not a field
 * here; the steps and templates that used to live in this profile moved into the flow.
 */
const repo = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/);
/** A branch name that cannot start an option or climb out of a folder (BR-M17-04). */
const branch = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._/-]{1,200}$/)
  .refine((b) => !b.startsWith('-') && !b.startsWith('/') && !b.endsWith('/') && !b.includes('..') && !b.includes('//') && !b.endsWith('.lock'), 'branch');
/** `{produk}-{klien}`: letters, digits, `_`, `-`, and the placeholders the planner fills. No slashes, so it is one folder. */
const folderPattern = z
  .string()
  .trim()
  .regex(/^[a-z0-9_{}-]{1,100}$/)
  .refine((p) => [...p.matchAll(/\{(\w+)\}/g)].every((m) => ['produk', 'klien', 'domain'].includes(m[1])), 'placeholder')
  .refine((p) => !p.startsWith('-'), 'folder');
const port = z.coerce.number().int().min(1024).max(65535);

export const DEFAULT_PORT_RANGE = { start: 6000, end: 6999 } as const;

export const profileSchema = z
  .object({
    githubConnectionId: z.string().min(1).max(40).nullable().optional(),
    repo: repo.nullable().optional(),
    defaultBranch: branch.nullable().optional(),
    mode: z.enum(['branch_per_client', 'shared_branch']).default('branch_per_client'),
    folderPattern: folderPattern.nullable().optional(),
    serverConnectionId: z.string().min(1).max(40).nullable().optional(),
    setupFlowId: z.string().min(1).max(40).nullable().optional(),
    updateFlowId: z.string().min(1).max(40).nullable().optional(),
    portRangeStart: port.nullable().optional(),
    portRangeEnd: port.nullable().optional(),
    rulesNotes: optionalText(8_000),
  })
  .refine((v) => v.portRangeStart == null || v.portRangeEnd == null || v.portRangeStart <= v.portRangeEnd, { message: 'port range', path: ['portRangeEnd'] });
export type ProfileInput = z.input<typeof profileSchema>;

export interface SetupProfile {
  id: string;
  productId: string;
  githubConnectionId: string | null;
  repo: string | null;
  defaultBranch: string | null;
  mode: 'branch_per_client' | 'shared_branch';
  folderPattern: string | null;
  serverConnectionId: string | null;
  setupFlowId: string | null;
  updateFlowId: string | null;
  portRangeStart: number | null;
  portRangeEnd: number | null;
  rulesNotes: string | null;
  isAiDraft: boolean;
  updatedAt: Date;
}

type Row = typeof productSetups.$inferSelect;
const toProfile = (r: Row): SetupProfile => ({
  id: r.id,
  productId: r.productId,
  githubConnectionId: r.githubConnectionId,
  repo: r.repo,
  defaultBranch: r.defaultBranch,
  mode: r.mode,
  folderPattern: r.folderPattern,
  serverConnectionId: r.serverConnectionId,
  setupFlowId: r.setupFlowId,
  updateFlowId: r.updateFlowId,
  portRangeStart: r.portRangeStart,
  portRangeEnd: r.portRangeEnd,
  rulesNotes: r.rulesNotes,
  isAiDraft: r.isAiDraft,
  updatedAt: r.updatedAt,
});

export interface ProfileData {
  profile: SetupProfile | null;
  connections: Array<Pick<ConnectionView, 'id' | 'kind' | 'name'>>;
  flows: Array<{ id: string; name: string; kind: 'setup' | 'update' }>;
  defaultPortRange: { start: number; end: number };
}

/** The profile (or `null` when none yet) with the connections and flows it can choose from, never with a secret. */
export async function getSetupProfile(ctx: Ctx, productId: string): Promise<ProfileData> {
  assertCan(ctx, 'setup.read');
  const [product] = await db.select({ id: products.id }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId)));
  if (!product) throw new DomainError('not_found', 'product');
  const [row] = await db.select().from(productSetups).where(and(eq(productSetups.orgId, ctx.orgId), eq(productSetups.productId, productId)));
  const [conns, flowRows] = await Promise.all([listConnections(ctx), db.select({ id: flows.id, name: flows.name, kind: flows.kind }).from(flows).where(and(eq(flows.orgId, ctx.orgId), isNull(flows.archivedAt))).orderBy(flows.name)]);
  return { profile: row ? toProfile(row) : null, connections: conns.map((c) => ({ id: c.id, kind: c.kind, name: c.name })), flows: flowRows, defaultPortRange: { ...DEFAULT_PORT_RANGE } };
}

/**
 * Creates or replaces the profile of a product. Saving by a person clears the "AI-assisted" flag; a profile the assistant
 * proposed stays flagged until someone saves it. The connections must be this organization's and of the right kind, and a
 * flow must be this organization's, not archived, and of the right kind.
 */
export async function saveSetupProfile(ctx: Ctx, productId: string, raw: ProfileInput): Promise<SetupProfile> {
  assertCan(ctx, 'setup.write');
  const input = profileSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [product] = await tx.select({ id: products.id }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, productId)));
    if (!product) throw new DomainError('not_found', 'product');
    const checkConnection = async (id: string | null | undefined, kinds: Array<'github' | 'ssh' | 'aapanel'>) => {
      if (!id) return;
      const [c] = await tx.select({ kind: connections.kind }).from(connections).where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, id)));
      if (!c) throw new DomainError('not_found', 'connection');
      if (!kinds.includes(c.kind)) throw new DomainError('validation', 'wrong kind of connection');
    };
    const checkFlow = async (id: string | null | undefined, kind: 'setup' | 'update') => {
      if (!id) return;
      const [f] = await tx.select({ kind: flows.kind, archivedAt: flows.archivedAt }).from(flows).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id)));
      if (!f || f.archivedAt) throw new DomainError('not_found', 'flow');
      if (f.kind !== kind) throw new DomainError('validation', 'wrong kind of flow');
    };
    await checkConnection(input.githubConnectionId, ['github']);
    await checkConnection(input.serverConnectionId, ['ssh']);
    await checkFlow(input.setupFlowId, 'setup');
    await checkFlow(input.updateFlowId, 'update');
    const values = {
      githubConnectionId: input.githubConnectionId ?? null,
      repo: input.repo ?? null,
      defaultBranch: input.defaultBranch ?? null,
      mode: input.mode,
      folderPattern: input.folderPattern ?? null,
      serverConnectionId: input.serverConnectionId ?? null,
      setupFlowId: input.setupFlowId ?? null,
      updateFlowId: input.updateFlowId ?? null,
      portRangeStart: input.portRangeStart ?? null,
      portRangeEnd: input.portRangeEnd ?? null,
      rulesNotes: input.rulesNotes ?? null,
      isAiDraft: ctx.actor.startsWith('ai:'),
      updatedBy: ctx.actor,
    };
    const [row] = await tx
      .insert(productSetups)
      .values({ orgId: ctx.orgId, productId, ...values })
      .onConflictDoUpdate({ target: productSetups.productId, set: values })
      .returning();
    await recordAudit(tx, who(ctx), { action: 'setup.saved', entityType: 'product', entityId: productId, summary: { repo: values.repo, mode: values.mode, setupFlow: values.setupFlowId, updateFlow: values.updateFlowId, aiDraft: values.isAiDraft } });
    return toProfile(row);
  });
}

/** Repositories the organization's GitHub connection may use, for the profile form. Only names, no code. */
export async function listConnectionRepos(ctx: Ctx, connectionId: string, gh: GithubClient = githubClient()): Promise<Array<{ fullName: string; defaultBranch: string }>> {
  assertCan(ctx, 'setup.read');
  const [c] = await db.select({ kind: connections.kind, config: connections.config }).from(connections).where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, connectionId)));
  if (!c || c.kind !== 'github') throw new DomainError('not_found', 'connection');
  try {
    return await gh.listRepositories(Number(c.config.installationId));
  } catch (e) {
    if (e instanceof GithubError) throw new DomainError(e.kind === 'rate_limited' ? 'rate_limited' : 'invalid_state', e.kind);
    throw e;
  }
}

/**
 * What version the repository says it is (D-065): its latest release, else its newest tag, else the commit at the tip of its
 * default branch, because many repositories never publish versions. It is only a suggestion; the person saves it.
 */
export async function detectRepoVersion(ctx: Ctx, connectionId: string, repo: string, gh: GithubClient = githubClient()): Promise<{ version: string; source: 'release' | 'tag' | 'commit' } | null> {
  assertCan(ctx, 'setup.read');
  const [c] = await db.select({ kind: connections.kind, config: connections.config }).from(connections).where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, connectionId)));
  if (!c || c.kind !== 'github') throw new DomainError('not_found', 'connection');
  // Only repositories this installation can see: a name typed by hand cannot be used to probe other repositories.
  const allowed = await gh.listRepositories(Number(c.config.installationId)).catch((e: unknown) => {
    if (e instanceof GithubError) throw new DomainError(e.kind === 'rate_limited' ? 'rate_limited' : 'invalid_state', e.kind);
    throw e;
  });
  const match = allowed.find((r) => r.fullName === repo);
  if (!match) throw new DomainError('not_found', 'repository');
  try {
    return await gh.latestVersion(Number(c.config.installationId), repo, match.defaultBranch);
  } catch (e) {
    if (e instanceof GithubError) throw new DomainError(e.kind === 'rate_limited' ? 'rate_limited' : 'invalid_state', e.kind);
    throw e;
  }
}
