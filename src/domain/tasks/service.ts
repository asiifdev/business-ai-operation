import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { db } from '../../db/client';
import { clients, deployments, leads, organizations, products, tasks, users } from '../../db/schema';
import { recordAudit } from '../audit/service';
import { ISO_DATE, isValidDate, todayIn } from '../billing/dates';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { optionalText, who } from '../portfolio/shared';
import {
  allowedStatusMoves,
  canMoveStatus,
  daysLate,
  defaultDueDate,
  isLate,
  isOpenWork,
  SIMILAR_THRESHOLD,
  similarity,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from './rules';

type Reader = Pick<typeof db, 'select'>;
type TaskRecord = typeof tasks.$inferSelect;

const dateField = z
  .string()
  .regex(ISO_DATE)
  .refine(isValidDate)
  .nullable()
  .optional();
const idField = z.string().min(1).max(40).nullable().optional();

const taskFields = z.object({
  title: z.string().trim().min(2).max(200),
  description: optionalText(4000),
  kind: z.enum(TASK_KINDS).default('task'),
  priority: z.enum(TASK_PRIORITIES).default('medium'),
  dueDate: dateField,
  assigneeId: idField,
  clientId: idField,
  productId: idField,
  deploymentId: idField,
  leadId: idField,
});
export const taskSchema = taskFields;
export const taskPatchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: optionalText(4000),
  kind: z.enum(TASK_KINDS).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueDate: dateField,
  assigneeId: idField,
  clientId: idField,
  productId: idField,
  deploymentId: idField,
  leadId: idField,
});

const FIELDS = ['title', 'description', 'kind', 'priority', 'dueDate', 'assigneeId', 'clientId', 'productId', 'deploymentId', 'leadId'] as const;
const RELATIONS = ['clientId', 'productId', 'deploymentId', 'leadId'] as const;

const isAi = (ctx: Ctx) => ctx.actor.startsWith('ai:');

async function orgToday(tx: Reader, ctx: Pick<Ctx, 'orgId' | 'clock'>): Promise<string> {
  const [org] = await tx.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return todayIn(org.timezone, ctx.clock.now());
}

async function loadTask(tx: Reader, orgId: string, id: string): Promise<TaskRecord> {
  const [row] = await tx.select().from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.id, id)));
  if (!row) throw new DomainError('not_found', 'task');
  return row;
}

/**
 * A staff member's own task: assigned to them, or made by them and not handed to anyone yet (PRD section 3, BR-M05-07).
 * Managers may touch every task.
 */
export function ownsTask(ctx: Pick<Ctx, 'userId'>, task: Pick<TaskRecord, 'assigneeId' | 'createdBy'>): boolean {
  return task.assigneeId === ctx.userId || (task.assigneeId === null && task.createdBy === ctx.userId);
}

export function mayTouch(ctx: Pick<Ctx, 'role' | 'userId'>, task: Pick<TaskRecord, 'assigneeId' | 'createdBy'>): boolean {
  return can(ctx.role, 'task.update_any') || (can(ctx.role, 'task.update_own') && ownsTask(ctx, task));
}

function assertCanTouch(ctx: Ctx, task: Pick<TaskRecord, 'assigneeId' | 'createdBy'>) {
  if (!mayTouch(ctx, task)) throw new DomainError('forbidden', `${ctx.role} may not change this task`);
}

/** Handing work to someone else is a manager's call; staff may take a task themselves or leave it unassigned. */
async function assertAssignable(tx: Reader, ctx: Ctx, assigneeId: string | null | undefined) {
  if (assigneeId == null) return;
  if (assigneeId !== ctx.userId && !can(ctx.role, 'task.update_any')) throw new DomainError('forbidden', 'staff may only assign a task to themselves');
  const [user] = await tx.select({ isActive: users.isActive }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.id, assigneeId)));
  if (!user) throw new DomainError('not_found', 'assignee');
  if (!user.isActive) throw new DomainError('invalid_state', 'inactive assignee');
}

type Relations = Pick<TaskRecord, (typeof RELATIONS)[number]>;

/**
 * Checks that every related record belongs to this organization (BR-M05-08) and keeps the relations coherent: a task about
 * a deployment is also about that deployment's client and product, and a different client or product is refused.
 */
