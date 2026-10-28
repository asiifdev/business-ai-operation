import { and, count, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { approvals, auditLog, clients, deployments, invoices, products } from '../../db/schema';
import type { Ctx } from '../ctx';
import { addDays, todayIn } from '../billing/dates';
import { getAiOverview } from '../ai/service';
import { can } from '../permissions';
import { listDeployments } from '../portfolio/deployments';
import { getFinanceSummary, type FinanceSummary } from '../billing/summary';

/** The few fields a dashboard row needs from an invoice. */
export type InvoiceBriefLike = { id: string; number: string | null; clientId: string; clientName: string; dueDate: string; balance: number; daysOverdue: number };

export interface DashboardOverview {
  /** Hour of the day (0-23) where the organization is, so the greeting matches their morning and not the server's. */
  localHour: number;
  counts: { clients: number; products: number; deployments: number; behind: number };
  /** Deployments running an older version than the product's current one, most behind first is not implied: listed as stored. */
  behind: { id: string; clientId: string; clientName: string; productName: string; environment: string; installedVersion: string | null; productVersion: string | null }[];
  /** How the active and inactive deployments split by version state, for the composition bar. */
  composition: { current: number; behind: number; unknown: number; inactive: number };
  /** Managers only: money figures, overdue and due-soon lists. */
  finance: FinanceSummary | null;
  /** Managers only. Null for staff, who do not see financial or approval figures. */
  pendingApprovals: number | null;
  /** Managers only: today's AI spend against today's cap, in micro-USD, summed over features. */
  ai: { spentMicroUsd: number; limitMicroUsd: number; runsToday: number } | null;
  /** Managers only: audit rows per day for the last 14 days, oldest first, and the latest few entries. */
  activity: { days: { date: string; count: number }[]; recent: { id: string; at: string; action: string; actor: 'user' | 'ai' | 'system' }[] } | null;
}

const ACTIVITY_DAYS = 14;

/**
 * What the dashboard home shows. Every figure is read from the tables or derived by the same functions the other screens
 * use (CR-01), so the home page can never disagree with a list page. Sections a role may not see come back null.
 */
export async function getDashboardOverview(ctx: Ctx): Promise<DashboardOverview> {
  const manager = can(ctx.role, 'audit.read');
  const [{ tz }] = await db.execute<{ tz: string }>(sql`select timezone as tz from organizations where id = ${ctx.orgId}`);
  const [[c], [p], [d], every] = await Promise.all([
    db.select({ n: count() }).from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.archivedAt))),
    db.select({ n: count() }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))),
    db.select({ n: count() }).from(deployments).where(and(eq(deployments.orgId, ctx.orgId), eq(deployments.status, 'active'))),
    listDeployments(ctx),
  ]);
  const behindAll = every.filter((x) => x.status === 'active' && x.versionState === 'behind');
  const composition = { current: 0, behind: 0, unknown: 0, inactive: 0 };
  for (const x of every) {
    if (x.status === 'inactive') composition.inactive++;
    else if (x.versionState === 'behind') composition.behind++;
    else if (x.versionState === 'unknown') composition.unknown++;
    else composition.current++;
  }
  const base: DashboardOverview = {
    localHour: Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(ctx.clock.now())) % 24,
    counts: { clients: c.n, products: p.n, deployments: d.n, behind: behindAll.length },
    behind: behindAll.slice(0, 6).map((x) => ({ id: x.id, clientId: x.clientId, clientName: x.clientName, productName: x.productName, environment: x.environment, installedVersion: x.installedVersion, productVersion: x.productVersion })),
    composition,
    finance: null,
    pendingApprovals: null,
    ai: null,
    activity: null,
  };
  if (!manager) return base;

  const today = todayIn(tz, ctx.clock.now());
  const first = addDays(today, -(ACTIVITY_DAYS - 1));
  const [[pending], perDay, recent, ai, finance] = await Promise.all([
    db.select({ n: count() }).from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.status, 'pending'))),
    db
      .select({ day: sql<string>`to_char(${auditLog.createdAt} at time zone ${tz}, 'YYYY-MM-DD')`, n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.orgId, ctx.orgId), gte(auditLog.createdAt, sql`(${first}::date::timestamp at time zone ${tz})`)))
      .groupBy(sql`1`),
    db.select({ id: auditLog.id, at: auditLog.createdAt, action: auditLog.action, actor: auditLog.actor }).from(auditLog).where(eq(auditLog.orgId, ctx.orgId)).orderBy(desc(auditLog.createdAt)).limit(7),
    getAiOverview(db, ctx),
    getFinanceSummary(ctx),
  ]);
  const byDay = new Map(perDay.map((r) => [r.day, r.n]));
  return {
    ...base,
    finance,
    pendingApprovals: pending.n,
    ai: {
      spentMicroUsd: ai.features.reduce((s, f) => s + f.spentMicroUsd, 0),
      limitMicroUsd: ai.features.reduce((s, f) => s + f.limitMicroUsd, 0),
      runsToday: ai.features.reduce((s, f) => s + f.runsToday, 0),
    },
    activity: {
      days: Array.from({ length: ACTIVITY_DAYS }, (_, i) => {
        const date = addDays(first, i);
        return { date, count: byDay.get(date) ?? 0 };
      }),
      recent: recent.map((r) => ({ id: r.id, at: r.at.toISOString(), action: r.action, actor: r.actor.startsWith('ai:') ? 'ai' : r.actor.startsWith('system:') ? 'system' : 'user' })),
    },
  };
}

export interface AttentionCounts {
  behindDeployments: number;
  /** Managers only; null for staff. */
  overdueInvoices: number | null;
  draftsToReview: number | null;
  pendingApprovals: number | null;
}

/**
 * The few counts the shell shows on every page (sidebar pills, the bell). Cheap on purpose: three counts, no lists, and
 * the same definitions the dashboard and the list pages use.
 */
export async function getAttentionCounts(ctx: Ctx): Promise<AttentionCounts> {
  const behindDeployments = (await listDeployments(ctx, { behindOnly: true })).filter((d) => d.status === 'active').length;
  if (!can(ctx.role, 'billing.read')) return { behindDeployments, overdueInvoices: null, draftsToReview: null, pendingApprovals: null };
  const [{ tz }] = await db.execute<{ tz: string }>(sql`select timezone as tz from organizations where id = ${ctx.orgId}`);
  const today = todayIn(tz, ctx.clock.now());
  const [[overdue], [drafts], [pending]] = await Promise.all([
    db.select({ n: count() }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.status, 'sent'), sql`${invoices.dueDate} < ${today}::date`)),
    db.select({ n: count() }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.status, 'draft'), eq(invoices.isAiDraft, true))),
    db.select({ n: count() }).from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.status, 'pending'))),
  ]);
  return { behindDeployments, overdueInvoices: overdue.n, draftsToReview: drafts.n, pendingApprovals: pending.n };
}
