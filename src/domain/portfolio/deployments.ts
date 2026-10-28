import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { clients, deployments, products } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { versionState, type VersionState } from './semver';
import { duplicate, optionalText, who } from './shared';

/**
 * A host name only. A pasted `https://user:pass@host/path` is refused rather than trimmed, because deployments must never
 * carry credentials or secrets (BR-M02-07).
 */
const HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const domainField = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((v) => v === '' || HOST.test(v) || v === 'localhost', 'enter a host name such as app.example.com, without https://, a path or a login')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const environmentField = z.string().trim().toLowerCase().min(2).max(30).regex(/^[a-z0-9][a-z0-9 _-]*$/, 'use letters, digits, space, - or _');

const deploymentFields = z.object({
  productId: z.string().min(1),
  clientId: z.string().min(1),
  environment: environmentField.default('production'),
  label: optionalText(120),
  domain: domainField,
  installedVersion: optionalText(40),
  status: z.enum(['active', 'inactive']).default('active'),
});
export const deploymentSchema = deploymentFields;
export const deploymentPatchSchema = deploymentFields.omit({ productId: true, clientId: true }).partial();

const DUPLICATE_MESSAGE = 'this client already has this product in this environment';

export async function createDeployment(ctx: Ctx, raw: z.input<typeof deploymentSchema>) {
  assertCan(ctx, 'deployment.write');
  const input = deploymentSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [product] = await tx.select().from(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, input.productId)));
      const [client] = await tx.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, input.clientId)));
      if (!product || !client) throw new DomainError('not_found', 'product or client');
      if (product.archivedAt || client.archivedAt) throw new DomainError('invalid_state', 'archived product or client');
      const [row] = await tx
        .insert(deployments)
        .values({
          orgId: ctx.orgId,
          productId: input.productId,
          clientId: input.clientId,
          environment: input.environment,
          label: input.label ?? null,
          domain: input.domain ?? null,
          installedVersion: input.installedVersion ?? null,
          status: input.status,
        })
        .returning({ id: deployments.id });
      await recordAudit(tx, who(ctx), {
        action: 'deployment.created',
        entityType: 'deployment',
        entityId: row.id,
        summary: { clientId: input.clientId, productId: input.productId, environment: input.environment, installedVersion: input.installedVersion ?? null },
      });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_deployments_slot')) duplicate(DUPLICATE_MESSAGE);
    throw err;
  }
}

export async function updateDeployment(ctx: Ctx, id: string, raw: z.input<typeof deploymentPatchSchema>) {
  assertCan(ctx, 'deployment.write');
  const patch = deploymentPatchSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, id)));
      if (!before) throw new DomainError('not_found', 'deployment');
      const set: Partial<typeof deployments.$inferInsert> = {};
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['environment', 'label', 'domain', 'installedVersion', 'status'] as const) {
        if (patch[key] !== undefined && patch[key] !== before[key]) {
          set[key] = patch[key] as never;
          changed[key] = { from: before[key], to: patch[key] };
        }
      }
      if (Object.keys(set).length === 0) return;
      await tx.update(deployments).set(set).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, id)));
      await recordAudit(tx, who(ctx), { action: 'deployment.updated', entityType: 'deployment', entityId: id, summary: { clientId: before.clientId, productId: before.productId, ...changed } });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_deployments_slot')) duplicate(DUPLICATE_MESSAGE);
    throw err;
  }
}

/** Removing a deployment is for managers; staff can set it inactive instead. M03 will refuse it while a subscription uses it. */
export async function deleteDeployment(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, id)));
    if (!row) throw new DomainError('not_found', 'deployment');
    await tx.delete(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, id)));
    await recordAudit(tx, who(ctx), { action: 'deployment.deleted', entityType: 'deployment', entityId: id, summary: { clientId: row.clientId, productId: row.productId, environment: row.environment } });
  });
}

export interface DeploymentRow {
  id: string;
  clientId: string;
  clientName: string;
  productId: string;
  productName: string;
  environment: string;
  label: string | null;
  domain: string | null;
  installedVersion: string | null;
  productVersion: string | null;
  status: 'active' | 'inactive';
  versionState: VersionState;
}

/** Deployments with the derived "behind" state (BR-M02-05): computed on read, never stored. */
export async function listDeployments(ctx: Ctx, filter: { clientId?: string; productId?: string; behindOnly?: boolean } = {}): Promise<DeploymentRow[]> {
  assertCan(ctx, 'catalog.read');
  const rows = await db
    .select({
      id: deployments.id,
      clientId: deployments.clientId,
      clientName: clients.name,
      productId: deployments.productId,
      productName: products.name,
      environment: deployments.environment,
      label: deployments.label,
      domain: deployments.domain,
      installedVersion: deployments.installedVersion,
      productVersion: products.currentVersion,
      status: deployments.status,
    })
    .from(deployments)
    .innerJoin(clients, and(eq(clients.orgId, deployments.orgId), eq(clients.id, deployments.clientId)))
    .innerJoin(products, and(eq(products.orgId, deployments.orgId), eq(products.id, deployments.productId)))
    .where(and(eq(deployments.orgId, ctx.orgId), filter.clientId ? eq(deployments.clientId, filter.clientId) : undefined, filter.productId ? eq(deployments.productId, filter.productId) : undefined))
    .orderBy(asc(sql`lower(${clients.name})`), asc(sql`lower(${products.name})`), asc(deployments.environment));
  const withState = rows.map((r) => ({ ...r, versionState: versionState(r.installedVersion, r.productVersion) }));
  return filter.behindOnly ? withState.filter((r) => r.versionState === 'behind' && r.status === 'active') : withState;
}
