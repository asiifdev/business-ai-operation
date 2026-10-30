import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { auditLog, clients, deployments, products } from '../../db/schema';
import { listInvoices, type InvoiceRow } from '../billing/invoices';
import { listSubscriptions, type SubscriptionRow } from '../billing/subscriptions';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { clientHasHistory } from './history';
import { versionState, type VersionState } from './semver';
import { duplicate, nameField, nameKey, optionalText, who } from './shared';

const clientFields = z.object({
  name: nameField,
  contactName: optionalText(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((v) => (v === '' ? null : v))
    .pipe(z.string().email().nullable())
    .optional(),
  phone: optionalText(40),
  address: optionalText(500),
  notes: optionalText(4000),
});
export const clientSchema = clientFields;
export const clientPatchSchema = clientFields.partial();

const DUPLICATE_MESSAGE = 'a client with this name already exists';

async function loadClient(tx: Pick<typeof db, 'select'>, orgId: string, id: string) {
  const [row] = await tx.select().from(clients).where(and(eq(clients.orgId, orgId), eq(clients.id, id)));
  if (!row) throw new DomainError('not_found', 'client');
  return row;
}

/** Staff may add and edit clients; archiving and deleting are for managers (BRD-M02 §2). */
export async function createClient(ctx: Ctx, raw: z.input<typeof clientSchema>) {
  assertCan(ctx, 'client.write');
  const input = clientSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(clients)
        .values({
          orgId: ctx.orgId,
          name: input.name,
          nameKey: nameKey(input.name),
          contactName: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          notes: input.notes ?? null,
        })
        .returning({ id: clients.id });
      await recordAudit(tx, who(ctx), { action: 'client.created', entityType: 'client', entityId: row.id, summary: { name: input.name } });
      return { id: row.id };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_clients_name_key')) duplicate(DUPLICATE_MESSAGE);
    throw err;
  }
}

export async function updateClient(ctx: Ctx, id: string, raw: z.input<typeof clientPatchSchema>) {
  assertCan(ctx, 'client.write');
  const patch = clientPatchSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const before = await loadClient(tx, ctx.orgId, id);
      if (before.archivedAt) throw new DomainError('invalid_state', 'archived client');
      const set: Partial<typeof clients.$inferInsert> = {};
      const changed: Record<string, true> = {};
      for (const key of ['name', 'contactName', 'email', 'phone', 'address', 'notes'] as const) {
        if (patch[key] !== undefined && patch[key] !== before[key]) {
          set[key] = patch[key] as never;
          changed[key] = true;
        }
      }
      if (patch.name !== undefined) set.nameKey = nameKey(patch.name);
      if (Object.keys(changed).length === 0) return;
      await tx.update(clients).set(set).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, id)));
      // Which fields changed, never their values: contact details and notes are personal data (BR-M15-06).
      await recordAudit(tx, who(ctx), { action: 'client.updated', entityType: 'client', entityId: id, summary: { fields: Object.keys(changed), ...(changed.name ? { name: patch.name } : {}) } });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_clients_name_key')) duplicate(DUPLICATE_MESSAGE);
    throw err;
  }
}

export async function setClientArchived(ctx: Ctx, id: string, archived: boolean) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const row = await loadClient(tx, ctx.orgId, id);
    if (Boolean(row.archivedAt) === archived) return;
    await tx.update(clients).set({ archivedAt: archived ? ctx.clock.now() : null }).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, id)));
    await recordAudit(tx, who(ctx), { action: archived ? 'client.archived' : 'client.unarchived', entityType: 'client', entityId: id, summary: { name: row.name } });
  });
}

/** Only a client with no history can be deleted (BR-M02-08). Anything else must be archived. */
export async function deleteClient(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.archive');
  await db.transaction(async (tx) => {
    const row = await loadClient(tx, ctx.orgId, id);
    if (await clientHasHistory(tx, ctx.orgId, id)) throw new DomainError('invalid_state', 'this client has history: archive it instead');
    await tx.delete(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, id)));
    await recordAudit(tx, who(ctx), { action: 'client.deleted', entityType: 'client', entityId: id, summary: { name: row.name } });
  });
}

