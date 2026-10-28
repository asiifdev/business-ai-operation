import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { buildActionRegistry, FINANCIAL_ACT_TOOLS } from '../../ai/tools/actions';
import { db } from '../../db/client';
import { approvals, findings, invoices, clients, users } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { who } from '../portfolio/shared';
import { sweepFindings } from './findings';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface ApprovalCard {
  id: string;
  tool: string;
  /** The arguments exactly as stored: what is approved is what runs (BR-M08-04). */
  args: unknown;
  /** One plain sentence of what will happen. */
  rationale: string;
  findingId: string | null;
  requestedForName: string | null;
  aiRunId: string | null;
  status: ApprovalStatus;
  expiresAt: Date;
  createdAt: Date;
  financial: boolean;
  /** Whether this person may decide it (finance approvals need billing rights, BR-M08-07). */
  canDecide: boolean;
  /** The record the action touches, read live, so the approver sees what it is about and not only an id. */
  target: { kind: 'invoice'; invoiceId: string; number: string | null; clientName: string; status: 'draft' | 'sent' | 'paid' | 'void'; total: number } | null;
}

/** Tool permission plus, for money, the finance-approval right. Staff therefore never approve a finance action. */
function mayDecide(ctx: Pick<Ctx, 'role'>, tool: string): boolean {
  const def = buildActionRegistry().get(tool);
  if (!def || !can(ctx.role, def.permission)) return false;
  return !FINANCIAL_ACT_TOOLS.has(tool) || can(ctx.role, 'approval.finance.decide');
}

/**
 * Pending approvals this person may look at: managers see all of the organization, everyone else the ones requested on
 * their behalf. Expired requests are moved to `expired` first, so nothing past its time is offered.
 */
export async function listPendingApprovals(ctx: Ctx): Promise<ApprovalCard[]> {
  assertCan(ctx, 'finding.read_nonfinancial');
  const now = ctx.clock.now();
  await expireApprovals(ctx.orgId, now);
  const manager = can(ctx.role, 'approval.finance.decide');
  const rows = await db
    .select({ a: approvals, forName: users.name })
    .from(approvals)
    .leftJoin(users, and(eq(users.orgId, approvals.orgId), eq(users.id, approvals.requestedFor)))
    .where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.status, 'pending'), gt(approvals.expiresAt, now), manager ? undefined : eq(approvals.requestedFor, ctx.userId)))
    .orderBy(asc(approvals.expiresAt))
    .limit(50);

  const invoiceIds = rows.map((r) => invoiceIdOf(r.a.args)).filter((x): x is string => x !== null);
  const targets = new Map<string, ApprovalCard['target']>();
  if (invoiceIds.length && can(ctx.role, 'billing.read')) {
    const list = await db
      .select({ id: invoices.id, number: invoices.number, status: invoices.status, total: invoices.total, clientName: clients.name })
      .from(invoices)
      .innerJoin(clients, and(eq(clients.orgId, invoices.orgId), eq(clients.id, invoices.clientId)))
      .where(and(eq(invoices.orgId, ctx.orgId), inArray(invoices.id, invoiceIds)));
    for (const i of list) targets.set(i.id, { kind: 'invoice', invoiceId: i.id, number: i.number, clientName: i.clientName, status: i.status, total: i.total });
  }

  return rows.map(({ a, forName }) => {
    const invoiceId = invoiceIdOf(a.args);
    return {
      id: a.id,
      tool: a.tool,
      args: a.args,
      rationale: a.rationale,
      findingId: a.findingId,
      requestedForName: forName,
      aiRunId: a.aiRunId,
      status: a.status,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
      financial: FINANCIAL_ACT_TOOLS.has(a.tool),
      canDecide: mayDecide(ctx, a.tool),
      target: invoiceId ? (targets.get(invoiceId) ?? null) : null,
    };
  });
}

function invoiceIdOf(args: unknown): string | null {
  const id = (args as { invoiceId?: unknown } | null)?.invoiceId;
  return typeof id === 'string' ? id : null;
}

export const decisionSchema = z.object({ decision: z.enum(['approve', 'reject']) });

export interface DecisionResult {
  status: ApprovalStatus;
  /** True when the action ran. False on a rejection, or when the data changed and the action was refused. */
  executed: boolean;
  /** Why an approved action did not run (the invoice was already sent, paid, or gone). */
  reason?: string;
}

/**
 * Decides one approval (BR-M08-04 to -08). The claim is a single conditional UPDATE (`status = 'pending'` and not yet
 * expired), so of two people pressing at once (web and Telegram) exactly one wins; the other gets `already_decided`.
 * Permission is checked again at decision time. An approved action runs through the SAME service as the manual button,
 * as the person who approved it, with the AI run recorded alongside (CR-07). When the data has moved on (the invoice is
 * no longer a draft), the service refuses, the approval ends `rejected` with the reason, and the finding closes itself.
 */