async function resolveRelations(tx: Reader, orgId: string, r: Relations): Promise<Relations> {
  const out = { ...r };
  if (r.deploymentId) {
    const [d] = await tx.select({ clientId: deployments.clientId, productId: deployments.productId }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.id, r.deploymentId)));
    if (!d) throw new DomainError('not_found', 'deployment');
    if ((r.clientId && r.clientId !== d.clientId) || (r.productId && r.productId !== d.productId)) throw new DomainError('validation', 'the deployment belongs to another client or product');
    out.clientId = d.clientId;
    out.productId = d.productId;
  }
  if (out.clientId) {
    const [c] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, out.clientId)));
    if (!c) throw new DomainError('not_found', 'client');
  }
  if (out.productId) {
    const [p] = await tx.select({ id: products.id }).from(products).where(and(eq(products.orgId, orgId), eq(products.id, out.productId)));
    if (!p) throw new DomainError('not_found', 'product');
  }
  if (out.leadId) {
    const [l] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.id, out.leadId)));
    if (!l) throw new DomainError('not_found', 'lead');
  }
  return out;
}

export interface CreateTaskOptions {
  /** Where an AI-made task came from (`assistant`, `meeting`, `telegram_photo`) and the exact words it rests on. Never from a request body. */
  source?: string;
  sourceQuote?: string;
  /** The recording an action item came from (M09). */
  meetingId?: string;
}

/**
 * Creates a task. One made by an AI run is a DRAFT: it does not count as open work and is never late until a person accepts
 * it (BR-M05-05). A Bug or Maintenance task without a due date gets the default for its priority (BR-M05-04).
 */
export async function createTask(ctx: Ctx, raw: z.input<typeof taskSchema>, opts: CreateTaskOptions = {}): Promise<{ id: string; dueDate: string | null; isDraft: boolean }> {
  assertCan(ctx, 'task.create');
  const input = taskSchema.parse(raw);
  return db.transaction(async (tx) => {
    await assertAssignable(tx, ctx, input.assigneeId);
    const rel = await resolveRelations(tx, ctx.orgId, { clientId: input.clientId ?? null, productId: input.productId ?? null, deploymentId: input.deploymentId ?? null, leadId: input.leadId ?? null });
    const dueDate = defaultDueDate(input.kind, input.priority, await orgToday(tx, ctx), input.dueDate);
    const draft = isAi(ctx);
    const [row] = await tx
      .insert(tasks)
      .values({
        orgId: ctx.orgId,
        title: input.title,
        description: input.description ?? null,
        kind: input.kind,
        priority: input.priority,
        dueDate,
        assigneeId: input.assigneeId ?? null,
        ...rel,
        isDraft: draft,
        source: opts.source ?? (draft ? 'assistant' : null),
        sourceQuote: opts.sourceQuote?.slice(0, 1000) ?? null,
        meetingId: opts.meetingId ?? null,
        createdBy: ctx.userId,
      })
      .returning({ id: tasks.id });
    await recordAudit(tx, who(ctx), { action: 'task.created', entityType: 'task', entityId: row.id, summary: { kind: input.kind, priority: input.priority, draft, ...(rel.clientId ? { clientId: rel.clientId } : {}) } });
    return { id: row.id, dueDate, isDraft: draft };
  });
}

/** Changes the fields of a task. Status has its own path (`setTaskStatus`) so its rules cannot be skipped. */
export async function updateTask(ctx: Ctx, id: string, raw: z.input<typeof taskPatchSchema>): Promise<void> {
  if (isAi(ctx)) throw new DomainError('forbidden', 'an AI run may only draft tasks (BRD-M05 section 2)');
  const patch = taskPatchSchema.parse(raw);
  await db.transaction(async (tx) => {
    const before = await loadTask(tx, ctx.orgId, id);
    assertCanTouch(ctx, before);
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) await assertAssignable(tx, ctx, patch.assigneeId);

    const next: Relations = {
      clientId: patch.clientId !== undefined ? patch.clientId : before.clientId,
      productId: patch.productId !== undefined ? patch.productId : before.productId,
      deploymentId: patch.deploymentId !== undefined ? patch.deploymentId : before.deploymentId,
      leadId: patch.leadId !== undefined ? patch.leadId : before.leadId,
    };
    const relationsTouched = RELATIONS.some((k) => patch[k] !== undefined);
    const rel = relationsTouched ? await resolveRelations(tx, ctx.orgId, next) : next;

    const set: Partial<typeof tasks.$inferInsert> = {};
    const changed: string[] = [];
    for (const key of FIELDS) {
      const value = (RELATIONS as readonly string[]).includes(key) ? rel[key as keyof Relations] : patch[key];
      if (value !== undefined && value !== before[key]) {
        set[key] = value as never;
        changed.push(key);
      }
    }
    if (changed.length === 0) return;
    set.updatedAt = ctx.clock.now();
    await tx.update(tasks).set(set).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id)));
    // Which fields changed; who the task went to is recorded too, because assignment is audited (BR-M05-09).
    await recordAudit(tx, who(ctx), {
      action: changed.includes('assigneeId') ? 'task.assigned' : 'task.updated',
      entityType: 'task',
      entityId: id,
      summary: { fields: changed, ...(changed.includes('assigneeId') ? { from: before.assigneeId, to: set.assigneeId ?? null } : {}) },
    });
  });
}

