import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { findings, invoices, subscriptions } from '../../db/schema';
import { recordAudit, type AuditWho } from '../audit/service';
import { automationOnce } from '../automation/once';
import { addDays, todayIn } from '../billing/dates';
import { loadOrgBilling } from '../billing/invoices';
import { listStagnantLeads } from '../pipeline/leads';
import { listLateTasks } from '../tasks/service';
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

/**
 * `rule.task_late` (BRD-M08 section 3, BR-M05-03): an accepted, unfinished task past its due date raises ONE finding per
 * (task, due date). The dedupe key carries the due date (D-046), so a task that is rescheduled and runs late again gets a
 * fresh card, while the same lateness never raises two.
 */
export async function emitTaskLate(orgId: string, now: Date): Promise<{ raised: string[] }> {
  const late = await listLateTasks(orgId, now);
  const audit: AuditWho = { orgId, actor: 'system:rule.task_late' };
  const raised: string[] = [];
  for (const task of late) {
    await db.transaction(async (tx) => {
      const once = await automationOnce(tx, orgId, 'task_late', `late:${task.id}:${task.dueDate}`, async () => {
        const [row] = await tx
          .insert(findings)
          .values({ orgId, rule: 'task_late', entityType: 'task', entityId: task.id, periodKey: task.dueDate })
          .onConflictDoNothing()
          .returning({ id: findings.id });
        if (row) await recordAudit(tx, audit, { action: 'finding.created', entityType: 'finding', entityId: row.id, summary: { rule: 'task_late', taskId: task.id } });
        return { findingId: row?.id ?? null };
      });
      if (once.ran) raised.push(task.id);
    });
  }
  return { raised };
}

/**
 * `rule.lead_stagnant` (BRD-M08 section 3, BR-M04-08): an open, accepted lead that has stayed in its stage longer than the
 * organization's threshold raises ONE finding per quiet spell. The period is the moment the lead entered its stage
 * (D-073), so moving it closes the card and a later spell raises a new one, while the same spell never raises two.
 */
export async function emitLeadStagnant(orgId: string, now: Date): Promise<{ raised: string[] }> {
  const stagnant = await listStagnantLeads(orgId, now);
  const audit: AuditWho = { orgId, actor: 'system:rule.lead_stagnant' };
  const raised: string[] = [];
  for (const lead of stagnant) {
    const since = lead.stageChangedAt.toISOString();
    await db.transaction(async (tx) => {
      const once = await automationOnce(tx, orgId, 'lead_stagnant', `stagnant:${lead.id}:${since}`, async () => {
        const [row] = await tx
          .insert(findings)
          .values({ orgId, rule: 'lead_stagnant', entityType: 'lead', entityId: lead.id, periodKey: since })
          .onConflictDoNothing()
          .returning({ id: findings.id });
        if (row) await recordAudit(tx, audit, { action: 'finding.created', entityType: 'finding', entityId: row.id, summary: { rule: 'lead_stagnant', leadId: lead.id } });
        return { findingId: row?.id ?? null };
      });
      if (once.ran) raised.push(lead.id);
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
  const late = await emitTaskLate(orgId, now);
  const stagnant = await emitLeadStagnant(orgId, now);
  const swept = await sweepActionCenter(orgId, now);
  return { renewalUpcomingRaised: upcoming.raised.length, taskLateRaised: late.raised.length, leadStagnantRaised: stagnant.raised.length, ...swept };
}