export async function decideApproval(ctx: Ctx, id: string, raw: z.input<typeof decisionSchema>): Promise<DecisionResult> {
  const { decision } = decisionSchema.parse(raw);
  const now = ctx.clock.now();
  const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)));
  if (!row) throw new DomainError('not_found', 'approval');
  const manager = can(ctx.role, 'approval.finance.decide');
  if (!manager && row.requestedFor !== ctx.userId) throw new DomainError('not_found', 'approval');
  if (!mayDecide(ctx, row.tool)) throw new DomainError('forbidden', `${ctx.role} may not decide ${row.tool}`);

  const status: ApprovalStatus = decision === 'approve' ? 'approved' : 'rejected';
  const claimed = await db.transaction(async (tx) => {
    const won = await tx
      .update(approvals)
      .set({ status, decidedBy: ctx.userId, decidedAt: now })
      .where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id), eq(approvals.status, 'pending'), gt(approvals.expiresAt, now)))
      .returning({ id: approvals.id });
    if (won.length === 0) return false;
    await recordAudit(tx, who(ctx), { action: `approval.${status}`, entityType: 'approval', entityId: id, summary: { tool: row.tool, findingId: row.findingId } });
    return true;
  });

  if (!claimed) {
    if (row.status === 'pending' && row.expiresAt <= now) {
      await expireApprovals(ctx.orgId, now);
      throw new DomainError('expired', 'approval expired');
    }
    const [fresh] = await db.select({ status: approvals.status }).from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)));
    throw new DomainError(fresh?.status === 'expired' ? 'expired' : 'already_decided', 'approval already decided');
  }
  if (decision === 'reject') return { status, executed: false };

  const tool = buildActionRegistry().get(row.tool)!;
  const args = tool.args.safeParse(row.args);
  // The same service as the manual button, as the approver, with the AI run that proposed it in the audit trail.
  const execCtx: Ctx = { ...ctx, aiRunId: row.aiRunId ?? undefined };
  try {
    if (!args.success) throw new DomainError('validation', 'stored arguments no longer valid');
    const result = await (tool.execute as (c: Ctx, a: unknown) => Promise<unknown>)(execCtx, args.data);
    await db.transaction(async (tx) => {
      await tx.update(approvals).set({ executionResult: { ok: true, result: (result ?? null) as object }, executedAt: ctx.clock.now() }).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)));
      if (row.findingId) {
        const closed = await tx
          .update(findings)
          .set({ status: 'handled', snoozedUntil: null, resolvedAt: ctx.clock.now(), resolvedBy: ctx.userId, updatedAt: ctx.clock.now() })
          .where(and(eq(findings.orgId, ctx.orgId), eq(findings.id, row.findingId), inArray(findings.status, ['new', 'snoozed'])))
          .returning({ id: findings.id });
        if (closed.length) await recordAudit(tx, who(execCtx), { action: 'finding.handled', entityType: 'finding', entityId: row.findingId, summary: { approvalId: id } });
      }
      await recordAudit(tx, who(execCtx), { action: 'approval.executed', entityType: 'approval', entityId: id, summary: { tool: row.tool } });
    });
    return { status, executed: true };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    // The data changed between request and decision: refuse with the reason instead of acting on stale facts (BR-M08-05).
    await db.transaction(async (tx) => {
      await tx.update(approvals).set({ status: 'rejected', executionResult: { ok: false, reason: error.code } }).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.id, id)));
      await recordAudit(tx, who(execCtx), { action: 'approval.execution_refused', entityType: 'approval', entityId: id, summary: { tool: row.tool, reason: error.code } });
    });
    await sweepFindings(ctx.orgId, ctx.clock.now());
    return { status: 'rejected', executed: false, reason: error.code };
  }
}

/** Pending approvals past their time become `expired` (BR-M08-05). A conditional UPDATE: safe to run from anywhere. */
export async function expireApprovals(orgId: string, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(approvals)
      .set({ status: 'expired' })
      .where(and(eq(approvals.orgId, orgId), eq(approvals.status, 'pending'), lte(approvals.expiresAt, now)))
      .returning({ id: approvals.id, tool: approvals.tool });
    const audit: AuditWho = { orgId, actor: 'system:rule.approval_expiry' };
    for (const r of rows) await recordAudit(tx, audit, { action: 'approval.expired', entityType: 'approval', entityId: r.id, summary: { tool: r.tool } });
    return rows.length;
  });
}
