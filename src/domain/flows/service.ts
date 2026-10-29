import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { newId } from '../../db/ids';
import { clients, connections, flows, flowVersions, playbookRuns, playbookSteps, productSetups, products } from '../../db/schema';
import { requestApproval } from '../approvals/service';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { enqueueJob } from '../jobs/queue';
import { who } from '../portfolio/shared';
import { definitionSchema, hasCommandNode, planHash, validateDefinition, type Definition, type Problem } from './definition';
import { purgeRunSecrets } from './engine';
import { getTemplate, TEMPLATES } from './templates';
import { getTool } from './tools';
import { branchName, absPath, dbIdentifier, domainName, repoName } from './tools/validate';
import type { Scalar } from './template';

const name = z.string().trim().min(2).max(80);

export interface FlowSummary {
  id: string;
  name: string;
  kind: 'setup' | 'update';
  description: string | null;
  productId: string | null;
  currentVersion: number;
  hasCommandNode: boolean;
  nodeCount: number;
  updatedAt: Date;
}

/** What the editor and the plan need to know about a definition: every problem, in terms a screen can show. */
export function checkDefinition(raw: unknown, canUseCommand: boolean): { ok: boolean; problems: Problem[]; definition: Definition | null } {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, definition: null, problems: parsed.error.issues.slice(0, 20).map((i) => ({ code: 'config_unknown_key' as const, detail: `${i.path.map(String).join('.')}: ${i.message}` })) };
  const { problems } = validateDefinition(parsed.data, { canUseCommand });
  return { ok: problems.length === 0, problems, definition: parsed.data };
}

const isUnique = (e: unknown) => /uq_flows_name|duplicate key/i.test(String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message));

/** The Owner alone may save a flow that has a free command node, and alone may change one that has (BR-M17-18). */
function assertMayWrite(ctx: Ctx, def: Definition, existingHadCommand = false) {
  assertCan(ctx, 'flow.write');
  if (hasCommandNode(def) || existingHadCommand) assertCan(ctx, 'flow.command');
}

export async function createFlow(ctx: Ctx, raw: { name: string; kind: 'setup' | 'update'; description?: string | null; productId?: string | null; definition: unknown }): Promise<{ id: string }> {
  assertCan(ctx, 'flow.write');
  const input = z.object({ name, kind: z.enum(['setup', 'update']), description: z.string().max(500).nullish(), productId: z.string().max(40).nullish() }).parse(raw);
  const checked = checkDefinition(raw.definition, true); // soundness first; WHO may save it is decided right after (BR-M17-18)
  if (!checked.ok || !checked.definition) throw new DomainError('validation', 'the flow is not valid');
  const definition = checked.definition;
  assertMayWrite(ctx, definition);
  const id = newId();
  try {
    await db.transaction(async (tx) => {
      if (input.productId) {
        const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId)));
        if (!p) throw new DomainError('not_found', 'product');
      }
      await tx.insert(flows).values({ id, orgId: ctx.orgId, name: input.name, kind: input.kind, description: input.description ?? null, productId: input.productId ?? null, createdBy: ctx.actor });
      await tx.insert(flowVersions).values({ orgId: ctx.orgId, flowId: id, version: 1, definition: definition as unknown as Record<string, unknown>, hasCommandNode: hasCommandNode(definition), createdBy: ctx.actor });
      await recordAudit(tx, who(ctx), { action: 'flow.created', entityType: 'flow', entityId: id, summary: { kind: input.kind, nodes: definition.nodes.length } });
    });
  } catch (e) {
    if (isUnique(e)) throw new DomainError('duplicate', 'flow name');
    throw e;
  }
  return { id };
}

