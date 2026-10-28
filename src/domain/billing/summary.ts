import { and, asc, count, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients, invoices, packages, payments, products, subscriptions } from '../../db/schema';
import type { Ctx } from '../ctx';
import { assertCan } from '../permissions';
import { addDays, addMonths, todayIn } from './dates';
import { listInvoices, loadOrgBilling } from './invoices';

export interface InvoiceBrief {
  id: string;
  number: string | null;
  clientId: string;
  clientName: string;
  dueDate: string;
  balance: number;
  daysOverdue: number;
}

export interface FinanceSummary {
  today: string;
  /** `YYYY-MM` of the current month in the organization's time zone. */
  month: string;
  /** Monthly recurring revenue: every active subscription's amount spread over its interval (ERD 3.3). */
  mrr: number;
  activeSubscriptions: number;
  /** Payments minus corrections whose payment date falls in this month. */
  receivedThisMonth: number;
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number; items: InvoiceBrief[] };
  dueToday: InvoiceBrief[];
  renewalsSoon: { id: string; clientId: string; clientName: string; productName: string; nextDueDate: string; amount: number }[];
  /** Auto-prepared drafts nobody has reviewed yet. */
  draftsToReview: number;
  /** Six months, oldest first: money received vs money invoiced (invoices sent or paid, by issue date). */
  series: { month: string; received: number; invoiced: number }[];
}

const SERIES_MONTHS = 6;
const RENEWAL_WINDOW_DAYS = 7;

const brief = (i: { id: string; number: string | null; clientId: string; clientName: string; dueDate: string; balance: number; daysOverdue: number }): InvoiceBrief => ({
  id: i.id, number: i.number, clientId: i.clientId, clientName: i.clientName, dueDate: i.dueDate, balance: i.balance, daysOverdue: i.daysOverdue,
});

/**
 * The money figures of the dashboard. Nothing here is stored: balances, overdue and received are derived from invoices and
 * the payment ledger by the same functions the invoice screens use (CR-01), so the home page cannot disagree with them.
 */
export async function getFinanceSummary(ctx: Ctx): Promise<FinanceSummary> {
  assertCan(ctx, 'billing.read');
  const org = await loadOrgBilling(db, ctx.orgId);
  const today = todayIn(org.timezone, ctx.clock.now());
  const month = today.slice(0, 7);
  const firstMonth = addMonths(`${month}-01`, -(SERIES_MONTHS - 1)).slice(0, 7);

  const [sent, [subs], received, invoiced, [drafts], renewals] = await Promise.all([
    listInvoices(ctx, { status: 'sent' }),
    db
      .select({ n: count(), mrr: sql<string>`coalesce(sum(round(${subscriptions.amount}::numeric / ${subscriptions.intervalMonths})), 0)` })
      .from(subscriptions)
      .where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.status, 'active'))),
    db
      .select({
        m: sql<string>`to_char(${payments.paidOn}, 'YYYY-MM')`,
        total: sql<string>`sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end)`,
      })
      .from(payments)
      .where(and(eq(payments.orgId, ctx.orgId), sql`${payments.paidOn} >= ${`${firstMonth}-01`}::date`))
      .groupBy(sql`1`),
    db
      .select({ m: sql<string>`to_char(${invoices.issueDate}, 'YYYY-MM')`, total: sql<string>`sum(${invoices.total})` })
      .from(invoices)
      .where(and(eq(invoices.orgId, ctx.orgId), sql`${invoices.status} in ('sent', 'paid')`, sql`${invoices.issueDate} >= ${`${firstMonth}-01`}::date`))
      .groupBy(sql`1`),
    db.select({ n: count() }).from(invoices).where(and(eq(invoices.orgId, ctx.orgId), eq(invoices.status, 'draft'), eq(invoices.isAiDraft, true))),
    db
      .select({ id: subscriptions.id, clientId: subscriptions.clientId, clientName: clients.name, productName: products.name, nextDueDate: subscriptions.nextDueDate, amount: subscriptions.amount })
      .from(subscriptions)
      .innerJoin(clients, and(eq(clients.orgId, subscriptions.orgId), eq(clients.id, subscriptions.clientId)))
      .innerJoin(products, and(eq(products.orgId, subscriptions.orgId), eq(products.id, subscriptions.productId)))
      .where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.status, 'active'), sql`${subscriptions.nextDueDate} <= ${addDays(today, RENEWAL_WINDOW_DAYS)}::date`))
      .orderBy(asc(subscriptions.nextDueDate)),
  ]);

  const overdueRows = sent.filter((i) => i.overdue).sort((a, b) => b.daysOverdue - a.daysOverdue);
  const receivedBy = new Map(received.map((r) => [r.m, Number(r.total)]));
  const invoicedBy = new Map(invoiced.map((r) => [r.m, Number(r.total)]));
  const months = Array.from({ length: SERIES_MONTHS }, (_, i) => addMonths(`${firstMonth}-01`, i).slice(0, 7));

  return {
    today,
    month,
    mrr: Number(subs.mrr),
    activeSubscriptions: subs.n,
    receivedThisMonth: receivedBy.get(month) ?? 0,
    outstanding: { amount: sent.reduce((s, i) => s + i.balance, 0), count: sent.length },
    overdue: { amount: overdueRows.reduce((s, i) => s + i.balance, 0), count: overdueRows.length, items: overdueRows.slice(0, 5).map(brief) },
    dueToday: sent.filter((i) => i.dueDate === today).map(brief),
    renewalsSoon: renewals,
    draftsToReview: drafts.n,
    series: months.map((m) => ({ month: m, received: receivedBy.get(m) ?? 0, invoiced: invoicedBy.get(m) ?? 0 })),
  };
}

