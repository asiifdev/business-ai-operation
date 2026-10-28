import { and, asc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import type { Tx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { clients, deployments, findings, invoices, packages, products, subscriptions } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import { automationOnce } from '../automation/once';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { MAX_PRICE, who } from '../portfolio/shared';
import { addDays, addMonths, isValidDate, periodKey, todayIn } from './dates';
import { insertDraft, loadOrgBilling } from './invoices';

const dateField = z.string().refine(isValidDate, 'date');

export const subscriptionSchema = z.object({
  clientId: z.string().min(1),
  packageId: z.string().min(1),
  deploymentId: z.string().min(1).nullable().optional(),
  /** Left out, it is copied from the package price (BR-M02-11). A negotiated price is typed here. */
  amount: z.number().int().min(0).max(MAX_PRICE).optional(),
  intervalMonths: z.number().int().min(1).max(60).default(1),
  startedOn: dateField.optional(),
  nextDueDate: dateField.optional(),
  graceDays: z.number().int().min(0).max(365).nullable().optional(),
});

/** What may change after creation. A new amount only reaches the NEXT invoice (BR-M03-13). */
export const subscriptionPatchSchema = z.object({
  amount: z.number().int().min(0).max(MAX_PRICE).optional(),
  intervalMonths: z.number().int().min(1).max(60).optional(),
  graceDays: z.number().int().min(0).max(365).nullable().optional(),
});

export async function createSubscription(ctx: Ctx, raw: z.input<typeof subscriptionSchema>) {
  assertCan(ctx, 'billing.write');
  const input = subscriptionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const org = await loadOrgBilling(tx, ctx.orgId);
    const today = todayIn(org.timezone, ctx.clock.now());
    const [client] = await tx.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, input.clientId)));
    if (!client) throw new DomainError('not_found', 'client');
    if (client.archivedAt) throw new DomainError('invalid_state', 'archived client');
    const [pkg] = await tx.select().from(packages).where(and(eq(packages.orgId, ctx.orgId), eq(packages.id, input.packageId)));
    if (!pkg) throw new DomainError('not_found', 'package');
    if (pkg.archivedAt) throw new DomainError('invalid_state', 'archived package');
    if (input.deploymentId) {
      const [dep] = await tx.select().from(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.id, input.deploymentId)));
      if (!dep) throw new DomainError('not_found', 'deployment');
      if (dep.clientId !== input.clientId || dep.productId !== pkg.productId) throw new DomainError('validation', 'deployment does not match client and product');
    }
    const startedOn = input.startedOn ?? today;
    const [row] = await tx
      .insert(subscriptions)
      .values({
        orgId: ctx.orgId,
        clientId: input.clientId,
        productId: pkg.productId,
        packageId: pkg.id,
        deploymentId: input.deploymentId ?? null,
        amount: input.amount ?? pkg.monthlyPrice * input.intervalMonths,
        intervalMonths: input.intervalMonths,
        startedOn,
        nextDueDate: input.nextDueDate ?? startedOn,
        graceDays: input.graceDays ?? null,
      })
      .returning({ id: subscriptions.id });
    await recordAudit(tx, who(ctx), { action: 'subscription.created', entityType: 'subscription', entityId: row.id, summary: { clientId: input.clientId, packageId: pkg.id } });
    return { id: row.id };
  });
}

export async function updateSubscription(ctx: Ctx, id: string, raw: z.input<typeof subscriptionPatchSchema>) {
  assertCan(ctx, 'billing.write');
  const patch = subscriptionPatchSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.id, id))).for('update');
    if (!before) throw new DomainError('not_found', 'subscription');
    if (before.status !== 'active') throw new DomainError('invalid_state', 'a stopped subscription cannot change');
    await tx.update(subscriptions).set(patch).where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.id, id)));
    await recordAudit(tx, who(ctx), {
      action: 'subscription.updated',
      entityType: 'subscription',
      entityId: id,
      summary: { ...(patch.amount !== undefined ? { amount: { from: before.amount, to: patch.amount } } : {}), fields: Object.keys(patch) },
    });
  });
}

/** A stopped subscription makes no new invoices; the ones already made stay (BR-M03-14). */
export async function stopSubscription(ctx: Ctx, id: string) {
  assertCan(ctx, 'billing.write');
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.id, id))).for('update');
    if (!before) throw new DomainError('not_found', 'subscription');
    if (before.status === 'stopped') throw new DomainError('invalid_state', 'already stopped');
    const org = await loadOrgBilling(tx, ctx.orgId);
    await tx
      .update(subscriptions)
      .set({ status: 'stopped', stoppedOn: todayIn(org.timezone, ctx.clock.now()) })
      .where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.id, id)));
    await recordAudit(tx, who(ctx), { action: 'subscription.stopped', entityType: 'subscription', entityId: id, summary: { clientId: before.clientId } });
  });
}

/**
 * After an invoice is fully paid, moves the subscription's due date forward by one interval (BR-M03-07). It only moves
 * when the paid invoice is for the period the subscription is currently waiting on, so a late or manual invoice for an
 * older period can never push the date forward twice.
 */
export async function advanceAfterPayment(tx: Tx, audit: AuditWho, invoice: { subscriptionId: string | null; periodKey: string | null }) {
  if (!invoice.subscriptionId) return;
  const [sub] = await tx.select().from(subscriptions).where(and(eq(subscriptions.orgId, audit.orgId), eq(subscriptions.id, invoice.subscriptionId))).for('update');
  if (!sub || sub.status !== 'active' || invoice.periodKey !== periodKey(sub.nextDueDate)) return;
  const next = addMonths(sub.nextDueDate, sub.intervalMonths, Number(sub.startedOn.slice(8, 10)));
  await tx.update(subscriptions).set({ nextDueDate: next }).where(and(eq(subscriptions.orgId, audit.orgId), eq(subscriptions.id, sub.id)));
  await recordAudit(tx, audit, { action: 'subscription.advanced', entityType: 'subscription', entityId: sub.id, summary: { from: sub.nextDueDate, to: next } });
}