/** Saving a change makes a NEW version; the earlier ones, and the runs that used them, stay as they were (BR-M17-19, -20). */
export async function updateFlow(ctx: Ctx, id: string, raw: { name?: string; description?: string | null; definition?: unknown }): Promise<{ version: number }> {
  assertCan(ctx, 'flow.write');
  const patch = z.object({ name: name.optional(), description: z.string().max(500).nullish() }).parse(raw);
  return db.transaction(async (tx) => {
    const [flow] = await tx.select().from(flows).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id))).for('update');
    if (!flow || flow.archivedAt) throw new DomainError('not_found', 'flow');
    const [current] = await tx.select().from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.flowId, id), eq(flowVersions.version, flow.currentVersion)));
    if (current.hasCommandNode) assertCan(ctx, 'flow.command');
    let version = flow.currentVersion;
    if (raw.definition !== undefined) {
      const checked = checkDefinition(raw.definition, true);
      if (!checked.ok || !checked.definition) throw new DomainError('validation', 'the flow is not valid');
      assertMayWrite(ctx, checked.definition, current.hasCommandNode);
      version = flow.currentVersion + 1;
      await tx.insert(flowVersions).values({ orgId: ctx.orgId, flowId: id, version, definition: checked.definition as unknown as Record<string, unknown>, hasCommandNode: hasCommandNode(checked.definition), createdBy: ctx.actor });
    }
    try {
      await tx.update(flows).set({ currentVersion: version, ...(patch.name ? { name: patch.name } : {}), ...(patch.description !== undefined ? { description: patch.description ?? null } : {}) }).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id)));
    } catch (e) {
      if (isUnique(e)) throw new DomainError('duplicate', 'flow name');
      throw e;
    }
    await recordAudit(tx, who(ctx), { action: 'flow.updated', entityType: 'flow', entityId: id, summary: { version, fields: Object.keys(raw) } });
    return { version };
  });
}

export async function archiveFlow(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'flow.write');
  await db.transaction(async (tx) => {
    const [flow] = await tx.select().from(flows).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id))).for('update');
    if (!flow || flow.archivedAt) throw new DomainError('not_found', 'flow');
    const [current] = await tx.select({ cmd: flowVersions.hasCommandNode }).from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.flowId, id), eq(flowVersions.version, flow.currentVersion)));
    if (current?.cmd) assertCan(ctx, 'flow.command');
    await tx.update(flows).set({ archivedAt: ctx.clock.now() }).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id)));
    await recordAudit(tx, who(ctx), { action: 'flow.archived', entityType: 'flow', entityId: id });
  });
}

export async function listFlows(ctx: Ctx): Promise<FlowSummary[]> {
  assertCan(ctx, 'flow.read');
  const rows = await db
    .select({ f: flows, v: flowVersions })
    .from(flows)
    .innerJoin(flowVersions, and(eq(flowVersions.orgId, flows.orgId), eq(flowVersions.flowId, flows.id), eq(flowVersions.version, flows.currentVersion)))
    .where(and(eq(flows.orgId, ctx.orgId), isNull(flows.archivedAt)))
    .orderBy(asc(flows.name));
  return rows.map(({ f, v }) => ({ id: f.id, name: f.name, kind: f.kind, description: f.description, productId: f.productId, currentVersion: f.currentVersion, hasCommandNode: v.hasCommandNode, nodeCount: ((v.definition as { nodes?: unknown[] }).nodes ?? []).length, updatedAt: f.updatedAt }));
}

export async function getFlow(ctx: Ctx, id: string, version?: number) {
  assertCan(ctx, 'flow.read');
  const [flow] = await db.select().from(flows).where(and(eq(flows.orgId, ctx.orgId), eq(flows.id, id)));
  if (!flow) throw new DomainError('not_found', 'flow');
  const versions = await db.select({ version: flowVersions.version, createdAt: flowVersions.createdAt, createdBy: flowVersions.createdBy, hasCommandNode: flowVersions.hasCommandNode }).from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.flowId, id))).orderBy(desc(flowVersions.version));
  const wanted = version ?? flow.currentVersion;
  const [v] = await db.select().from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.flowId, id), eq(flowVersions.version, wanted)));
  if (!v) throw new DomainError('not_found', 'flow version');
  return { flow: { id: flow.id, name: flow.name, kind: flow.kind, description: flow.description, productId: flow.productId, currentVersion: flow.currentVersion, archivedAt: flow.archivedAt }, definition: v.definition as unknown as Definition, hasCommandNode: v.hasCommandNode, version: wanted, versions };
}

export function listTemplates() {
  return TEMPLATES.map((t) => ({ key: t.key, name: t.name, description: t.description, kind: t.kind, nodeCount: t.build().nodes.length }));
}

export async function useTemplate(ctx: Ctx, key: string, input: { name?: string; productId?: string | null } = {}): Promise<{ id: string }> {
  const t = getTemplate(key);
  if (!t) throw new DomainError('not_found', 'template');
  return createFlow(ctx, { name: input.name ?? t.name, kind: t.kind, description: t.description, productId: input.productId ?? null, definition: t.build() });
}

