import { and, desc, eq, gte, lt, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { auditLog, users } from '../../db/schema';
import type { Ctx } from '../ctx';
import { assertCan, can } from '../permissions';

/** Entities whose history is money: only the Owner reads them (BRD-M15, `audit.read_financial`). */
export const FINANCIAL_ENTITIES = ['invoice', 'subscription', 'payment'] as const;

export const PAGE_SIZE = 50;

export const auditFilterSchema = z.object({
  actor: z.enum(['user', 'ai', 'system']).optional(),
  userId: z.string().max(40).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  /** Inclusive start and exclusive end instants (ISO). The page turns calendar days into instants in the organization's zone. */
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Keyset cursor from the previous page: `<iso>|<id>`. */
  cursor: z.string().max(80).optional(),
});

/**
 * Newest first, 50 at a time. There is no way to change or delete an entry (BR-M15-01); this only reads. An Admin does
 * not see the history of invoices, subscriptions or payments, and asking for those entities directly returns nothing.
 */
export async function listAudit(ctx: Ctx, raw: z.input<typeof auditFilterSchema> = {}) {
  assertCan(ctx, 'audit.read');
  const f = auditFilterSchema.parse(raw);
  const conditions: Array<SQL | undefined> = [eq(auditLog.orgId, ctx.orgId)];
  if (f.actor) conditions.push(sql`${auditLog.actor} like ${f.actor + ':%'}`);
  if (f.userId) conditions.push(eq(auditLog.actorUserId, f.userId));
  if (f.entityType) conditions.push(eq(auditLog.entityType, f.entityType));
  if (f.entityId) conditions.push(eq(auditLog.entityId, f.entityId));
  if (f.from) conditions.push(gte(auditLog.createdAt, new Date(f.from)));
  if (f.to) conditions.push(lt(auditLog.createdAt, new Date(f.to)));
  if (!can(ctx.role, 'audit.read_financial')) conditions.push(notInArray(auditLog.entityType, [...FINANCIAL_ENTITIES]));
  if (f.cursor) {
    const [iso, id] = f.cursor.split('|');
    const at = new Date(iso);
    if (id && !Number.isNaN(at.getTime())) conditions.push(or(lt(auditLog.createdAt, at), and(eq(auditLog.createdAt, at), lt(auditLog.id, id))));
  }

  const rows = await db
    .select({
      id: auditLog.id,
      actor: auditLog.actor,
      actorName: users.name,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      aiRunId: auditLog.aiRunId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, and(eq(users.orgId, auditLog.orgId), eq(users.id, auditLog.actorUserId)))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(PAGE_SIZE + 1);

  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  return { entries: page, nextCursor: rows.length > PAGE_SIZE && last ? `${last.createdAt.toISOString()}|${last.id}` : null };
}

/** Entity types seen in this organization's log, for the filter list (financial ones only for the Owner). */
export async function listAuditEntityTypes(ctx: Ctx): Promise<string[]> {
  assertCan(ctx, 'audit.read');
  const rows = await db
    .selectDistinct({ type: auditLog.entityType })
    .from(auditLog)
    .where(and(eq(auditLog.orgId, ctx.orgId), can(ctx.role, 'audit.read_financial') ? undefined : notInArray(auditLog.entityType, [...FINANCIAL_ENTITIES])))
    .orderBy(auditLog.entityType);
  return rows.map((r) => r.type);
}