export type CalendarKind = 'invoice_due' | 'invoice_overdue' | 'invoice_paid' | 'invoice_draft' | 'renewal';
export interface CalendarEvent {
  date: string;
  kind: CalendarKind;
  label: string;
  amount: number;
  href: string;
}

/** What falls on each day of one month: invoices by due date and subscription renewals. Colour and meaning come from `kind`. */
export async function getCalendarMonth(ctx: Ctx, monthKey: string): Promise<{ month: string; today: string; events: CalendarEvent[] }> {
  assertCan(ctx, 'billing.read');
  const org = await loadOrgBilling(db, ctx.orgId);
  const today = todayIn(org.timezone, ctx.clock.now());
  const from = `${monthKey}-01`;
  const to = addDays(addMonths(from, 1), -1);

  const [inv, subs] = await Promise.all([
    listInvoices(ctx).then((rows) => rows.filter((i) => i.status !== 'void' && i.dueDate >= from && i.dueDate <= to)),
    db
      .select({ id: subscriptions.id, clientName: clients.name, nextDueDate: subscriptions.nextDueDate, amount: subscriptions.amount })
      .from(subscriptions)
      .innerJoin(clients, and(eq(clients.orgId, subscriptions.orgId), eq(clients.id, subscriptions.clientId)))
      .where(and(eq(subscriptions.orgId, ctx.orgId), eq(subscriptions.status, 'active'), sql`${subscriptions.nextDueDate} between ${from}::date and ${to}::date`)),
  ]);

  const events: CalendarEvent[] = [
    ...inv.map((i) => ({
      date: i.dueDate,
      kind: (i.status === 'paid' ? 'invoice_paid' : i.status === 'draft' ? 'invoice_draft' : i.overdue ? 'invoice_overdue' : 'invoice_due') as CalendarKind,
      label: `${i.number ?? 'Draft'} · ${i.clientName}`,
      amount: i.total,
      href: `/app/invoice/${i.id}`,
    })),
    ...subs.map((s) => ({ date: s.nextDueDate, kind: 'renewal' as const, label: s.clientName, amount: s.amount, href: `/app/langganan/${s.id}` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  return { month: monthKey, today, events };
}
