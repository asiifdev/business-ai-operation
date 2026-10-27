import { auditLog } from '../../db/schema';
import type { Db, Tx } from '../../db/client';
import type { Actor } from '../ctx';

export interface AuditWho {
  orgId: string;
  actor: Actor;
  userId?: string | null;
  aiRunId?: string | null;
}

export interface AuditEntry {
  /** Dotted verb, e.g. `user.role_changed`. */
  action: string;
  entityType: string;
  entityId: string;
  /** Short, non-sensitive description of the change. Never secrets or full document text (BR-M15-06). */
  summary?: Record<string, unknown>;
}

/**
 * Appends one audit row. Call it with the SAME transaction as the change it describes: if the audit write fails
 * the change rolls back (BR-M15-03). The table is append-only at the database level (BR-M15-01).
 */
export async function recordAudit(tx: Tx | Db, who: AuditWho, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    orgId: who.orgId,
    actor: who.actor,
    actorUserId: who.userId ?? null,
    aiRunId: who.aiRunId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    summary: entry.summary ?? {},
  });
}
