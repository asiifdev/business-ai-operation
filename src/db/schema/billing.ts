import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, foreignKey, index, integer, pgEnum, pgTable, primaryKey, smallint, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tstz, updatedAtColumn } from './_shared';
import { organizations } from './auth';
import { clients, deployments, packages, products } from './portfolio';

export const subscriptionStatus = pgEnum('subscription_status', ['active', 'stopped']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'sent', 'paid', 'void']);
export const paymentKind = pgEnum('payment_kind', ['payment', 'correction']);

/**
 * ERD 3.3. A client's recurring plan. `amount` is a COPY of the package price taken when the subscription is made, so a
 * later price change never touches it (BR-M02-11); a changed amount only reaches the next invoice (BR-M03-13).
 */
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    clientId: text('client_id').notNull(),
    productId: text('product_id').notNull(),
    packageId: text('package_id').notNull(),
    deploymentId: text('deployment_id'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    intervalMonths: smallint('interval_months').notNull().default(1),
    nextDueDate: date('next_due_date', { mode: 'string' }).notNull(),
    /** Overrides the organization's grace days when set. */
    graceDays: smallint('grace_days'),
    status: subscriptionStatus('status').notNull().default('active'),
    startedOn: date('started_on', { mode: 'string' }).notNull(),
    stoppedOn: date('stopped_on', { mode: 'string' }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_subscriptions_org_id').on(t.orgId, t.id),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_subscriptions_client' }),
    foreignKey({ columns: [t.orgId, t.productId], foreignColumns: [products.orgId, products.id], name: 'fk_subscriptions_product' }),
    foreignKey({ columns: [t.orgId, t.packageId], foreignColumns: [packages.orgId, packages.id], name: 'fk_subscriptions_package' }),
    foreignKey({ columns: [t.orgId, t.deploymentId], foreignColumns: [deployments.orgId, deployments.id], name: 'fk_subscriptions_deployment' }),
    index('idx_subscriptions_due').on(t.orgId, t.status, t.nextDueDate),
    index('idx_subscriptions_client').on(t.orgId, t.clientId),
    check('subscriptions_amount_ck', sql`${t.amount} >= 0`),
    check('subscriptions_interval_ck', sql`${t.intervalMonths} > 0`),
    check('subscriptions_grace_ck', sql`${t.graceDays} is null or ${t.graceDays} >= 0`),
    check('subscriptions_stopped_ck', sql`(${t.status} = 'stopped') = (${t.stoppedOn} is not null)`),
  ],
);

/**
 * ERD 3.3. There is deliberately no `overdue`, `amount_paid` or `balance` column: all three are derived from `payments`
 * and the due date (CR-01). `number` is given when the invoice is sent, never earlier (BR-M03-05).
 */
export const invoices = pgTable(
  'invoices',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    clientId: text('client_id').notNull(),
    subscriptionId: text('subscription_id'),
    /** e.g. `2026-11`. With the subscription it makes automatic drafts idempotent (BR-M03-09). */
    periodKey: text('period_key'),
    number: text('number'),
    status: invoiceStatus('status').notNull().default('draft'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    total: bigint('total', { mode: 'number' }).notNull().default(0),
    /** Copy of the organization's rate when the draft was made (basis points). */
    taxRateBps: integer('tax_rate_bps').notNull().default(0),
    notes: text('notes'),
    /** True while a draft was prepared by the scheduler or AI and no person has reviewed it yet. */
    isAiDraft: boolean('is_ai_draft').notNull().default(false),
    sentAt: tstz('sent_at'),
    paidAt: tstz('paid_at'),
    voidedAt: tstz('voided_at'),
    voidReason: text('void_reason'),
    createdBy: text('created_by').notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    unique('uq_invoices_org_id').on(t.orgId, t.id),
    unique('uq_invoices_number').on(t.orgId, t.number),
    foreignKey({ columns: [t.orgId, t.clientId], foreignColumns: [clients.orgId, clients.id], name: 'fk_invoices_client' }),
    foreignKey({ columns: [t.orgId, t.subscriptionId], foreignColumns: [subscriptions.orgId, subscriptions.id], name: 'fk_invoices_subscription' }),
    uniqueIndex('uq_invoices_period').on(t.subscriptionId, t.periodKey).where(sql`${t.subscriptionId} is not null`),
    index('idx_invoices_due').on(t.orgId, t.status, t.dueDate),
    index('idx_invoices_client').on(t.orgId, t.clientId),
    check('invoices_amounts_ck', sql`${t.subtotal} >= 0 and ${t.taxAmount} >= 0 and ${t.total} >= 0 and ${t.total} = ${t.subtotal} + ${t.taxAmount}`),
    check('invoices_tax_rate_ck', sql`${t.taxRateBps} between 0 and 10000`),
    check('invoices_number_ck', sql`${t.status} in ('draft', 'void') or ${t.number} is not null`),
    check('invoices_void_reason_ck', sql`${t.status} <> 'void' or ${t.voidReason} is not null`),
  ],
);

/** Locked by a trigger once the invoice is no longer a draft (BR-M03-04). `lineTotal` is quantity x unit price. */
export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    invoiceId: text('invoice_id').notNull(),
    position: smallint('position').notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: bigint('unit_price', { mode: 'number' }).notNull(),
    lineTotal: bigint('line_total', { mode: 'number' }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id], name: 'fk_invoice_items_invoice' }).onDelete('restrict'),
    unique('uq_invoice_items_position').on(t.invoiceId, t.position),
    check('invoice_items_ck', sql`${t.quantity} > 0 and ${t.unitPrice} >= 0 and ${t.lineTotal} = ${t.quantity} * ${t.unitPrice}`),
  ],
);

/**
 * Append-only (BR-M03-06): a trigger rejects UPDATE, DELETE and TRUNCATE. The amount is always positive; `kind` decides
 * whether it adds or takes away. A mistake is fixed by a `correction` row, never by editing.
 */
export const payments = pgTable(
  'payments',
  {
    id: idColumn(),
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    invoiceId: text('invoice_id').notNull(),
    kind: paymentKind('kind').notNull().default('payment'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    note: text('note'),
    recordedBy: text('recorded_by').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => [
    foreignKey({ columns: [t.orgId, t.invoiceId], foreignColumns: [invoices.orgId, invoices.id], name: 'fk_payments_invoice' }),
    index('idx_payments_invoice').on(t.orgId, t.invoiceId),
    check('payments_amount_ck', sql`${t.amount} > 0`),
  ],
);

/** Gap-free numbering (BR-M03-05). Taken with `UPDATE ... RETURNING` in the same transaction that saves the document. */
export const numberCounters = pgTable(
  'number_counters',
  {
    orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
    scope: text('scope').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'pk_number_counters', columns: [t.orgId, t.scope] })],
);
