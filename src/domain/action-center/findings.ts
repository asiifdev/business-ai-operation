import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { clients, deployments, findings, invoices, leads, organizations, packages, payments, products, subscriptions, tasks, users } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import { daysBetween, todayIn } from '../billing/dates';
import { deriveInvoice } from '../billing/derived';
import { loadOrgBilling } from '../billing/invoices';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { daysInStage, isStagnant } from '../pipeline/stages';
import { daysLate, isLate } from '../tasks/rules';
import { who } from '../portfolio/shared';
import { FINANCIAL_RULES, priorityOf, stillApplies, type FindingFacts, type FindingRule, type FindingStatus, type PriorityLevel } from './facts';

type FindingRow = typeof findings.$inferSelect;

export interface FindingCard {
  id: string;
  rule: FindingRule;
  status: FindingStatus;
  periodKey: string;
  snoozedUntil: Date | null;
  createdAt: Date;
  resolvedAt: Date | null;
  /** AI text saved once per finding (BR-M08-10). Null until someone asks for it, or when AI was unavailable. */
  explanation: string | null;
  draftMessage: string | null;
  aiRunId: string | null;
  facts: FindingFacts;
  priority: { score: number; level: PriorityLevel };
  financial: boolean;
  /** Where the source record lives in the app. */
  href: string | null;
}

const OPEN: FindingStatus[] = ['new', 'snoozed'];
const CLOSED_LIMIT = 50;

/** Money findings are for those who may read billing; the rest for everyone (BRD-M08 section 2). */
export function canSeeRule(ctx: Pick<Ctx, 'role'>, rule: FindingRule): boolean {
  return can(ctx.role, FINANCIAL_RULES.has(rule) ? 'finding.read_financial' : 'finding.read_nonfinancial');
}

function visibleRules(ctx: Ctx): FindingRule[] {
  return (['invoice_overdue', 'invoice_draft_ready', 'renewal_upcoming', 'task_late', 'lead_stagnant', 'deployment_outdated', 'deployment_down'] as const).filter((r) => canSeeRule(ctx, r));
}

/**
 * Reads the live facts behind a batch of findings in two queries. The same derivations as the invoice pages (CR-01), so
 * the card cannot disagree with them. Internal: callers check permissions first.
 */
