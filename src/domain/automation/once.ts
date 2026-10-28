import { sql } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { automationRuns } from '../../db/schema';

/**
 * Runs `fn` at most once for (organization, rule, key), ever (CR-10, BR-M15-04). The claim is one INSERT against the
 * unique index on `automation_runs`: whoever inserts the row runs; a second caller, in this process or another, inserts
 * nothing and gets `ran: false`. The claim lives in the caller's transaction, so if `fn` fails the claim is rolled back
 * with it and the next run tries again instead of the work being lost.
 */
export async function automationOnce<T>(tx: Tx, orgId: string, rule: string, dedupeKey: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  const [claim] = await tx.insert(automationRuns).values({ orgId, rule, dedupeKey }).onConflictDoNothing().returning({ id: automationRuns.id });
  if (!claim) return { ran: false };
  const result = await fn();
  await tx.update(automationRuns).set({ result: result ?? null }).where(sql`${automationRuns.id} = ${claim.id}`);
  return { ran: true, result };
}