/**
 * Moves a task to another status (BR-M05-01). The conditional UPDATE on the old status makes a double click land once.
 * Staff may only move their own tasks (BR-M05-07); a draft must be accepted first; an AI run never closes work.
 */
export async function setTaskStatus(ctx: Ctx, id: string, to: TaskStatus): Promise<{ status: TaskStatus }> {
  if (isAi(ctx)) throw new DomainError('forbidden', 'an AI run may not change a task status (BRD-M05 section 2)');
  return db.transaction(async (tx) => {
    const task = await loadTask(tx, ctx.orgId, id);
    assertCanTouch(ctx, task);
    if (task.isDraft) throw new DomainError('invalid_state', 'accept the draft before working on it');
    if (task.status === to) return { status: to };
    if (!canMoveStatus(task.status, to)) throw new DomainError('invalid_state', `a task cannot go from ${task.status} to ${to}`);
    const now = ctx.clock.now();
    const moved = await tx
      .update(tasks)
      .set({ status: to, completedAt: to === 'done' ? now : null, updatedAt: now })
      .where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id), eq(tasks.status, task.status)))
      .returning({ id: tasks.id });
    if (moved.length === 0) throw new DomainError('invalid_state', 'the task changed meanwhile');
    await recordAudit(tx, who(ctx), { action: 'task.status_changed', entityType: 'task', entityId: id, summary: { from: task.status, to } });
    return { status: to };
  });
}

/** A person accepts an AI draft: from now on it counts as open work and can become late (BR-M05-05). */
export async function acceptTaskDraft(ctx: Ctx, id: string): Promise<void> {
  if (isAi(ctx)) throw new DomainError('forbidden', 'only a person accepts a draft');
  await db.transaction(async (tx) => {
    const task = await loadTask(tx, ctx.orgId, id);
    assertCanTouch(ctx, task);
    if (!task.isDraft) return;
    await tx.update(tasks).set({ isDraft: false, updatedAt: ctx.clock.now() }).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id)));
    await recordAudit(tx, who(ctx), { action: 'task.draft_accepted', entityType: 'task', entityId: id, summary: { source: task.source } });
  });
}

/** A person turns down an AI draft. Only a draft can go: real tasks are closed, never deleted. */
export async function discardTaskDraft(ctx: Ctx, id: string): Promise<void> {
  if (isAi(ctx)) throw new DomainError('forbidden', 'only a person discards a draft');
  await db.transaction(async (tx) => {
    const task = await loadTask(tx, ctx.orgId, id);
    assertCanTouch(ctx, task);
    if (!task.isDraft) throw new DomainError('invalid_state', 'only a draft can be discarded');
    const [linked] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.duplicateOfTaskId, id))).limit(1);
    if (linked) throw new DomainError('invalid_state', 'another task is linked to this draft');
    await tx.delete(tasks).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id), eq(tasks.isDraft, true)));
    await recordAudit(tx, who(ctx), { action: 'task.draft_discarded', entityType: 'task', entityId: id, summary: { title: task.title, source: task.source } });
  });
}

/**
 * Links a task to a similar one as related, or removes the link (`null`). Linking never merges or deletes anything
 * (BR-M05-06). A link that would loop back to the task itself is refused.
 */