export async function loadFacts(orgId: string, today: string, rows: Pick<FindingRow, 'entityType' | 'entityId'>[], now: Date): Promise<Map<string, FindingFacts>> {
  const invoiceIds = [...new Set(rows.filter((r) => r.entityType === 'invoice').map((r) => r.entityId))];
  const subscriptionIds = [...new Set(rows.filter((r) => r.entityType === 'subscription').map((r) => r.entityId))];
  const taskIds = [...new Set(rows.filter((r) => r.entityType === 'task').map((r) => r.entityId))];
  const leadIds = [...new Set(rows.filter((r) => r.entityType === 'lead').map((r) => r.entityId))];
  const deploymentIds = [...new Set(rows.filter((r) => r.entityType === 'deployment').map((r) => r.entityId))];
  const out = new Map<string, FindingFacts>();

  if (invoiceIds.length) {
    const paid = sql<number>`coalesce((select sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end) from ${payments} where ${payments.invoiceId} = ${invoices.id} and ${payments.orgId} = ${invoices.orgId}), 0)::bigint`.mapWith(Number);
    const list = await db
      .select({ id: invoices.id, number: invoices.number, status: invoices.status, clientId: invoices.clientId, clientName: clients.name, dueDate: invoices.dueDate, total: invoices.total, isAiDraft: invoices.isAiDraft, paid })
      .from(invoices)
      .innerJoin(clients, and(eq(clients.orgId, invoices.orgId), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.orgId, orgId), inArray(invoices.id, invoiceIds)));
    for (const i of list) {
      const d = deriveInvoice(i, i.paid, today);
      out.set(`invoice:${i.id}`, { kind: 'invoice', invoiceId: i.id, number: i.number, status: i.status, clientId: i.clientId, clientName: i.clientName, dueDate: i.dueDate, total: i.total, balance: d.balance, overdue: d.overdue, daysOverdue: d.daysOverdue, isAiDraft: i.isAiDraft });
    }
  }

  if (subscriptionIds.length) {
    const list = await db
      .select({
        id: subscriptions.id,
        status: subscriptions.status,
        clientId: subscriptions.clientId,
        clientName: clients.name,
        productName: products.name,
        packageName: packages.name,
        amount: subscriptions.amount,
        nextDueDate: subscriptions.nextDueDate,
        invoiced: sql<boolean>`exists (select 1 from ${invoices} where ${invoices.orgId} = ${subscriptions.orgId} and ${invoices.subscriptionId} = ${subscriptions.id} and ${invoices.periodKey} = to_char(${subscriptions.nextDueDate}, 'YYYY-MM'))`,
      })
      .from(subscriptions)
      .innerJoin(clients, and(eq(clients.orgId, subscriptions.orgId), eq(clients.id, subscriptions.clientId)))
      .innerJoin(products, and(eq(products.orgId, subscriptions.orgId), eq(products.id, subscriptions.productId)))
      .innerJoin(packages, and(eq(packages.orgId, subscriptions.orgId), eq(packages.id, subscriptions.packageId)))
      .where(and(eq(subscriptions.orgId, orgId), inArray(subscriptions.id, subscriptionIds)));
    for (const s of list) {
      out.set(`subscription:${s.id}`, {
        kind: 'subscription',
        subscriptionId: s.id,
        status: s.status,
        clientId: s.clientId,
        clientName: s.clientName,
        productName: s.productName,
        packageName: s.packageName,
        amount: s.amount,
        nextDueDate: s.nextDueDate,
        daysUntilDue: daysBetween(today, s.nextDueDate),
        invoicedForPeriod: Boolean(s.invoiced),
      });
    }
  }

  if (taskIds.length) {
    const list = await db
      .select({ task: tasks, assigneeName: users.name, clientName: clients.name })
      .from(tasks)
      .leftJoin(users, and(eq(users.orgId, tasks.orgId), eq(users.id, tasks.assigneeId)))
      .leftJoin(clients, and(eq(clients.orgId, tasks.orgId), eq(clients.id, tasks.clientId)))
      .where(and(eq(tasks.orgId, orgId), inArray(tasks.id, taskIds)));
    for (const { task: t, assigneeName, clientName } of list) {
      out.set(`task:${t.id}`, {
        kind: 'task',
        taskId: t.id,
        title: t.title,
        taskKind: t.kind,
        status: t.status,
        priority: t.priority,
        dueDate: t.dueDate,
        late: isLate(t, today),
        daysLate: daysLate(t, today),
        isDraft: t.isDraft,
        assigneeName,
        clientId: t.clientId,
        clientName,
      });
    }
  }

  if (deploymentIds.length) {
    const list = await db
      .select({ d: deployments, clientName: clients.name, productName: products.name })
      .from(deployments)
      .innerJoin(clients, and(eq(clients.orgId, deployments.orgId), eq(clients.id, deployments.clientId)))
      .innerJoin(products, and(eq(products.orgId, deployments.orgId), eq(products.id, deployments.productId)))
      .where(and(eq(deployments.orgId, orgId), inArray(deployments.id, deploymentIds)));
    for (const { d, clientName, productName } of list) {
      out.set(`deployment:${d.id}`, {
        kind: 'deployment',
        deploymentId: d.id,
        status: d.status,
        clientId: d.clientId,
        clientName,
        productName,
        environment: d.environment,
        domain: d.domain,
        repo: d.repo,
        branch: d.branch,
        deployedCommit: d.deployedCommit,
        latestCommit: d.latestCommit,
        behindBy: d.behindBy,
        uptimeState: d.uptimeState,
        uptimeChangedAt: d.uptimeChangedAt?.toISOString() ?? null,
        uptimeCheckedAt: d.uptimeCheckedAt?.toISOString() ?? null,
      });
    }
  }

  if (leadIds.length) {
    const [org] = await db.select({ stagnantDays: organizations.stagnantDays }).from(organizations).where(eq(organizations.id, orgId));
    const list = await db
      .select({ lead: leads, assigneeName: users.name })
      .from(leads)
      .leftJoin(users, and(eq(users.orgId, leads.orgId), eq(users.id, leads.assignedTo)))
      .where(and(eq(leads.orgId, orgId), inArray(leads.id, leadIds)));
    for (const { lead: l, assigneeName } of list) {
      out.set(`lead:${l.id}`, {
        kind: 'lead',
        leadId: l.id,
        name: l.name,
        stage: l.stage,
        estimatedValue: l.estimatedValue,
        stageChangedAt: l.stageChangedAt.toISOString(),
        daysInStage: daysInStage(l.stageChangedAt, now),
        stagnantDays: org.stagnantDays,
        stagnant: isStagnant(l, org.stagnantDays, now),
        assigneeName,
      });
    }
  }
  return out;
}