export interface SubscriptionRow {
  id: string;
  clientId: string;
  clientName: string;
  productName: string;
  packageName: string;
  amount: number;
  intervalMonths: number;
  nextDueDate: string;
  status: 'active' | 'stopped';
}

export async function listSubscriptions(ctx: Ctx, options: { status?: 'active' | 'stopped'; clientId?: string } = {}): Promise<SubscriptionRow[]> {
  assertCan(ctx, 'billing.read');
  return db
    .select({
      id: subscriptions.id,
      clientId: subscriptions.clientId,
      clientName: clients.name,
      productName: products.name,
      packageName: packages.name,
      amount: subscriptions.amount,
      intervalMonths: subscriptions.intervalMonths,
      nextDueDate: subscriptions.nextDueDate,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .innerJoin(clients, and(eq(clients.orgId, subscriptions.orgId), eq(clients.id, subscriptions.clientId)))
    .innerJoin(products, and(eq(products.orgId, subscriptions.orgId), eq(products.id, subscriptions.productId)))
    .innerJoin(packages, and(eq(packages.orgId, subscriptions.orgId), eq(packages.id, subscriptions.packageId)))
    .where(and(eq(subscriptions.orgId, ctx.orgId), options.status ? eq(subscriptions.status, options.status) : undefined, options.clientId ? eq(subscriptions.clientId, options.clientId) : undefined))
    .orderBy(asc(subscriptions.nextDueDate), asc(clients.nameKey));
}

export async function getSubscription(ctx: Ctx, id: string) {
  assertCan(ctx, 'billing.read');
  const [row] = (await listSubscriptions(ctx)).filter((s) => s.id === id);
  if (!row) throw new DomainError('not_found', 'subscription');
  const [full] = await db.select().from(subscriptions).where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.id, id)));
  const history = await db.select({ id: invoices.id, number: invoices.number, status: invoices.status, dueDate: invoices.dueDate, total: invoices.total }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.subscriptionId, id))).orderBy(asc(invoices.dueDate));
  return { subscription: row, graceDays: full.graceDays, startedOn: full.startedOn, stoppedOn: full.stoppedOn, invoices: history };
}

/**
 * `rule.renewal_draft` (BR-M03-09). For every active subscription due within the organization's offset and with no invoice
 * for that period yet, makes ONE draft. Safe to run twice: the unique index on (subscription, period) turns a second
 * attempt into a skipped row, so it never makes a duplicate. Each subscription runs in its own transaction, so one failure
 * cannot undo the others. Runs as the system, not as a person.
 */
export async function generateRenewalDrafts(orgId: string, now: Date): Promise<{ created: string[]; skipped: number }> {
  const org = await loadOrgBilling(db, orgId);
  const today = todayIn(org.timezone, now);
  const horizon = addDays(today, org.draftOffsetDays);
  const due = await db
    .select({ sub: subscriptions, product: products.name, pkg: packages.name })
    .from(subscriptions)
    .innerJoin(products, and(eq(products.orgId, subscriptions.orgId), eq(products.id, subscriptions.productId)))
    .innerJoin(packages, and(eq(packages.orgId, subscriptions.orgId), eq(packages.id, subscriptions.packageId)))
    .where(and(eq(subscriptions.orgId, orgId), eq(subscriptions.status, 'active'), lte(subscriptions.nextDueDate, horizon)))
    .orderBy(asc(subscriptions.nextDueDate));

  const audit: AuditWho = { orgId, actor: 'system:rule.renewal_draft' };
  const created: string[] = [];
  let skipped = 0;
  for (const { sub, product, pkg } of due) {
    if (sub.amount <= 0) {
      skipped++;
      continue;
    }
    try {
      const period = periodKey(sub.nextDueDate);
      await db.transaction(async (tx) => {
        // One draft per subscription and period, claimed through `automation.once` (PRD section 7). The unique index on
        // (subscription, period) stays underneath as the last line of defence.
        const claimed = await automationOnce(tx, orgId, 'renewal_draft', `renewal:${sub.id}:${period}`, async () => {
          const draft = await insertDraft(
            tx,
            audit,
            {
              clientId: sub.clientId,
              dueDate: sub.nextDueDate,
              subscriptionId: sub.id,
              periodKey: period,
              isAiDraft: true,
              createdBy: audit.actor,
              items: [{ description: `${product} - ${pkg} (${period})`, quantity: 1, unitPrice: sub.amount }],
            },
            org,
          );
          await recordAudit(tx, audit, { action: 'invoice.draft_generated', entityType: 'invoice', entityId: draft.id, summary: { subscriptionId: sub.id, period } });
          // The event M08 turns into a card: "a renewal draft is ready to review" (BRD-M03 section 9).
          await automationOnce(tx, orgId, 'invoice_draft_ready', `draftready:${draft.id}`, async () => {
            await tx.insert(findings).values({ orgId, rule: 'invoice_draft_ready', entityType: 'invoice', entityId: draft.id, periodKey: period }).onConflictDoNothing();
            return { invoiceId: draft.id };
          });
          return draft.id;
        });
        if (claimed.ran) created.push(claimed.result);
        else skipped++;
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'uq_invoices_period')) throw err;
      skipped++;
    }
  }
  return { created, skipped };
}