// ---------------------------------------------------------------- runs

const PATTERNS = {
  slug: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/),
  domain: domainName,
  branch: branchName,
  repo: repoName,
  path: absPath,
  identifier: dbIdentifier,
  free: z.string().max(500).refine((s) => !s.includes('\0'), 'text'),
} as const;

/** The values a run is started with, checked against what the flow declared. */
function checkParams(def: Definition, given: Record<string, unknown>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const p of def.params) {
    const raw = given[p.name] ?? p.default;
    if (raw === undefined || raw === null || raw === '') {
      if (p.required) throw new DomainError('validation', `missing parameter ${p.name}`);
      continue;
    }
    if (p.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new DomainError('validation', `parameter ${p.name} must be a number`);
      out[p.name] = n;
    } else if (p.type === 'boolean') {
      out[p.name] = raw === true || raw === 'true';
    } else {
      const parsed = PATTERNS[p.pattern].safeParse(String(raw));
      if (!parsed.success) throw new DomainError('validation', `parameter ${p.name} is not valid`);
      out[p.name] = parsed.data;
    }
  }
  return out;
}

export interface RunPlan {
  runId: string;
  approvalId: string;
  planHash: string;
  expiresAt: Date;
  /** Everything that will CHANGE something, in order, with the settings as written (variables are filled in as the run goes). */
  changes: Array<{ node: string; tool: string; label: string | null; config: Record<string, Scalar> }>;
  params: Record<string, Scalar>;
}

/** Turns a flow, parameters and connections into a run that waits for a person (BR-M17-21). Nothing runs yet. */
export async function planRun(ctx: Ctx, input: { flowId: string; productId: string; params: Record<string, unknown>; bindings: Record<string, string> }): Promise<RunPlan> {
  assertCan(ctx, 'setup.run');
  const loaded = await getFlow(ctx, input.flowId);
  if (loaded.flow.archivedAt) throw new DomainError('invalid_state', 'the flow is archived');
  const def = loaded.definition;
  // Who SAVED a command node was decided at save time; here the question is only whether the flow is sound.
  const { problems, order } = validateDefinition(def, { canUseCommand: true });
  if (problems.length || !order || def.nodes.length === 0) throw new DomainError('validation', 'the flow is not valid');

  const [setup] = await db.select().from(productSetups).where(and(eq(productSetups.orgId, ctx.orgId), eq(productSetups.productId, input.productId)));
  const [product] = await db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId)));
  if (!product) throw new DomainError('not_found', 'product');
  const productScope: Record<string, Scalar> = { name: product.name };
  if (setup?.repo) productScope.repo = setup.repo;
  if (setup?.defaultBranch) productScope.default_branch = setup.defaultBranch;
  if (setup?.folderPattern) productScope.folder_pattern = setup.folderPattern;
  if (setup?.portRangeStart != null) productScope.port_range_start = setup.portRangeStart;
  if (setup?.portRangeEnd != null) productScope.port_range_end = setup.portRangeEnd;

  const params = checkParams(def, { ...input.params, product_id: input.productId });
  const bindings: Record<string, string> = {};
  for (const slot of def.slots) {
    const id = input.bindings[slot.name];
    if (!id) throw new DomainError('validation', `the slot ${slot.name} is not bound to a connection`);
    const [c] = await db.select().from(connections).where(and(eq(connections.orgId, ctx.orgId), eq(connections.id, id)));
    if (!c) throw new DomainError('not_found', 'connection');
    if (c.kind !== slot.kind) throw new DomainError('validation', `the slot ${slot.name} needs a ${slot.kind} connection`);
    if (c.testStatus !== 'ok') throw new DomainError('invalid_state', `the connection "${c.name}" has not passed its test`);
    if (c.kind === 'ssh' && !c.hostKeyFingerprint) throw new DomainError('invalid_state', 'the server fingerprint was not confirmed');
    bindings[slot.name] = id;
  }

  // A client is chosen from the organization's own list; a name typed by hand would only fail later at the database.
  if (typeof params.client_id === 'string' && params.client_id) {
    const [client] = await db.select({ id: clients.id }).from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, params.client_id)));
    if (!client) throw new DomainError('validation', 'client_id: choose a client from the list');
  }

  const hash = planHash(def, order, params, bindings);
  const runId = newId();
  const first = def.slots.find((s) => s.kind === 'ssh');
  const approval = await db.transaction(async (tx) => {
    await tx.insert(playbookRuns).values({
      id: runId,
      orgId: ctx.orgId,
      productId: input.productId,
      clientId: typeof params.client_id === 'string' ? params.client_id : null,
      serverConnectionId: first ? bindings[first.name] : null,
      flowVersionId: (await tx.select({ id: flowVersions.id }).from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.flowId, input.flowId), eq(flowVersions.version, loaded.version))))[0].id,
      bindings,
      planHash: hash,
      kind: loaded.flow.kind,
      status: 'awaiting_approval',
      params: { ...params, __product: productScope },
      createdBy: ctx.actor,
    });
    await tx.insert(playbookSteps).values(order.map((nodeId, i) => ({ orgId: ctx.orgId, runId, position: i + 1, stepKey: nodeId, tool: def.nodes.find((n) => n.id === nodeId)!.tool })));
    await recordAudit(tx, who(ctx), { action: 'flow.run_planned', entityType: 'playbook_run', entityId: runId, summary: { flow: loaded.flow.name, version: loaded.version, nodes: order.length, hash: hash.slice(0, 12) } });
    return null;
  });
  void approval;
  const changes = order.flatMap((nodeId) => {
    const node = def.nodes.find((n) => n.id === nodeId)!;
    return getTool(node.tool)?.tier === 'change' ? [{ node: nodeId, tool: node.tool, label: node.label ?? null, config: node.config as Record<string, Scalar> }] : [];
  });
  const rationale = `Jalankan flow "${loaded.flow.name}" (versi ${loaded.version}): ${changes.length} langkah yang mengubah server atau data, untuk ${String(params.domain ?? params.slug ?? product.name)}.`;
  const req = await requestApproval(db, ctx, { tool: 'start_flow_run', args: { runId, planHash: hash }, rationale });
  await db.update(playbookRuns).set({ approvalId: req.id }).where(eq(playbookRuns.id, runId));
  return { runId, approvalId: req.id, planHash: hash, expiresAt: req.expiresAt, changes, params };
}

