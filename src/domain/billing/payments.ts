import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { invoices, payments } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { MAX_PRICE, optionalText, who } from '../portfolio/shared';
import { isValidDate, todayIn } from './dates';
import { netPaid } from './derived';
import { loadOrgBilling } from './invoices';
import { advanceAfterPayment } from './subscriptions';

export const paymentSchema = z.object({
  kind: z.enum(['payment', 'correction']).default('payment'),
  amount: z.number().int().min(1).max(MAX_PRICE),
  paidOn: z.string().refine(isValidDate, 'date'),
  method: z.string().trim().min(1).max(60),
  reference: optionalText(120),
  note: optionalText(500),
});

/**
 * Appends one row to the payment ledger (BR-M03-06); nothing is ever updated. After the insert THIS function, and no
 * one else, decides whether the invoice is now paid (BR-M03-07): the total of payments minus corrections reaches the
 * invoice total. AI and chat can never get here (BR-M03-10): the only callers are the web endpoint and its tests.
 */
export async function recordPayment(ctx: Ctx, invoiceId: string, raw: z.input<typeof paymentSchema>) {
  assertCan(ctx, 'billing.write');
  if (ctx.actor.startsWith('ai:')) throw new DomainError('forbidden', 'AI never records payments');
  const input = paymentSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, invoiceId))).for('update');
    if (!invoice) throw new DomainError('not_found', 'invoice');
    if (invoice.status !== 'sent') throw new DomainError('invalid_state', `payments can only be recorded on a sent invoice, this one is ${invoice.status}`);
    const org = await loadOrgBilling(tx, ctx.orgId);
    if (input.paidOn > todayIn(org.timezone, ctx.clock.now())) throw new DomainError('validation', 'paidOn is in the future');
    const before = netPaid(await tx.select({ kind: payments.kind, amount: payments.amount }).from(payments).where(and(eq(payments.orgId, ctx.orgId), eq(payments.invoiceId, invoiceId))));
    const after = before + (input.kind === 'payment' ? input.amount : -input.amount);
    if (after < 0) throw new DomainError('validation', 'a correction cannot take back more than was paid');
    if (after > invoice.total) throw new DomainError('validation', 'the payment is more than the amount still due');

    const [row] = await tx
      .insert(payments)
      .values({ orgId: ctx.orgId, invoiceId, kind: input.kind, amount: input.amount, paidOn: input.paidOn, method: input.method, reference: input.reference ?? null, note: input.note ?? null, recordedBy: ctx.actor })
      .returning({ id: payments.id });
    const settled = after >= invoice.total;
    if (settled) {
      await tx.update(invoices).set({ status: 'paid', paidAt: ctx.clock.now() }).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.id, invoiceId)));
      await advanceAfterPayment(tx, who(ctx), invoice);
    }
    await recordAudit(tx, who(ctx), {
      action: input.kind === 'payment' ? 'payment.recorded' : 'payment.corrected',
      entityType: 'invoice',
      entityId: invoiceId,
      summary: { paymentId: row.id, amount: input.amount, method: input.method, balance: invoice.total - after, paid: settled },
    });
    return { id: row.id, paid: settled, balance: invoice.total - after };
  });
}
