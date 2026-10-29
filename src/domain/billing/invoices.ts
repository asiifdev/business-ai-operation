import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import type { Tx } from '../../db/client';
import { auditLog, clients, invoiceItems, invoices, numberCounters, organizations, packages, payments, products } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan, can } from '../permissions';
import { MAX_PRICE, optionalText, who } from '../portfolio/shared';
import { isValidDate, periodKey, todayIn } from './dates';
import { deriveInvoice, netPaid } from './derived';
import { calculateTotals } from './money';

const dateField = z.string().refine(isValidDate, 'date');

export const itemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().int().min(1).max(100_000),
  unitPrice: z.number().int().min(0).max(MAX_PRICE),
});

export const invoiceSchema = z.object({
  clientId: z.string().min(1),
  dueDate: dateField,
  notes: optionalText(2000),
  items: z.array(itemSchema).min(1).max(50),
});
export const invoicePatchSchema = invoiceSchema.omit({ clientId: true }).partial();

const voidSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export interface OrgBilling {
  timezone: string;
  taxRateBps: number;
  numberFormat: string;
  draftOffsetDays: number;
}

export async function loadOrgBilling(tx: Pick<Tx, 'select'>, orgId: string): Promise<OrgBilling> {
  const [org] = await tx
    .select({ timezone: organizations.timezone, taxRateBps: organizations.taxRateBps, numberFormat: organizations.invoiceNumberFormat, draftOffsetDays: organizations.draftOffsetDays })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!org) throw new DomainError('not_found', 'organization');
  return org;
}

interface DraftSource {
  clientId: string;
  dueDate: string;
  notes?: string | null;
  items: z.infer<typeof itemSchema>[];
  subscriptionId?: string;
  periodKey?: string;
  isAiDraft?: boolean;
  createdBy: string;
}

/** Shared by the manual form and the renewal scheduler, so both go through `calculateTotals` and the same checks. */
export async function insertDraft(tx: Tx, audit: AuditWho, source: DraftSource, org: OrgBilling): Promise<{ id: string; total: number }> {
  const [client] = await tx.select({ id: clients.id, archivedAt: clients.archivedAt }).from(clients).where(and(eq(clients.orgId, audit.orgId), eq(clients.id, source.clientId)));
  if (!client) throw new DomainError('not_found', 'client');
  if (client.archivedAt) throw new DomainError('invalid_state', 'archived client');
  const totals = calculateTotals(source.items, org.taxRateBps);
  const [row] = await tx
    .insert(invoices)
    .values({
      orgId: audit.orgId,
      clientId: source.clientId,
      subscriptionId: source.subscriptionId ?? null,
      periodKey: source.periodKey ?? null,
      dueDate: source.dueDate,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      taxRateBps: org.taxRateBps,
      notes: source.notes ?? null,
      isAiDraft: source.isAiDraft ?? false,
      createdBy: source.createdBy,
    })
    .returning({ id: invoices.id });
  await tx.insert(invoiceItems).values(totals.lines.map((l, i) => ({ orgId: audit.orgId, invoiceId: row.id, position: i + 1, ...l })));
  return { id: row.id, total: totals.total };
}

export async function createInvoiceDraft(ctx: Ctx, raw: z.input<typeof invoiceSchema>) {
  assertCan(ctx, 'billing.write');
  const input = invoiceSchema.parse(raw);
  return db.transaction(async (tx) => {
    const org = await loadOrgBilling(tx, ctx.orgId);
    // A draft an AI run made is flagged until a person has opened and saved it, like the scheduler's (BR-M03-04).
    const draft = await insertDraft(tx, who(ctx), { ...input, createdBy: ctx.actor, isAiDraft: ctx.actor.startsWith('ai:') }, org);
    await recordAudit(tx, who(ctx), { action: 'invoice.draft_created', entityType: 'invoice', entityId: draft.id, summary: { clientId: input.clientId, total: draft.total } });
    return { id: draft.id };
  });
}

/** Locks the row so two people (or a person and the scheduler) cannot move one invoice at the same moment. */
async function lockInvoice(tx: Tx, orgId: string, id: string) {
  const [row] = await tx.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.id, id))).for('update');
  if (!row) throw new DomainError('not_found', 'invoice');
  return row;
}

/** Only a draft can be edited (BR-M03-04). Saving counts as a human review, so the "not reviewed" flag clears. */
export async function updateInvoiceDraft(ctx: Ctx, id: string, raw: z.input<typeof invoicePatchSchema>) {
  assertCan(ctx, 'billing.write');
  const patch = invoicePatchSchema.parse(raw);
  await db.transaction(async (tx) => {
    const before = await lockInvoice(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be edited');
    const set: Partial<typeof invoices.$inferInsert> = { isAiDraft: false };
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.items !== undefined) {
      const org = await loadOrgBilling(tx, ctx.orgId);
      const totals = calculateTotals(patch.items, org.taxRateBps);
      await tx.delete(invoiceItems).where(and(eq(invoiceItems.orgId, ctx.orgId), eq(invoiceItems.invoiceId, id)));
      await tx.insert(invoiceItems).values(totals.lines.map((l, i) => ({ orgId: ctx.orgId, invoiceId: id, position: i + 1, ...l })));
      Object.assign(set, { subtotal: totals.subtotal, taxAmount: totals.taxAmount, total: totals.total, taxRateBps: org.taxRateBps });
    }
    await tx.update(invoices).set(set).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, id)));
    await recordAudit(tx, who(ctx), { action: 'invoice.draft_updated', entityType: 'invoice', entityId: id, summary: { fields: Object.keys(patch) } });
  });
}

