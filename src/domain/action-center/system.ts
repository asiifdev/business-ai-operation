import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { users } from '../../db/schema';
import type { Clock } from '../../lib/clock';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';

/**
 * Context for work the scheduler does on its own (an AI explanation, the daily briefing). The actor is the system rule;
 * `userId` is the organization's first active Owner, because an AI run is always on someone's behalf and spends that
 * organization's budget (BR-M07-07). Nothing here comes from user input.
 */
export async function systemCtx(orgId: string, rule: string, clock: Clock): Promise<Ctx> {
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.orgId, orgId), eq(users.role, 'owner'), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!owner) throw new DomainError('not_found', 'active owner');
  return { orgId, actor: `system:${rule}`, userId: owner.id, role: 'owner', clock };
}
