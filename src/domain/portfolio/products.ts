import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { clients, deployments, packages, products } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { productHasHistory } from './history';
import { versionState } from './semver';
import { duplicate, MAX_PRICE, nameField, optionalText, tidyName, who } from './shared';

const productFields = z.object({ name: nameField, description: optionalText(2000), currentVersion: optionalText(40) });
export const productSchema = productFields;
export const productPatchSchema = productFields.partial();

const packageFields = z.object({
  name: nameField,
  /** Whole Rupiah (CR-04): a fraction or a negative amount is refused. */
  monthlyPrice: z.number().int().min(0).max(MAX_PRICE),
  features: optionalText(2000),
});
export const packageSchema = packageFields;
export const packagePatchSchema = packageFields.partial();

async function loadProduct(tx: Pick<typeof db, 'select'>, orgId: string, id: string) {
  const [row] = await tx.select().from(products).where(and(eq(products.orgId, orgId), eq(products.id, id)));
  if (!row) throw new DomainError('not_found', 'product');
  return row;
}

export async function createProduct(ctx: Ctx, raw: z.input<typeof productSchema>) {
  assertCan(ctx, 'catalog.write');
  const input = productSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(products)
        .values({ orgId: ctx.orgId, name: input.name, description: input.description ?? null, currentVersion: input.currentVersion ?? null })
        .returning({ id: products.id });
      await recordAudit(tx, who(ctx), { action: 'product.created', entityType: 'product', entityId: row.id, summary: { name: input.name, currentVersion: input.currentVersion ?? null } });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_products_name_active')) duplicate('a product with this name already exists');
    throw err;
  }
}

export async function updateProduct(ctx: Ctx, id: string, raw: z.input<typeof productPatchSchema>) {
  assertCan(ctx, 'catalog.write');
  const patch = productPatchSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const before = await loadProduct(tx, ctx.orgId, id);
      if (before.archivedAt) throw new DomainError('invalid_state', 'archived product');
      const set: Partial<typeof products.$inferInsert> = {};
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['name', 'description', 'currentVersion'] as const) {
        if (patch[key] !== undefined && patch[key] !== before[key]) {
          set[key] = patch[key] as never;
          changed[key] = { from: before[key], to: patch[key] };
        }
      }
      if (Object.keys(set).length === 0) return;
      await tx.update(products).set(set).where(and(eq(products.orgId, ctx.orgId), eq(products.id, id)));
      await recordAudit(tx, who(ctx), { action: 'product.updated', entityType: 'product', entityId: id, summary: changed });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_products_name_active')) duplicate('a product with this name already exists');
    throw err;
  }
}

/** Products are archived, not erased: they keep their packages and deployments. A product with no history may be deleted. */
export async function archiveProduct(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const row = await loadProduct(tx, ctx.orgId, id);
    if (row.archivedAt) return;
    await tx.update(products).set({ archivedAt: ctx.clock.now() }).where(and(eq(products.orgId, ctx.orgId), eq(products.id, id)));
    await recordAudit(tx, who(ctx), { action: 'product.archived', entityType: 'product', entityId: id, summary: { name: row.name } });
  });
}

export async function unarchiveProduct(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.archive');
  try {
    await db.transaction(async (tx) => {
      const row = await loadProduct(tx, ctx.orgId, id);
      if (!row.archivedAt) return;
      await tx.update(products).set({ archivedAt: null }).where(and(eq(products.orgId, ctx.orgId), eq(products.id, id)));
      await recordAudit(tx, who(ctx), { action: 'product.unarchived', entityType: 'product', entityId: id, summary: { name: row.name } });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_products_name_active')) duplicate('another active product already has this name');
    throw err;
  }
}

export async function deleteProduct(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const row = await loadProduct(tx, ctx.orgId, id);
    if (await productHasHistory(tx, ctx.orgId, id)) throw new DomainError('invalid_state', 'this product has history: archive it instead');
    await tx.delete(packages).where(and(eq(packages.orgId, ctx.orgId), eq(packages.productId, id)));
    await tx.delete(products).where(and(eq(products.orgId, ctx.orgId), eq(products.id, id)));
    await recordAudit(tx, who(ctx), { action: 'product.deleted', entityType: 'product', entityId: id, summary: { name: row.name } });
  });
}

export interface ProductRow {
  id: string;
  name: string;
  description: string | null;
  currentVersion: string | null;
  archivedAt: Date | null;
  packageCount: number;
  deploymentCount: number;
  behindCount: number;
}

