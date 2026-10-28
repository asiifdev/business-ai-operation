import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { findings, invoices } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import { automationOnce } from '../automation/once';
import { loadOrgBilling } from './invoices';
import { todayIn } from './dates';
import { generateRenewalDrafts } from './subscriptions';

/**
 * `rule.invoice_overdue` (BR-M03-12): for every sent invoice past its due date, raise ONE finding, ever. The finding is the
 * event the Action Center (M08) shows as a card; it holds no amount and no day count, the card reads those from the
 * invoice (BR-M08-03). Whether an invoice is overdue is derived here from its due date and status, never stored.
 */
export async function emitOverdueFindings(orgId: string, now: Date): Promise<{ raised: string[]; skipped: number }> {
  const org = await loadOrgBilling(db, orgId);
  const today = todayIn(org.timezone, now);
  const overdue = await db
    .select({ id: invoices.id, dueDate: invoices.dueDate })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, 'sent'), sql`${invoices.dueDate} < ${today}::date`));

  const audit: AuditWho = { orgId, actor: 'system:rule.invoice_overdue' };
  const raised: string[] = [];
  let skipped = 0;
  for (const inv of overdue) {
    await db.transaction(async (tx) => {
      const once = await automationOnce(tx, orgId, 'invoice_overdue', `overdue:${inv.id}`, async () => {
        const [row] = await tx
          .insert(findings)
          .values({ orgId, rule: 'invoice_overdue', entityType: 'invoice', entityId: inv.id, periodKey: inv.dueDate })
          .onConflictDoNothing()
          .returning({ id: findings.id });
        if (row) await recordAudit(tx, audit, { action: 'finding.created', entityType: 'finding', entityId: row.id, summary: { rule: 'invoice_overdue', invoiceId: inv.id } });
        return { findingId: row?.id ?? null };
      });
      if (once.ran) raised.push(inv.id);
      else skipped++;
    });
  }
  return { raised, skipped };
}

/** Everything the billing scheduler does for one organization at one moment. Safe to run any number of times. */
export async function runBillingRules(orgId: string, now: Date) {
  const renewals = await generateRenewalDrafts(orgId, now);
  const overdue = await emitOverdueFindings(orgId, now);
  return { renewalDrafts: renewals.created.length, overdueRaised: overdue.raised.length };
}
