import { and, countDistinct, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizations, subscriptions } from '../../db/schema';
import { todayIn } from '../billing/dates';
import { getFinanceSummary, type FinanceSummary } from '../billing/summary';
import type { Ctx } from '../ctx';
import { assertCan, can } from '../permissions';
import { getPipelineSummary } from '../pipeline/leads';
import { getTaskSummary } from '../tasks/service';

/**
 * The business at a glance (BRD-M12). PRD calls it `metrics.summary(ctx)`: the one source of the headline numbers, read
 * the same by the dashboard, the daily briefing, Telegram `/status` and the assistant tool `get_business_summary`
 * (BR-M12-01). It computes nothing of its own: each figure comes from the module service that owns it (billing, pipeline,
 * tasks), so a list page and this summary can never disagree. Drafts are left out by those services (BR-M12-07).
 */
export interface BusinessSummary {
  /** When these numbers were computed (BR-M12-10). Nothing is cached: every call reads the tables. */
  computedAt: string;
  /** The organization's today, `YYYY-MM-DD` (BR-M12-08). */
  today: string;
  /** Owner and Admin only (BRD-M12 §2: Staff do not see money); null for Staff. */
  money: {
    /** Active subscriptions, each spread over its interval in months (BR-M12-02). */
    mrr: number;
    activeSubscriptions: number;
    /** Sent invoices minus what has been paid against them (BR-M12-03). */
    outstanding: { amount: number; count: number };
    /** Sent invoices past their due date, derived not stored (BR-M12-04). */
    overdue: { amount: number; count: number };
    receivedThisMonth: number;
  } | null;
  /** Open, accepted, unarchived leads (BR-M12-05). */
  pipeline: { value: number; openLeads: number; stagnant: number };
  /** ⚠️ BR-M12-06 is still a proposal: a client counts as active with at least one active subscription (D-072). */
  clients: { active: number };
  /** Accepted tasks that are not done (BR-M05-05). `mine` is open work assigned to the person asking. */
  tasks: { open: number; late: number; mine: number };
}

/**
 * Builds the summary. Pass the finance summary when the caller already has it (the dashboard needs its lists and trend
 * too), so the money is read once and is the very same object on the page and in the summary.
 */
export async function buildBusinessSummary(ctx: Ctx, finance?: FinanceSummary | null): Promise<BusinessSummary> {
  assertCan(ctx, 'dashboard.read_nonfinancial');
  const seesMoney = can(ctx.role, 'dashboard.read_financial');
  const [money, pipeline, tasks, [active]] = await Promise.all([
    seesMoney ? (finance ?? getFinanceSummary(ctx)) : Promise.resolve(null),
    getPipelineSummary(ctx),
    getTaskSummary(ctx),
    db
      .select({ n: countDistinct(subscriptions.clientId) })
      .from(subscriptions)
      .where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.status, 'active'))),
  ]);
  const today = money?.today ?? todayIn(await orgTimezone(ctx), ctx.clock.now());
  return {
    computedAt: ctx.clock.now().toISOString(),
    today,
    money: money && {
      mrr: money.mrr,
      activeSubscriptions: money.activeSubscriptions,
      outstanding: money.outstanding,
      overdue: { amount: money.overdue.amount, count: money.overdue.count },
      receivedThisMonth: money.receivedThisMonth,
    },
    pipeline: { value: pipeline.value, openLeads: pipeline.perStage.reduce((s, x) => s + x.count, 0), stagnant: pipeline.stagnant },
    clients: { active: active.n },
    tasks: { open: tasks.open, late: tasks.late, mine: tasks.mine },
  };
}

/** `metrics.summary(ctx)` in the PRD. */
export const getBusinessSummary = (ctx: Ctx) => buildBusinessSummary(ctx);

async function orgTimezone(ctx: Ctx): Promise<string> {
  const [org] = await db.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return org.tz;
}
