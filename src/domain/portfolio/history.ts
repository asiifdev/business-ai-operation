import { and, count, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { deployments } from '../../db/schema';

/**
 * Whether a client or product has history that forbids deleting it (BR-M02-08): it can only be archived. Today that is
 * its deployments. M03 (billing) MUST add subscriptions and invoices here, in this one place, when those tables exist.
 */
export async function clientHasHistory(tx: Tx | Db, orgId: string, clientId: string): Promise<boolean> {
  const [row] = await tx.select({ n: count() }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.clientId, clientId)));
  return (row?.n ?? 0) > 0;
}

export async function productHasHistory(tx: Tx | Db, orgId: string, productId: string): Promise<boolean> {
  const [row] = await tx.select({ n: count() }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.productId, productId)));
  return (row?.n ?? 0) > 0;
}