/** The person (or the approval they gave) lets the planned run go. The hash is worked out again from what is stored (BR-M17-21). */
export async function startRun(ctx: Ctx, runId: string, expectedHash?: string): Promise<{ runId: string }> {
  assertCan(ctx, 'setup.run');
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(playbookRuns).where(and(eq(playbookRuns.orgId, ctx.orgId), eq(playbookRuns.id, runId))).for('update');
    if (!run) throw new DomainError('not_found', 'run');
    if (run.status !== 'awaiting_approval') throw new DomainError('invalid_state', 'the run is not waiting for approval');
    const [ver] = await tx.select().from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.id, run.flowVersionId ?? '')));
    const def = ver && definitionSchema.safeParse(ver.definition);
    if (!def?.success) throw new DomainError('invalid_state', 'the flow of this run is gone');
    const { order } = validateDefinition(def.data, { canUseCommand: true });
    const { __product: _p, ...params } = run.params as Record<string, unknown>;
    const now = order ? planHash(def.data, order, params, run.bindings) : '';
    if (!order || now !== run.planHash || (expectedHash && expectedHash !== run.planHash)) throw new DomainError('invalid_state', 'the plan changed after it was proposed');
    await tx.update(playbookRuns).set({ status: 'running', startedAt: ctx.clock.now() }).where(eq(playbookRuns.id, runId));
    await enqueueJob(tx, { orgId: ctx.orgId, type: 'flow.run', payload: { runId } });
    await recordAudit(tx, who(ctx), { action: 'flow.run_started', entityType: 'playbook_run', entityId: runId, summary: { hash: run.planHash?.slice(0, 12) } });
    return { runId };
  });
}