/** `INV-{YYYY}-{NNNN}`: `{YYYY}` is the year, and the number of Ns is the zero-padding width. */
export function formatInvoiceNumber(format: string, year: number, value: number): string {
  return format.replace('{YYYY}', String(year)).replace(/\{(N+)\}/, (_m, ns: string) => String(value).padStart(ns.length, '0'));
}

/** Next number for (organization, scope). One statement, so concurrent senders get different numbers (BR-M03-05). */
export async function nextNumber(tx: Tx, orgId: string, scope: string): Promise<number> {
  const [row] = await tx
    .insert(numberCounters)
    .values({ orgId, scope, lastValue: 1 })
    .onConflictDoUpdate({ target: [numberCounters.orgId, numberCounters.scope], set: { lastValue: sql`${numberCounters.lastValue} + 1` } })
    .returning({ value: numberCounters.lastValue });
  return row.value;
}

/** Draft to Sent: gives the number, the issue date, and from here on the content is locked (BR-M03-04, -05). */
export async function markInvoiceSent(ctx: Ctx, id: string) {
  assertCan(ctx, 'billing.write');
  return db.transaction(async (tx) => {
    const before = await lockInvoice(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be sent');
    if (before.total <= 0) throw new DomainError('validation', 'an invoice with no amount cannot be sent');
    const org = await loadOrgBilling(tx, ctx.orgId);
    const issueDate = todayIn(org.timezone, ctx.clock.now());
    const year = Number(issueDate.slice(0, 4));
    const number = formatInvoiceNumber(org.numberFormat, year, await nextNumber(tx, ctx.orgId, `invoice:${year}`));
    await tx
      .update(invoices)
      .set({ status: 'sent', number, issueDate, sentAt: ctx.clock.now(), isAiDraft: false })
      .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, id)));
    await recordAudit(tx, who(ctx), { action: 'invoice.sent', entityType: 'invoice', entityId: id, summary: { number, total: before.total } });
    return { id, number };
  });
}

/** Draft or Sent to Void. Money already received must be corrected first, so no payment is left pointing at a void invoice. */
export async function cancelInvoice(ctx: Ctx, id: string, raw: z.input<typeof voidSchema>) {
  assertCan(ctx, 'billing.write');
  const { reason } = voidSchema.parse(raw);
  await db.transaction(async (tx) => {
    const before = await lockInvoice(tx, ctx.orgId, id);
    if (before.status !== 'draft' && before.status !== 'sent') throw new DomainError('invalid_state', `a ${before.status} invoice cannot be cancelled`);
    const rows = await tx.select({ kind: payments.kind, amount: payments.amount }).from(payments).where(and(eq(payments.orgId, ctx.orgId), eq(payments.invoiceId, id)));
    if (netPaid(rows) > 0) throw new DomainError('invalid_state', 'payments were recorded: correct them first');
    await tx
      .update(invoices)
      .set({ status: 'void', voidedAt: ctx.clock.now(), voidReason: reason })
      .where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, id)));
    await recordAudit(tx, who(ctx), { action: 'invoice.cancelled', entityType: 'invoice', entityId: id, summary: { number: before.number, reason } });
  });
}

/** A draft that was never sent can be thrown away. Anything else is cancelled instead (the database refuses to delete it). */
export async function deleteInvoiceDraft(ctx: Ctx, id: string) {
  assertCan(ctx, 'billing.write');
  await db.transaction(async (tx) => {
    const before = await lockInvoice(tx, ctx.orgId, id);
    if (before.status !== 'draft') throw new DomainError('invalid_state', 'only a draft can be deleted');
    await tx.delete(invoiceItems).where(and(eq(invoiceItems.orgId, ctx.orgId), eq(invoiceItems.invoiceId, id)));
    await tx.delete(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, id)));
    await recordAudit(tx, who(ctx), { action: 'invoice.draft_deleted', entityType: 'invoice', entityId: id, summary: { clientId: before.clientId } });
  });
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  status: 'draft' | 'sent' | 'paid' | 'void';
  clientId: string;
  clientName: string;
  dueDate: string;
  issueDate: string | null;
  total: number;
  isAiDraft: boolean;
  subscriptionId: string | null;
  paid: number;
  balance: number;
  overdue: boolean;
  daysOverdue: number;
}