export async function listProducts(ctx: Ctx, options: { includeArchived?: boolean } = {}): Promise<ProductRow[]> {
  assertCan(ctx, 'catalog.read');
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      description: products.description,
      currentVersion: products.currentVersion,
      archivedAt: products.archivedAt,
      // Drizzle drops the table prefix in single-table selects, so the outer id is written out to correlate the subquery.
      packageCount: sql<number>`(select count(*) from ${packages} where ${packages.productId} = "products"."id" and ${packages.archivedAt} is null)::int`,
      deploymentCount: sql<number>`(select count(*) from ${deployments} where ${deployments.productId} = "products"."id")::int`,
    })
    .from(products)
    .where(and(eq(products.orgId, ctx.orgId), options.includeArchived ? undefined : isNull(products.archivedAt)))
    .orderBy(asc(sql`lower(${products.name})`));
  const installed = await db.select({ productId: deployments.productId, version: deployments.installedVersion }).from(deployments).where(eq(deployments.orgId, ctx.orgId));
  const current = new Map(rows.map((r) => [r.id, r.currentVersion]));
  const behind = new Map<string, number>();
  for (const d of installed) if (versionState(d.version, current.get(d.productId)) === 'behind') behind.set(d.productId, (behind.get(d.productId) ?? 0) + 1);
  return rows.map((r) => ({ ...r, behindCount: behind.get(r.id) ?? 0 }));
}

export interface PackageRow {
  id: string;
  name: string;
  monthlyPrice: number;
  features: string | null;
  archivedAt: Date | null;
}

export interface ProductDeploymentRow {
  id: string;
  clientId: string;
  clientName: string;
  environment: string;
  label: string | null;
  domain: string | null;
  installedVersion: string | null;
  status: 'active' | 'inactive';
  versionState: ReturnType<typeof versionState>;
}

export async function getProduct(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.read');
  const product = await loadProduct(db, ctx.orgId, id);
  const packageRows = await db
    .select({ id: packages.id, name: packages.name, monthlyPrice: packages.monthlyPrice, features: packages.features, archivedAt: packages.archivedAt })
    .from(packages)
    .where(and(eq(packages.orgId, ctx.orgId), eq(packages.productId, id)))
    .orderBy(asc(sql`${packages.archivedAt} is not null`), asc(packages.monthlyPrice));
  const deploymentRows = await db
    .select({ id: deployments.id, clientId: deployments.clientId, clientName: clients.name, environment: deployments.environment, label: deployments.label, domain: deployments.domain, installedVersion: deployments.installedVersion, status: deployments.status })
    .from(deployments)
    .innerJoin(clients, and(eq(clients.orgId, deployments.orgId), eq(clients.id, deployments.clientId)))
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.productId, id)))
    .orderBy(asc(sql`lower(${clients.name})`), asc(deployments.environment));
  return {
    product,
    packages: packageRows as PackageRow[],
    deployments: deploymentRows.map((d) => ({ ...d, versionState: versionState(d.installedVersion, product.currentVersion) })) as ProductDeploymentRow[],
  };
}

export async function createPackage(ctx: Ctx, productId: string, raw: z.input<typeof packageSchema>) {
  assertCan(ctx, 'catalog.write');
  const input = packageSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const product = await loadProduct(tx, ctx.orgId, productId);
      if (product.archivedAt) throw new DomainError('invalid_state', 'archived product');
      const [row] = await tx
        .insert(packages)
        .values({ orgId: ctx.orgId, productId, name: input.name, monthlyPrice: input.monthlyPrice, features: input.features ?? null })
        .returning({ id: packages.id });
      await recordAudit(tx, who(ctx), { action: 'package.created', entityType: 'package', entityId: row.id, summary: { productId, name: input.name, monthlyPrice: input.monthlyPrice } });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_packages_name')) duplicate('this product already has a package with this name');
    throw err;
  }
}

/**
 * Changing a price only changes the catalogue. Subscriptions and invoices keep the amount they copied when they were
 * created (BR-M02-11), so nothing outside this table is touched here.
 */
export async function updatePackage(ctx: Ctx, id: string, raw: z.input<typeof packagePatchSchema>) {
  assertCan(ctx, 'catalog.write');
  const patch = packagePatchSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(packages).where(and(eq(packages.orgId, ctx.orgId), eq(packages.id, id)));
      if (!before) throw new DomainError('not_found', 'package');
      if (before.archivedAt) throw new DomainError('invalid_state', 'archived package');
      const set: Partial<typeof packages.$inferInsert> = {};
      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of ['name', 'monthlyPrice', 'features'] as const) {
        if (patch[key] !== undefined && patch[key] !== before[key]) {
          set[key] = patch[key] as never;
          changed[key] = { from: before[key], to: patch[key] };
        }
      }
      if (Object.keys(set).length === 0) return;
      await tx.update(packages).set(set).where(and(eq(packages.orgId, ctx.orgId), eq(packages.id, id)));
      await recordAudit(tx, who(ctx), { action: 'package.updated', entityType: 'package', entityId: id, summary: { productId: before.productId, ...changed } });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_packages_name')) duplicate('this product already has a package with this name');
    throw err;
  }
}

export async function setPackageArchived(ctx: Ctx, id: string, archived: boolean) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(packages).where(and(eq(packages.orgId, ctx.orgId), eq(packages.id, id)));
    if (!row) throw new DomainError('not_found', 'package');
    if (Boolean(row.archivedAt) === archived) return;
    await tx.update(packages).set({ archivedAt: archived ? ctx.clock.now() : null }).where(and(eq(packages.orgId, ctx.orgId), eq(packages.id, id)));
    await recordAudit(tx, who(ctx), { action: archived ? 'package.archived' : 'package.unarchived', entityType: 'package', entityId: id, summary: { productId: row.productId, name: tidyName(row.name) } });
  });
}
