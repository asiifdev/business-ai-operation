import { and, count, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client';
import { deployments, invoices, leads, subscriptions, tasks } from '../../db/schema';

const total = async (...queries: Promise<{ n: number }[]>[]) => (await Promise.all(queries)).reduce((sum, [row]) => sum + (row?.n ?? 0), 0);

/**
 * Whether a client or product has history that forbids deleting it (BR-M02-08): it can only be archived. History is its
 * deployments, subscriptions, invoices, tasks and the lead it came from. The one place to extend when another module
 * starts pointing at clients.
 */
export async function clientHasHistory(tx: Tx | Db, orgId: string, clientId: string): Promise<boolean> {
  return (
    (await total(
      tx.select({ n: count() }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.clientId, clientId))),
      tx.select({ n: count() }).from(subscriptions).where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.clientId, clientId))),
      tx.select({ n: count() }).from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.clientId, clientId))),
      tx.select({ n: count() }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.clientId, clientId))),
      tx.select({ n: count() }).from(leads).where(and(eq(leads.orgId, orgId), eq(leads.convertedClientId, clientId))),
    )) > 0
  );
}

export async function productHasHistory(tx: Tx | Db, orgId: string, productId: string): Promise<boolean> {
  return (
    (await total(
      tx.select({ n: count() }).from(deployments).where(and(eq(deployments.orgId, orgId), eq(deployments.productId, productId))),
      tx.select({ n: count() }).from(subscriptions).where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.productId, productId))),
      tx.select({ n: count() }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.productId, productId))),
    )) > 0
  );
}

/** A deployment that a subscription or a task points at cannot be deleted (it would orphan them). */
export async function deploymentIsBilled(tx: Tx | Db, orgId: string, deploymentId: string): Promise<boolean> {
  return (
    (await total(
      tx.select({ n: count() }).from(subscriptions).where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.deploymentId, deploymentId))),
      tx.select({ n: count() }).from(tasks).where(and(eq(tasks.orgId, orgId), eq(tasks.deploymentId, deploymentId))),
    )) > 0
  );
}