const paidSql = sql<number>`coalesce((select sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end) from ${payments} where ${payments.invoiceId} = "invoices"."id" and ${payments.orgId} = "invoices"."org_id"), 0)::bigint`.mapWith(Number);

export async function listInvoices(ctx: Ctx, options: { status?: InvoiceRow['status']; overdue?: boolean; clientId?: string } = {}): Promise<InvoiceRow[]> {
  assertCan(ctx, 'billing.read');
  const org = await loadOrgBilling(db, ctx.orgId);
  const today = todayIn(org.timezone, ctx.clock.now());
  const rows = await db
    .select({
      id: invoices.id,
      number: invoices.number,
      status: invoices.status,
      clientId: invoices.clientId,
      clientName: clients.name,
      dueDate: invoices.dueDate,
      issueDate: invoices.issueDate,
      total: invoices.total,
      isAiDraft: invoices.isAiDraft,
      subscriptionId: invoices.subscriptionId,
      paid: paidSql,
    })
    .from(invoices)
    .innerJoin(clients, and(eq(clients.orgId, invoices.orgId), eq(clients.id, invoices.clientId)))
    .where(
      and(
        eq(invoices.orgId, ctx.orgId),
        options.status ? eq(invoices.status, options.status) : undefined,
        options.clientId ? eq(invoices.clientId, options.clientId) : undefined,
        options.overdue ? and(eq(invoices.status, 'sent'), sql`${invoices.dueDate} < ${today}`) : undefined,
      ),
    )
    .orderBy(desc(invoices.createdAt));
  return rows.map((r) => ({ ...r, ...deriveInvoice(r, r.paid, today) }));
}

export async function getInvoice(ctx: Ctx, id: string) {
  assertCan(ctx, 'billing.read');
  const org = await loadOrgBilling(db, ctx.orgId);
  const today = todayIn(org.timezone, ctx.clock.now());
  const [invoice] = await db.select().from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, id)));
  if (!invoice) throw new DomainError('not_found', 'invoice');
  const [client] = await db.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, invoice.clientId)));
  const items = await db.select().from(invoiceItems).where(and(eq(invoiceItems.orgId, ctx.orgId), eq(invoiceItems.invoiceId, id))).orderBy(asc(invoiceItems.position));
  const paymentRows = await db.select().from(payments).where(and(eq(payments.orgId, ctx.orgId), eq(payments.invoiceId, id))).orderBy(asc(payments.createdAt));
  // What happened to this invoice, newest first: the same trail the audit page reads, for those who may read it.
  const timeline = can(ctx.role, 'audit.read')
    ? (await db
        .select({ id: auditLog.id, at: auditLog.createdAt, action: auditLog.action, actor: auditLog.actor })
        .from(auditLog)
        .where(and(eq(auditLog.orgId, ctx.orgId), eq(auditLog.entityType, 'invoice'), eq(auditLog.entityId, id)))
        .orderBy(desc(auditLog.createdAt))
        .limit(30)).map((e) => ({ id: e.id, at: e.at.toISOString(), action: e.action, actor: (e.actor.startsWith('ai:') ? 'ai' : e.actor.startsWith('system:') ? 'system' : 'user') as 'user' | 'ai' | 'system' }))
    : null;
  return { invoice, client, items, payments: paymentRows, derived: deriveInvoice(invoice, netPaid(paymentRows), today), period: invoice.periodKey ?? periodKey(invoice.dueDate), timeline, today };
}

export interface BillingFormOptions {
  taxRateBps: number;
  today: string;
  clients: { id: string; name: string }[];
  packages: { id: string; label: string; productName: string; monthlyPrice: number }[];
}

/** What the invoice and subscription forms offer to pick from: active clients, active packages with their official prices, the tax rate. */
export async function getBillingFormOptions(ctx: Ctx): Promise<BillingFormOptions> {
  assertCan(ctx, 'billing.write');
  const org = await loadOrgBilling(db, ctx.orgId);
  const [clientRows, packageRows] = await Promise.all([
    db.select({ id: clients.id, name: clients.name }).from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.archivedAt))).orderBy(asc(clients.nameKey)),
    db
      .select({ id: packages.id, name: packages.name, productName: products.name, monthlyPrice: packages.monthlyPrice })
      .from(packages)
      .innerJoin(products, and(eq(products.orgId, packages.orgId), eq(products.id, packages.productId)))
      .where(and(eq(packages.orgId, ctx.orgId), isNull(packages.archivedAt), isNull(products.archivedAt)))
      .orderBy(asc(products.name), asc(packages.name)),
  ]);
  return {
    taxRateBps: org.taxRateBps,
    today: todayIn(org.timezone, ctx.clock.now()),
    clients: clientRows,
    packages: packageRows.map((p) => ({ id: p.id, label: `${p.productName} · ${p.name}`, productName: p.productName, monthlyPrice: p.monthlyPrice })),
  };
}
