import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { findings, invoices, subscriptions } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import { automationOnce } from '../automation/once';
import { addDays, todayIn } from '../billing/dates';
import { loadOrgBilling } from '../billing/invoices';
import { expireApprovals } from './approvals';
import { RENEWAL_WINDOW_DAYS } from './facts';
import { sweepFindings } from './findings';

/**
 * `rule.renewal_upcoming` (BRD-M08 section 3): an active subscription due within the window that has no invoice for that
 * period yet raises ONE finding per (subscription, due date). Once the renewal draft exists the "draft ready" card takes
 * over and this one closes itself, so the two never pile up for the same renewal.
 */
export async function emitRenewalUpcoming(orgId: string, now: Date): Promise<{ raised: string[] }> {
  const org = await loadOrgBilling(db, orgId);
  const today = todayIn(org.timezone, now);
  const due = await db
    .select({ id: subscriptions.id, nextDueDate: subscriptions.nextDueDate })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.orgId, orgId),
        eq(subscriptions.status, 'active'),
        sql`${subscriptions.nextDueDate} between ${today}::date and ${addDays(today, RENEWAL_WINDOW_DAYS)}::date`,
        sql`not exists (select 1 from ${invoices} where ${invoices.orgId} = ${subscriptions.orgId} and ${invoices.subscriptionId} = ${subscriptions.id} and ${invoices.periodKey} = to_char(${subscriptions.nextDueDate}, 'YYYY-MM'))`,
      ),
    );

  const audit: AuditWho = { orgId, actor: 'system:rule.renewal_upcoming' };
  const raised: string[] = [];
  for (const sub of due) {
    await db.transaction(async (tx) => {
      const once = await automationOnce(tx, orgId, 'renewal_upcoming', `upcoming:${sub.id}:${sub.nextDueDate}`, async () => {
        const [row] = await tx
          .insert(findings)
          .values({ orgId, rule: 'renewal_upcoming', entityType: 'subscription', entityId: sub.id, periodKey: sub.nextDueDate })
          .onConflictDoNothing()
          .returning({ id: findings.id });
        if (row) await recordAudit(tx, audit, { action: 'finding.created', entityType: 'finding', entityId: row.id, summary: { rule: 'renewal_upcoming', subscriptionId: sub.id } });
        return { findingId: row?.id ?? null };
      });
      if (once.ran) raised.push(sub.id);
    });
  }
  return { raised };
}

/** Cheap housekeeping the ticker runs every minute: closes findings whose condition is gone, wakes snoozed ones, expires approvals. */
export async function sweepActionCenter(orgId: string, now: Date) {
  const findingsSwept = await sweepFindings(orgId, now);
  const expired = await expireApprovals(orgId, now);
  return { ...findingsSwept, expired };
}

/** The Action Center's part of the daily run, after the billing rules have raised their own findings. */
export async function runActionCenterRules(orgId: string, now: Date) {
  const upcoming = await emitRenewalUpcoming(orgId, now);
  const swept = await sweepActionCenter(orgId, now);
  return { renewalUpcomingRaised: upcoming.raised.length, ...swept };
}
