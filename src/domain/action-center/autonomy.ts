import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { approvals, clients, deployments, leads, organizations, products, tasks } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can, type Action } from '../permissions';
import { setClientArchived, updateClient } from '../portfolio/clients';
import { updateDeployment } from '../portfolio/deployments';
import { archiveProduct, updateProduct } from '../portfolio/products';
import { clientHasHistory, productHasHistory } from '../portfolio/history';
import { who } from '../portfolio/shared';
import { moveLead, updateLead } from '../pipeline/leads';
import { setTaskStatus, updateTask } from '../tasks/service';

/** D-082: how much the assistant may do by itself for the person who asked. */
export const AUTONOMY_LEVELS = ['careful', 'balanced', 'autonomous'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export const autonomySchema = z.object({ level: z.enum(AUTONOMY_LEVELS) });

/**
 * How risky each `act` tool is. Decided here, in code, never by the model (D-082). `low`: internal and can be taken back.
 * `medium`: several records at once or not undoable by itself. `high`: money, locking, or a server. A tool missing from
 * this list is `high`, so a new tool never runs by itself until someone decides it may.
 */
export const ACT_RISK: Readonly<Record<string, 'low' | 'medium' | 'high'>> = {
  create_client: 'low',
  update_client: 'low',
  create_product: 'low',
  update_product: 'low',
  update_deployment: 'low',
  update_lead: 'low',
  move_lead: 'low',
  update_task: 'low',
  // A deployment cannot be archived, so adding one cannot be taken back by the button: only `autonomous` skips the click.
  create_deployment: 'medium',
  convert_lead_to_client: 'medium',
  create_subscription: 'high',
  mark_invoice_sent: 'high',
  finalize_document: 'high',
  start_flow_run: 'high',
};

/** `careful` never, `balanced` only low, `autonomous` low and medium. High always waits for a click. */
export function mayAutoRun(level: AutonomyLevel, tool: string): boolean {
  const risk = ACT_RISK[tool] ?? 'high';
  if (risk === 'high') return false;
  if (level === 'autonomous') return true;
  return level === 'balanced' && risk === 'low';
}

export async function getAutonomy(orgId: string): Promise<AutonomyLevel> {
  const [row] = await db.select({ level: organizations.aiAutonomy }).from(organizations).where(eq(organizations.id, orgId));
  return row?.level ?? 'balanced';
}

/** Only the Owner changes it; the audit row names the old and the new level. */
export async function setAutonomy(ctx: Ctx, raw: z.input<typeof autonomySchema>): Promise<{ level: AutonomyLevel; changed: boolean }> {
  assertCan(ctx, 'org.ai_autonomy.update');
  const { level } = autonomySchema.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select({ level: organizations.aiAutonomy }).from(organizations).where(eq(organizations.id, ctx.orgId));
    if (!before) throw new DomainError('not_found', 'organization');
    if (before.level === level) return { level, changed: false };
    await tx.update(organizations).set({ aiAutonomy: level, updatedAt: ctx.clock.now() }).where(eq(organizations.id, ctx.orgId));
    await recordAudit(tx, who(ctx), { action: 'org.ai_autonomy_changed', entityType: 'organization', entityId: ctx.orgId, summary: { from: before.level, to: level } });
    return { level, changed: true };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Undo (D-082 §5). Before the action runs, the values it will change are read; after it ran, the values it left are read
// again. Taking it back restores the old values, and only while the record still holds what the action left: if a person
// changed it since, the button refuses instead of overwriting their work.
// ---------------------------------------------------------------------------------------------------------------------

type Entity = 'client' | 'product' | 'deployment' | 'lead' | 'task';
export type UndoSpec =
  | { kind: 'restore'; entity: Entity; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
  | { kind: 'archive'; entity: 'client' | 'product'; id: string }
  | { kind: 'stage'; leadId: string; from: string; to: string };

const TABLE = { client: clients, product: products, deployment: deployments, lead: leads, task: tasks } as const;

async function readFields(orgId: string, entity: Entity, id: string, keys: string[]): Promise<Record<string, unknown> | null> {
  const table = TABLE[entity];
  const [row] = (await db.select().from(table).where(and(eq(table.orgId, orgId), eq(table.id, id)))) as Array<Record<string, unknown>>;
  if (!row) return null;
  return Object.fromEntries(keys.map((k) => [k, row[k] ?? null]));
}

const TARGET: Record<string, { entity: Entity; idKey: string } | undefined> = {
  update_client: { entity: 'client', idKey: 'clientId' },
  update_product: { entity: 'product', idKey: 'productId' },
  update_deployment: { entity: 'deployment', idKey: 'deploymentId' },
  update_lead: { entity: 'lead', idKey: 'leadId' },
  update_task: { entity: 'task', idKey: 'taskId' },
};

/** Read before the action runs. Returns what `undoFor` needs afterwards, or null when the tool has no undo. */
export async function snapshotBefore(ctx: Ctx, tool: string, args: unknown): Promise<unknown> {
  const a = (args ?? {}) as Record<string, unknown>;
  const target = TARGET[tool];
  if (target) {
    const id = String(a[target.idKey] ?? '');
    const keys = Object.keys(a).filter((k) => k !== target.idKey);
    return { id, before: await readFields(ctx.orgId, target.entity, id, keys), keys };
  }
  if (tool === 'move_lead') {
    const id = String(a.leadId ?? '');
    return { id, before: await readFields(ctx.orgId, 'lead', id, ['stage']) };
  }
  return null;
}

/** The undo to store after the action ran, or null when it cannot be taken back by the button. */
export async function undoFor(ctx: Ctx, tool: string, args: unknown, snapshot: unknown, result: unknown): Promise<UndoSpec | null> {
  const target = TARGET[tool];
  if (target && snapshot) {
    const s = snapshot as { id: string; before: Record<string, unknown> | null; keys: string[] };
    if (!s.before) return null;
    const after = await readFields(ctx.orgId, target.entity, s.id, s.keys);
    if (!after) return null;
    const changed = s.keys.filter((k) => JSON.stringify(s.before![k]) !== JSON.stringify(after[k]));
    if (changed.length === 0) return null;
    return {
      kind: 'restore',
      entity: target.entity,
      id: s.id,
      before: Object.fromEntries(changed.map((k) => [k, s.before![k]])),
      after: Object.fromEntries(changed.map((k) => [k, after[k]])),
    };
  }
  if (tool === 'move_lead' && snapshot) {
    const s = snapshot as { id: string; before: { stage?: string } | null };
    const to = (args as { to?: string }).to;
    if (!s.before?.stage || !to || s.before.stage === to) return null;
    return { kind: 'stage', leadId: s.id, from: s.before.stage, to };
  }
  const id = (result as { id?: unknown } | null)?.id;
  if (typeof id === 'string' && tool === 'create_client') return { kind: 'archive', entity: 'client', id };
  if (typeof id === 'string' && tool === 'create_product') return { kind: 'archive', entity: 'product', id };
  return null;
}

const PATCH_UPDATERS: Record<Entity, ((ctx: Ctx, id: string, patch: Record<string, unknown>) => Promise<unknown>) | null> = {
  client: (ctx, id, patch) => updateClient(ctx, id, patch),
  product: (ctx, id, patch) => updateProduct(ctx, id, patch),
  deployment: (ctx, id, patch) => updateDeployment(ctx, id, patch),
  lead: (ctx, id, patch) => updateLead(ctx, id, patch),
  task: async (ctx, id, patch) => {
    const { status, ...rest } = patch;
    if (Object.keys(rest).length) await updateTask(ctx, id, rest);
    if (typeof status === 'string') await setTaskStatus(ctx, id, status as 'open' | 'in_progress' | 'done');
  },
};

const PERMISSION_OF = (tool: string): Action | undefined => ({ create_client: 'client.write', update_client: 'client.write', create_product: 'catalog.write', update_product: 'catalog.write', update_deployment: 'deployment.write', update_lead: 'lead.update_assigned', move_lead: 'lead.update_assigned', update_task: 'task.update_own' } as Record<string, Action>)[tool];

export interface UndoResult {
  undone: boolean;
  reason?: 'nothing_to_undo' | 'already_undone' | 'changed_since' | 'refused';
}

/**
 * Takes an automatic action back. Runs as the person pressing the button, with their own rights, through the same services
 * as the forms. Records `approval.undone`. Refuses (`changed_since`) when somebody edited the record after the action.
 */
export async function undoApproval(ctx: Ctx, id: string): Promise<UndoResult> {
  const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)));
  if (!row || (row.requestedFor !== ctx.userId && !can(ctx.role, 'approval.finance.decide'))) throw new DomainError('not_found', 'approval');
  if (!row.autoRun || !row.undo) return { undone: false, reason: 'nothing_to_undo' };
  if (row.undoneAt) return { undone: false, reason: 'already_undone' };

  const spec = row.undo as UndoSpec;
  // Taking back an addition archives it, which is a manager's right; every other undo needs the right the action itself needed.
  const permission: Action | undefined = spec.kind === 'archive' ? 'catalog.archive' : PERMISSION_OF(row.tool);
  if (!permission || !can(ctx.role, permission)) throw new DomainError('forbidden', `${ctx.role} may not undo ${row.tool}`);
  const run: Ctx = { ...ctx, aiRunId: row.aiRunId ?? undefined };
  try {
    if (spec.kind === 'restore') {
      const current = await readFields(ctx.orgId, spec.entity, spec.id, Object.keys(spec.after));
      if (!current || Object.keys(spec.after).some((k) => JSON.stringify(current[k]) !== JSON.stringify(spec.after[k]))) return { undone: false, reason: 'changed_since' };
      await PATCH_UPDATERS[spec.entity]!(run, spec.id, spec.before);
    } else if (spec.kind === 'stage') {
      const current = await readFields(ctx.orgId, 'lead', spec.leadId, ['stage']);
      if (current?.stage !== spec.to) return { undone: false, reason: 'changed_since' };
      await moveLead(run, spec.leadId, spec.from as never);
    } else {
      // A record the assistant added is archived, never deleted. Anything attached to it since makes the button refuse.
      const used = spec.entity === 'client' ? await clientHasHistory(db, ctx.orgId, spec.id) : await productHasHistory(db, ctx.orgId, spec.id);
      if (used) return { undone: false, reason: 'changed_since' };
      if (spec.entity === 'client') await setClientArchived(run, spec.id, true);
      else await archiveProduct(run, spec.id);
    }
  } catch (error) {
    if (error instanceof DomainError) return { undone: false, reason: 'refused' };
    throw error;
  }

  const marked = await db.transaction(async (tx) => {
    const won = await tx
      .update(approvals)
      .set({ undoneAt: ctx.clock.now() })
      .where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)))
      .returning({ id: approvals.id });
    await recordAudit(tx, who(run), { action: 'approval.undone', entityType: 'approval', entityId: id, summary: { tool: row.tool } });
    return won.length > 0;
  });
  return marked ? { undone: true } : { undone: false, reason: 'refused' };
}