/**
 * Entity kinds this code can read facts for. The sweep never closes a finding of any other kind: a server still running an
 * older build must not mistake a newer rule's finding for one whose record is gone (seen with `task_late`, D-046).
 */
const KNOWN_ENTITIES: ReadonlySet<string> = new Set(['invoice', 'subscription', 'task', 'lead', 'deployment']);

const factsOf = (facts: Map<string, FindingFacts>, row: Pick<FindingRow, 'entityType' | 'entityId'>): FindingFacts => facts.get(`${row.entityType}:${row.entityId}`) ?? { kind: 'missing' };

function hrefOf(facts: FindingFacts): string | null {
  if (facts.kind === 'invoice') return `/app/invoice/${facts.invoiceId}`;
  if (facts.kind === 'subscription') return `/app/langganan/${facts.subscriptionId}`;
  if (facts.kind === 'task') return `/app/task/${facts.taskId}`;
  if (facts.kind === 'lead') return `/app/lead/${facts.leadId}`;
  if (facts.kind === 'deployment') return `/app/klien/${facts.clientId}`;
  return null;
}

function toCard(row: FindingRow, facts: FindingFacts, today: string): FindingCard {
  return {
    id: row.id,
    rule: row.rule,
    status: row.status,
    periodKey: row.periodKey,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    explanation: row.explanation,
    draftMessage: row.draftMessage,
    aiRunId: row.aiRunId,
    facts,
    priority: priorityOf(row.rule, facts, today),
    financial: FINANCIAL_RULES.has(row.rule),
    href: hrefOf(facts),
  };
}

async function orgToday(ctx: Pick<Ctx, 'orgId' | 'clock'>): Promise<string> {
  const org = await loadOrgBilling(db, ctx.orgId);
  return todayIn(org.timezone, ctx.clock.now());
}

export type FindingView = 'open' | 'snoozed' | 'closed';

/**
 * The cards of one view. Open cards come in the fixed priority order (BR-M08-14); closed ones newest first. The sweep runs
 * first, so a card whose condition is gone (the invoice was paid a minute ago) is never shown as open.
 */
export async function listFindings(ctx: Ctx, view: FindingView = 'open'): Promise<{ today: string; findings: FindingCard[] }> {
  assertCan(ctx, 'finding.read_nonfinancial');
  const rules = visibleRules(ctx);
  const today = await orgToday(ctx);
  if (rules.length === 0) return { today, findings: [] };
  await sweepFindings(ctx.orgId, ctx.clock.now());

  const statusFilter = view === 'open' ? eq(findings.status, 'new') : view === 'snoozed' ? eq(findings.status, 'snoozed') : inArray(findings.status, ['handled', 'ignored', 'auto_resolved']);
  const rows = await db
    .select()
    .from(findings)
    .where(and(eq(findings.orgId, ctx.orgId), inArray(findings.rule, rules), statusFilter))
    .orderBy(desc(view === 'closed' ? findings.updatedAt : findings.createdAt))
    .limit(view === 'closed' ? CLOSED_LIMIT : 500);
  const facts = await loadFacts(ctx.orgId, today, rows, ctx.clock.now());
  const cards = rows.map((r) => toCard(r, factsOf(facts, r), today));
  if (view !== 'closed') cards.sort((a, b) => b.priority.score - a.priority.score);
  return { today, findings: cards };
}

/** One card, with the same permission rule as the list. A finding of another organization is simply not found. */
export async function getFinding(ctx: Ctx, id: string): Promise<FindingCard> {
  const [row] = await db.select().from(findings).where(and(eq(findings.orgId, ctx.orgId), eq(findings.id, id)));
  if (!row || !canSeeRule(ctx, row.rule)) throw new DomainError('not_found', 'finding');
  const today = await orgToday(ctx);
  const facts = await loadFacts(ctx.orgId, today, [row], ctx.clock.now());
  return toCard(row, factsOf(facts, row), today);
}

/** Open counts for the shell (bell and sidebar pill): only what this person may see. */
export async function countOpenFindings(ctx: Ctx): Promise<number> {
  const rules = visibleRules(ctx);
  if (rules.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(findings)
    .where(and(eq(findings.orgId, ctx.orgId), inArray(findings.rule, rules), eq(findings.status, 'new')));
  return row?.n ?? 0;
}

export const findingActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('handle') }),
  z.object({ action: z.literal('ignore') }),
  z.object({ action: z.literal('snooze'), days: z.number().int().min(1).max(30) }),
]);

const NEXT: Record<'handle' | 'ignore' | 'snooze', FindingStatus> = { handle: 'handled', ignore: 'ignored', snooze: 'snoozed' };