export async function linkRelatedTask(ctx: Ctx, id: string, relatedTo: string | null): Promise<void> {
  if (isAi(ctx)) throw new DomainError('forbidden', 'an AI run may only suggest a link (BR-M05-06)');
  await db.transaction(async (tx) => {
    const task = await loadTask(tx, ctx.orgId, id);
    assertCanTouch(ctx, task);
    if (task.duplicateOfTaskId === relatedTo) return;
    if (relatedTo !== null) {
      if (relatedTo === id) throw new DomainError('validation', 'a task cannot be linked to itself');
      let cursor: string | null = relatedTo;
      for (let hops = 0; cursor && hops < 20; hops++) {
        const parent: TaskRecord = await loadTask(tx, ctx.orgId, cursor);
        if (parent.duplicateOfTaskId === id) throw new DomainError('invalid_state', 'these tasks are already linked the other way');
        cursor = parent.duplicateOfTaskId;
      }
    }
    await tx.update(tasks).set({ duplicateOfTaskId: relatedTo, updatedAt: ctx.clock.now() }).where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id)));
    await recordAudit(tx, who(ctx), { action: relatedTo ? 'task.linked' : 'task.unlinked', entityType: 'task', entityId: id, summary: { relatedTo: relatedTo ?? task.duplicateOfTaskId } });
  });
}

export interface TaskRow {
  id: string;
  kind: TaskKind;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  clientId: string | null;
  clientName: string | null;
  productId: string | null;
  productName: string | null;
  deploymentId: string | null;
  deploymentLabel: string | null;
  leadId: string | null;
  leadName: string | null;
  isDraft: boolean;
  source: string | null;
  sourceQuote: string | null;
  duplicateOfTaskId: string | null;
  completedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  /** Derived (BR-M05-03): due before today, not done, not a draft. */
  late: boolean;
  daysLate: number;
  /** Where the task may go next, for the buttons. Empty for drafts and for people who may not move it. */
  nextStatuses: TaskStatus[];
  /** Whether the person asking may edit or move this task. */
  canEdit: boolean;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

function baseQuery() {
  const assignee = alias(users, 'assignee');
  return db
    .select({
      task: tasks,
      assigneeName: assignee.name,
      clientName: clients.name,
      productName: products.name,
      deploymentLabel: sql<string | null>`coalesce(${deployments.label}, ${deployments.domain}, ${deployments.environment}::text)`,
      leadName: leads.name,
    })
    .from(tasks)
    .leftJoin(assignee, and(eq(assignee.orgId, tasks.orgId), eq(assignee.id, tasks.assigneeId)))
    .leftJoin(clients, and(eq(clients.orgId, tasks.orgId), eq(clients.id, tasks.clientId)))
    .leftJoin(products, and(eq(products.orgId, tasks.orgId), eq(products.id, tasks.productId)))
    .leftJoin(deployments, and(eq(deployments.orgId, tasks.orgId), eq(deployments.id, tasks.deploymentId)))
    .leftJoin(leads, and(eq(leads.orgId, tasks.orgId), eq(leads.id, tasks.leadId)));
}

type Joined = Awaited<ReturnType<ReturnType<typeof baseQuery>['where']>>[number];

function toRow(ctx: Ctx, j: Joined, today: string): TaskRow {
  const t = j.task;
  const editable = mayTouch(ctx, t);
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    assigneeId: t.assigneeId,
    assigneeName: j.assigneeName,
    clientId: t.clientId,
    clientName: j.clientName,
    productId: t.productId,
    productName: j.productName,
    deploymentId: t.deploymentId,
    deploymentLabel: t.deploymentId ? j.deploymentLabel : null,
    leadId: t.leadId,
    leadName: j.leadName,
    isDraft: t.isDraft,
    source: t.source,
    sourceQuote: t.sourceQuote,
    duplicateOfTaskId: t.duplicateOfTaskId,
    completedAt: t.completedAt,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    late: isLate(t, today),
    daysLate: daysLate(t, today),
    nextStatuses: editable && !t.isDraft ? allowedStatusMoves(t.status) : [],
    canEdit: editable,
  };
}