export interface ClientRow {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  archivedAt: Date | null;
  deploymentCount: number;
  behindCount: number;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listClients(ctx: Ctx, options: { q?: string; includeArchived?: boolean } = {}): Promise<ClientRow[]> {
  assertCan(ctx, 'catalog.read');
  const q = options.q?.trim();
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      contactName: clients.contactName,
      email: clients.email,
      archivedAt: clients.archivedAt,
      deploymentCount: sql<number>`(select count(*) from ${deployments} where ${deployments.clientId} = "clients"."id")::int`,
    })
    .from(clients)
    .where(
      and(
        eq(clients.orgId, ctx.orgId),
        options.includeArchived ? undefined : isNull(clients.archivedAt),
        like ? or(ilike(clients.name, like), ilike(clients.contactName, like), ilike(clients.email, like)) : undefined,
      ),
    )
    .orderBy(asc(clients.nameKey));
  const installed = await db
    .select({ clientId: deployments.clientId, version: deployments.installedVersion, current: products.currentVersion })
    .from(deployments)
    .innerJoin(products, and(eq(products.orgId, deployments.orgId), eq(products.id, deployments.productId)))
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.status, 'active')));
  const behind = new Map<string, number>();
  for (const d of installed) if (versionState(d.version, d.current) === 'behind') behind.set(d.clientId, (behind.get(d.clientId) ?? 0) + 1);
  return rows.map((r) => ({ ...r, behindCount: behind.get(r.id) ?? 0 }));
}

export interface ClientDeploymentRow {
  id: string;
  productId: string;
  productName: string;
  productVersion: string | null;
  environment: string;
  label: string | null;
  domain: string | null;
  installedVersion: string | null;
  status: 'active' | 'inactive';
  versionState: VersionState;
  /** M17 readings, null until checked. */
  behindBy: number | null;
  uptimeState: 'up' | 'down' | null;
}

export interface TimelineEntry {
  id: string;
  at: Date;
  action: string;
  actor: 'user' | 'ai' | 'system';
}

/**
 * The 360 degree view of one client (BRD-M02). Today it holds the client, its deployments and its change history.
 * Subscriptions and invoices (for those who may read billing) are in; tasks and leads join as M04 and M05 are built. The
 * change history follows `audit.read`.
 */
export async function getClient360(ctx: Ctx, id: string) {
  assertCan(ctx, 'catalog.read');
  const client = await loadClient(db, ctx.orgId, id);
  const rows = await db
    .select({
      id: deployments.id,
      productId: deployments.productId,
      productName: products.name,
      productVersion: products.currentVersion,
      environment: deployments.environment,
      label: deployments.label,
      domain: deployments.domain,
      installedVersion: deployments.installedVersion,
      status: deployments.status,
      behindBy: deployments.behindBy,
      uptimeState: deployments.uptimeState,
    })
    .from(deployments)
    .innerJoin(products, and(eq(products.orgId, deployments.orgId), eq(products.id, deployments.productId)))
    .where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.clientId, id)))
    .orderBy(asc(sql`lower(${products.name})`), asc(deployments.environment));

  let timeline: TimelineEntry[] | null = null;
  if (can(ctx.role, 'audit.read')) {
    const entries = await db
      .select({ id: auditLog.id, at: auditLog.createdAt, action: auditLog.action, actor: auditLog.actor })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.orgId, ctx.orgId),
          or(and(eq(auditLog.entityType, 'client'), eq(auditLog.entityId, id)), and(eq(auditLog.entityType, 'deployment'), sql`${auditLog.summary}->>'clientId' = ${id}`)),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(30);
    timeline = entries.map((e) => ({ id: e.id, at: e.at, action: e.action, actor: e.actor.startsWith('ai:') ? 'ai' : e.actor.startsWith('system:') ? 'system' : 'user' }));
  }
  const billing: { subscriptions: SubscriptionRow[]; invoices: InvoiceRow[] } | null = can(ctx.role, 'billing.read')
    ? { subscriptions: await listSubscriptions(ctx, { clientId: id }), invoices: (await listInvoices(ctx, { clientId: id })).slice(0, 10) }
    : null;
  return {
    client,
    deployments: rows.map((d) => ({ ...d, versionState: versionState(d.installedVersion, d.productVersion) })) as ClientDeploymentRow[],
    billing,
    timeline,
  };
}