/** After a node failed: tries it again, from that node, without repeating the ones that finished (BR-M17-23). */
export async function retryRun(ctx: Ctx, runId: string): Promise<void> {
  assertCan(ctx, 'setup.run');
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(playbookRuns).where(and(eq(playbookRuns.orgId, ctx.orgId), eq(playbookRuns.id, runId))).for('update');
    if (!run) throw new DomainError('not_found', 'run');
    if (run.status !== 'paused') throw new DomainError('invalid_state', 'only a paused run can be tried again');
    await tx.update(playbookSteps).set({ status: 'pending', error: null }).where(and(eq(playbookSteps.orgId, ctx.orgId), eq(playbookSteps.runId, runId), eq(playbookSteps.status, 'failed')));
    await tx.update(playbookRuns).set({ status: 'running', error: null }).where(eq(playbookRuns.id, runId));
    await enqueueJob(tx, { orgId: ctx.orgId, type: 'flow.run', payload: { runId } });
    await recordAudit(tx, who(ctx), { action: 'flow.run_retried', entityType: 'playbook_run', entityId: runId });
  });
}

/** Stops a run for good and wipes its secrets. Rollback is manual (D-054): what already changed stays. */
export async function cancelRun(ctx: Ctx, runId: string): Promise<void> {
  assertCan(ctx, 'setup.run');
  await db.transaction(async (tx) => {
    const [run] = await tx.select().from(playbookRuns).where(and(eq(playbookRuns.orgId, ctx.orgId), eq(playbookRuns.id, runId))).for('update');
    if (!run) throw new DomainError('not_found', 'run');
    if (!['awaiting_approval', 'paused', 'running', 'planned'].includes(run.status)) throw new DomainError('invalid_state', 'this run already ended');
    await tx.update(playbookRuns).set({ status: 'cancelled', finishedAt: ctx.clock.now(), secretsCiphertext: null, secretsKeyVersion: null }).where(eq(playbookRuns.id, runId));
    await recordAudit(tx, who(ctx), { action: 'flow.run_cancelled', entityType: 'playbook_run', entityId: runId });
  });
  await purgeRunSecrets(runId);
}

export async function getRun(ctx: Ctx, runId: string) {
  assertCan(ctx, 'setup.read');
  const [run] = await db.select().from(playbookRuns).where(and(eq(playbookRuns.orgId, ctx.orgId), eq(playbookRuns.id, runId)));
  if (!run) throw new DomainError('not_found', 'run');
  const steps = await db.select({ node: playbookSteps.stepKey, tool: playbookSteps.tool, position: playbookSteps.position, status: playbookSteps.status, attempts: playbookSteps.attempts, output: playbookSteps.output, error: playbookSteps.error, outputs: playbookSteps.outputs, startedAt: playbookSteps.startedAt, finishedAt: playbookSteps.finishedAt }).from(playbookSteps).where(and(eq(playbookSteps.orgId, ctx.orgId), eq(playbookSteps.runId, runId))).orderBy(asc(playbookSteps.position));
  const [ver] = await db.select({ definition: flowVersions.definition, version: flowVersions.version, flowId: flowVersions.flowId }).from(flowVersions).where(and(eq(flowVersions.orgId, ctx.orgId), eq(flowVersions.id, run.flowVersionId ?? '')));
  const { __product: _p, ...params } = run.params as Record<string, unknown>;
  // Never the sealed secrets and never `__product`: only what a person may see.
  return { id: run.id, status: run.status, kind: run.kind, error: run.error, summary: run.summary, params, bindings: run.bindings, planHash: run.planHash, approvalId: run.approvalId, startedAt: run.startedAt, finishedAt: run.finishedAt, createdAt: run.createdAt, flowId: ver?.flowId ?? null, flowVersion: ver?.version ?? null, definition: (ver?.definition ?? null) as Definition | null, steps };
}

export async function listRuns(ctx: Ctx, filter: { flowId?: string } = {}) {
  assertCan(ctx, 'setup.read');
  const rows = await db
    .select({ id: playbookRuns.id, status: playbookRuns.status, kind: playbookRuns.kind, error: playbookRuns.error, params: playbookRuns.params, createdAt: playbookRuns.createdAt, finishedAt: playbookRuns.finishedAt, flowId: flowVersions.flowId })
    .from(playbookRuns)
    .leftJoin(flowVersions, and(eq(flowVersions.orgId, playbookRuns.orgId), eq(flowVersions.id, playbookRuns.flowVersionId)))
    .where(and(eq(playbookRuns.orgId, ctx.orgId), filter.flowId ? eq(flowVersions.flowId, filter.flowId) : undefined))
    .orderBy(desc(playbookRuns.createdAt))
    .limit(100);
  return rows.map(({ params, ...r }) => ({ ...r, domain: String((params as Record<string, unknown>).domain ?? (params as Record<string, unknown>).slug ?? '') }));
}