/** Drafts first (they wait for a decision), then late, then by due date and priority; done work last. */
function byUrgency(a: TaskRow, b: TaskRow): number {
  return (
    Number(b.isDraft) - Number(a.isDraft) ||
    Number(a.status === 'done') - Number(b.status === 'done') ||
    Number(b.late) - Number(a.late) ||
    (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31') ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

export const taskFilterSchema = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  kind: z.enum(TASK_KINDS).optional(),
  /** `me`, `none`, or a user id. */
  assignee: z.string().min(1).max(40).optional(),
  clientId: z.string().min(1).max(40).optional(),
  productId: z.string().min(1).max(40).optional(),
  deploymentId: z.string().min(1).max(40).optional(),
  leadId: z.string().min(1).max(40).optional(),
  /** Only late tasks (derived, so filtered after the clock is read). */
  late: z.boolean().optional(),
  /** Done tasks are left out unless asked for or the status filter is `done`. */
  includeDone: z.boolean().optional(),
});
export type TaskFilter = z.infer<typeof taskFilterSchema>;

const LIST_LIMIT = 500;

export async function listTasks(ctx: Ctx, raw: z.input<typeof taskFilterSchema> = {}): Promise<TaskRow[]> {
  assertCan(ctx, 'task.read');
  const f = taskFilterSchema.parse(raw);
  const today = await orgToday(db, ctx);
  const assignee = f.assignee === 'me' ? eq(tasks.assigneeId, ctx.userId) : f.assignee === 'none' ? isNull(tasks.assigneeId) : f.assignee ? eq(tasks.assigneeId, f.assignee) : undefined;
  const rows = await baseQuery()
    .where(
      and(
        eq(tasks.orgId, ctx.orgId),
        f.status ? eq(tasks.status, f.status) : f.includeDone ? undefined : ne(tasks.status, 'done'),
        f.kind ? eq(tasks.kind, f.kind) : undefined,
        assignee,
        f.clientId ? eq(tasks.clientId, f.clientId) : undefined,
        f.productId ? eq(tasks.productId, f.productId) : undefined,
        f.deploymentId ? eq(tasks.deploymentId, f.deploymentId) : undefined,
        f.leadId ? eq(tasks.leadId, f.leadId) : undefined,
      ),
    )
    .orderBy(asc(tasks.dueDate))
    .limit(LIST_LIMIT);
  const out = rows.map((r) => toRow(ctx, r, today));
  return (f.late ? out.filter((t) => t.late) : out).sort(byUrgency);
}

export interface TaskDetail extends TaskRow {
  /** The task this one is linked to, and the tasks linked to this one (BR-M05-06). */
  related: Array<{ id: string; title: string; status: TaskStatus; direction: 'parent' | 'child' }>;
}

export async function getTask(ctx: Ctx, id: string): Promise<TaskDetail> {
  assertCan(ctx, 'task.read');
  const today = await orgToday(db, ctx);
  const [row] = await baseQuery().where(and(eq(tasks.orgId, ctx.orgId), eq(tasks.id, id)));
  if (!row) throw new DomainError('not_found', 'task');
  const links = await db
    .select({ id: tasks.id, title: tasks.title, status: tasks.status, duplicateOfTaskId: tasks.duplicateOfTaskId })
    .from(tasks)
    .where(and(eq(tasks.orgId, ctx.orgId), or(eq(tasks.duplicateOfTaskId, id), row.task.duplicateOfTaskId ? eq(tasks.id, row.task.duplicateOfTaskId) : sql`false`)));
  return {
    ...toRow(ctx, row, today),
    related: links.map((l) => ({ id: l.id, title: l.title, status: l.status, direction: l.duplicateOfTaskId === id ? ('child' as const) : ('parent' as const) })),
  };
}

export interface TaskSummary {
  /** Accepted tasks not done yet (BR-M05-05: drafts are not counted). */
  open: number;
  inProgress: number;
  late: number;
  /** Open work assigned to the person asking. */
  mine: number;
  drafts: number;
}

/** The one place task counts are computed: the task page, the dashboard, the assistant and Telegram all call this. */
export async function getTaskSummary(ctx: Ctx): Promise<TaskSummary> {
  assertCan(ctx, 'task.read');
  const today = await orgToday(db, ctx);
  const rows = await db
    .select({ status: tasks.status, dueDate: tasks.dueDate, isDraft: tasks.isDraft, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(eq(tasks.orgId, ctx.orgId), ne(tasks.status, 'done')));
  const open = rows.filter(isOpenWork);
  return {
    open: open.length,
    inProgress: open.filter((t) => t.status === 'in_progress').length,
    late: open.filter((t) => isLate(t, today)).length,
    mine: open.filter((t) => t.assigneeId === ctx.userId).length,
    drafts: rows.filter((t) => t.isDraft).length,
  };
}

export interface SimilarTask {
  id: string;
  title: string;
  status: TaskStatus;
  kind: TaskKind;
  clientName: string | null;
  /** 0 to 1, from word overlap. */
  score: number;
}

const SIMILAR_LIMIT = 5;
const SIMILAR_POOL = 300;

/**
 * Tasks that read like the given one (BRD-M05 section 4 step 5): a suggestion only, linking stays a person's decision.
 * Plain word overlap over the most recent tasks, never embeddings (PRD M05). With a task id, the task itself and tasks
 * already linked to it are left out.
 */
export async function findSimilarTasks(ctx: Ctx, probe: { taskId: string } | { title: string; description?: string | null }): Promise<SimilarTask[]> {
  assertCan(ctx, 'task.read');
  let target: { title: string; description?: string | null };
  let skip = new Set<string>();
  if ('taskId' in probe) {
    const t = await loadTask(db, ctx.orgId, probe.taskId);
    target = t;
    skip = new Set([t.id, ...(t.duplicateOfTaskId ? [t.duplicateOfTaskId] : [])]);
  } else {
    target = probe;
  }
  const pool = await db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status, kind: tasks.kind, duplicateOfTaskId: tasks.duplicateOfTaskId, clientName: clients.name })
    .from(tasks)
    .leftJoin(clients, and(eq(clients.orgId, tasks.orgId), eq(clients.id, tasks.clientId)))
    .where(eq(tasks.orgId, ctx.orgId))
    .orderBy(sql`${tasks.createdAt} desc`)
    .limit(SIMILAR_POOL);
  return pool
    .filter((c) => !skip.has(c.id) && !('taskId' in probe && c.duplicateOfTaskId === probe.taskId))
    .map((c) => ({ id: c.id, title: c.title, status: c.status, kind: c.kind, clientName: c.clientName, score: Math.round(similarity(target, c) * 100) / 100 }))
    .filter((c) => c.score >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, SIMILAR_LIMIT);
}

