import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { approvals, organizations } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';

/** Fallback time a request waits for a human: 24 hours. The organization setting `approval_ttl_hours` wins (D-025, BR-M08-05). */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ApprovalRequest {
  /** Registry tool name. The arguments are stored exactly as validated: what is approved is what runs. */
  tool: string;
  args: unknown;
  rationale: string;
  findingId?: string | null;
  ttlMs?: number;
}

/**
 * Creates a `pending` approval for a risky (`act`) tool. Nothing is executed here: a human decides later, and the
 * decision runs the same service as the manual button (BR-M07-03, CR-06). `requested_for` is the person the AI acts
 * for, so their role limits what may be approved. The audit row shares the transaction.
 */
export async function requestApproval(db: Db, ctx: Ctx, input: ApprovalRequest): Promise<{ id: string; expiresAt: Date }> {
  if (!input.rationale.trim()) throw new DomainError('validation', 'an approval needs a reason');
  const [org] = await db.select({ hours: organizations.approvalTtlHours }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const ttlMs = input.ttlMs ?? (org ? org.hours * 60 * 60 * 1000 : APPROVAL_TTL_MS);
  const expiresAt = new Date(ctx.clock.now().getTime() + ttlMs);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(approvals)
      .values({
        orgId: ctx.orgId,
        findingId: input.findingId ?? null,
        tool: input.tool,
        args: input.args as object,
        rationale: input.rationale.trim().slice(0, 500),
        requestedFor: ctx.userId,
        aiRunId: ctx.aiRunId ?? null,
        expiresAt,
      })
      .returning({ id: approvals.id });
    await recordAudit(tx, { orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId, aiRunId: ctx.aiRunId }, {
      action: 'approval.requested',
      entityType: 'approval',
      entityId: row.id,
      summary: { tool: input.tool, findingId: input.findingId ?? null },
    });
    return { id: row.id, expiresAt };
  });
}

export async function getApproval(db: Db, orgId: string, id: string) {
  const [row] = await db.select().from(approvals).where(and(eq(approvals.orgId, orgId), eq(approvals.id, id)));
  return row ?? null;
}