/**
 * Handled, ignored or snoozed by a person (BR-M08-12). Only an open finding moves; the conditional UPDATE makes two
 * clicks (or web and Telegram at once) land once. Money findings need billing rights, as for viewing them.
 */
export async function setFindingStatus(ctx: Ctx, id: string, raw: z.input<typeof findingActionSchema>): Promise<{ status: FindingStatus }> {
  const input = findingActionSchema.parse(raw);
  const card = await getFinding(ctx, id);
  const now = ctx.clock.now();
  const status = NEXT[input.action];
  const snoozedUntil = input.action === 'snooze' ? new Date(now.getTime() + input.days * 86_400_000) : null;
  return db.transaction(async (tx) => {
    const moved = await tx
      .update(findings)
      .set({
        status,
        snoozedUntil,
        resolvedAt: status === 'snoozed' ? null : now,
        resolvedBy: status === 'snoozed' ? null : ctx.userId,
        updatedAt: now,
      })
      .where(and(eq(findings.orgId, ctx.orgId), eq(findings.id, id), inArray(findings.status, OPEN)))
      .returning({ id: findings.id });
    if (moved.length === 0) throw new DomainError('invalid_state', 'finding is already closed');
    await recordAudit(tx, who(ctx), { action: `finding.${status}`, entityType: 'finding', entityId: id, summary: { rule: card.rule, ...(snoozedUntil ? { until: snoozedUntil.toISOString() } : {}) } });
    return { status };
  });
}

const draftSchema = z.object({ draftMessage: z.string().trim().max(2000) });

/** "Edit draft" on the card. The text stays a draft: nothing is ever sent from here (BR-M08-09). */
export async function updateFindingDraft(ctx: Ctx, id: string, raw: z.input<typeof draftSchema>): Promise<void> {
  const { draftMessage } = draftSchema.parse(raw);
  await getFinding(ctx, id);
  await db.transaction(async (tx) => {
    const moved = await tx
      .update(findings)
      .set({ draftMessage: draftMessage || null, updatedAt: ctx.clock.now() })
      .where(and(eq(findings.orgId, ctx.orgId), eq(findings.id, id), inArray(findings.status, OPEN)))
      .returning({ id: findings.id });
    if (moved.length === 0) throw new DomainError('invalid_state', 'finding is already closed');
    await recordAudit(tx, who(ctx), { action: 'finding.draft_edited', entityType: 'finding', entityId: id, summary: { length: draftMessage.length } });
  });
}

/**
 * Housekeeping, safe to run at any moment and any number of times: an open finding whose condition is gone closes as
 * `auto_resolved` (BR-M08-12), and a snoozed one whose time is up comes back as `new`. Each change is a conditional
 * UPDATE with its audit row in the same transaction, so two sweeps at once change a finding once.
 */
export async function sweepFindings(orgId: string, now: Date): Promise<{ resolved: number; woken: number }> {
  const org = await loadOrgBilling(db, orgId);
  const today = todayIn(org.timezone, now);
  const open = await db.select().from(findings).where(and(eq(findings.orgId, orgId), inArray(findings.status, OPEN)));
  if (open.length === 0) return { resolved: 0, woken: 0 };
  const facts = await loadFacts(orgId, today, open, now);
  const audit: AuditWho = { orgId, actor: 'system:rule.finding_sweep' };
  let resolved = 0;

  for (const row of open) {
    if (!KNOWN_ENTITIES.has(row.entityType)) continue;
    if (stillApplies(row.rule, row.periodKey, factsOf(facts, row))) continue;
    await db.transaction(async (tx) => {
      const moved = await tx
        .update(findings)
        .set({ status: 'auto_resolved', snoozedUntil: null, resolvedAt: now, resolvedBy: null, updatedAt: now })
        .where(and(eq(findings.orgId, orgId), eq(findings.id, row.id), inArray(findings.status, OPEN)))
        .returning({ id: findings.id });
      if (moved.length === 0) return;
      resolved++;
      await recordAudit(tx, audit, { action: 'finding.auto_resolved', entityType: 'finding', entityId: row.id, summary: { rule: row.rule } });
    });
  }

  const woken = await db
    .update(findings)
    .set({ status: 'new', snoozedUntil: null, updatedAt: now })
    .where(and(eq(findings.orgId, orgId), eq(findings.status, 'snoozed'), lte(findings.snoozedUntil, now)))
    .returning({ id: findings.id });
  return { resolved, woken: woken.length };
}