export interface TaskFormOptions {
  assignees: Array<{ id: string; name: string }>;
  clients: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
  deployments: Array<{ id: string; clientId: string; productId: string; label: string }>;
  /** Staff may only assign a task to themselves (PRD section 3). */
  canAssignOthers: boolean;
  today: string;
}

/** Choices for the task form. Only active people and unarchived records are offered. */
export async function getTaskFormOptions(ctx: Ctx): Promise<TaskFormOptions> {
  assertCan(ctx, 'task.create');
  const [people, clientRows, productRows, deploymentRows, today] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.isActive, true))).orderBy(asc(users.name)),
    db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.archivedAt))).orderBy(asc(sql`lower(${clients.name})`)),
    db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(sql`lower(${products.name})`)),
    db
      .select({ id: deployments.id, clientId: deployments.clientId, productId: deployments.productId, productName: products.name, environment: deployments.environment, label: deployments.label, domain: deployments.domain })
      .from(deployments)
      .innerJoin(products, and(eq(products.orgId, deployments.orgId), eq(products.id, deployments.productId)))
      .where(eq(deployments.orgId, ctx.orgId)),
    orgToday(db, ctx),
  ]);
  const canAssignOthers = can(ctx.role, 'task.update_any');
  return {
    assignees: canAssignOthers ? people : people.filter((p) => p.id === ctx.userId),
    clients: clientRows,
    products: productRows,
    deployments: deploymentRows.map((d) => ({ id: d.id, clientId: d.clientId, productId: d.productId, label: `${d.productName} · ${d.label ?? d.domain ?? d.environment}` })),
    canAssignOthers,
    today,
  };
}

/** Accepted, unfinished tasks past their due date, for the Action Center rule `task_late` (BR-M05-03, BRD-M08). */
export async function listLateTasks(orgId: string, now: Date): Promise<Array<{ id: string; dueDate: string }>> {
  const today = await orgToday(db, { orgId, clock: { now: () => now } });
  const rows = await db
    .select({ id: tasks.id, dueDate: tasks.dueDate })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), ne(tasks.status, 'done'), eq(tasks.isDraft, false), sql`${tasks.dueDate} < ${today}::date`));
  return rows.map((r) => ({ id: r.id, dueDate: r.dueDate! }));
}
