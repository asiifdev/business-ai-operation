import { daysBetween } from '../billing/dates';

export type FindingRule = 'invoice_overdue' | 'invoice_draft_ready' | 'renewal_upcoming' | 'task_late' | 'lead_stagnant' | 'deployment_outdated' | 'deployment_down';
export type FindingStatus = 'new' | 'handled' | 'ignored' | 'snoozed' | 'auto_resolved';

/** Rules about money: only people who may read billing see them or act on them (PRD section 3, BRD-M08 section 2). */
export const FINANCIAL_RULES: ReadonlySet<FindingRule> = new Set(['invoice_overdue', 'invoice_draft_ready', 'renewal_upcoming']);

/** How far ahead `renewal_upcoming` looks (BRD-M08 section 3: "subscription close to its due date"). */
export const RENEWAL_WINDOW_DAYS = 7;

/**
 * What a card shows, read live from the source record every time (BR-M08-03): the finding itself stores no amount and
 * no day count. `missing` means the record is gone or belongs to a module not built yet.
 */
export type FindingFacts =
  | {
      kind: 'invoice';
      invoiceId: string;
      number: string | null;
      status: 'draft' | 'sent' | 'paid' | 'void';
      clientId: string;
      clientName: string;
      dueDate: string;
      total: number;
      balance: number;
      overdue: boolean;
      daysOverdue: number;
      isAiDraft: boolean;
    }
  | {
      kind: 'subscription';
      subscriptionId: string;
      status: 'active' | 'stopped';
      clientId: string;
      clientName: string;
      productName: string;
      packageName: string;
      amount: number;
      nextDueDate: string;
      daysUntilDue: number;
      /** An invoice (draft or later) already exists for the period of `nextDueDate`. */
      invoicedForPeriod: boolean;
    }
  | {
      kind: 'task';
      taskId: string;
      title: string;
      taskKind: 'task' | 'bug' | 'feature' | 'maintenance';
      status: 'open' | 'in_progress' | 'done';
      priority: 'low' | 'medium' | 'high' | 'urgent';
      dueDate: string | null;
      late: boolean;
      daysLate: number;
      isDraft: boolean;
      assigneeName: string | null;
      clientId: string | null;
      clientName: string | null;
    }
  | { kind: 'missing' };

/**
 * Whether the condition that raised a finding still holds. When it does not (the invoice was paid, the draft was sent, the
 * renewal was invoiced) the finding closes by itself as `auto_resolved` (BR-M08-12). Pure, so the rule is testable alone.
 */
export function stillApplies(rule: FindingRule, periodKey: string, facts: FindingFacts): boolean {
  switch (rule) {
    case 'invoice_overdue':
      return facts.kind === 'invoice' && facts.status === 'sent' && facts.overdue;
    case 'invoice_draft_ready':
      return facts.kind === 'invoice' && facts.status === 'draft';
    case 'renewal_upcoming':
      return facts.kind === 'subscription' && facts.status === 'active' && facts.nextDueDate === periodKey && !facts.invoicedForPeriod;
    case 'task_late':
      // A new due date makes a new period: the old card closes and a later lateness raises a fresh one.
      return facts.kind === 'task' && facts.late && facts.dueDate === periodKey;
    default:
      return facts.kind !== 'missing'; // lead_stagnant arrives with its rule
  }
}

export type PriorityLevel = 'high' | 'medium' | 'low';

const RULE_WEIGHT: Record<FindingRule, number> = {
  invoice_overdue: 300,
  renewal_upcoming: 150,
  task_late: 120,
  invoice_draft_ready: 100,
  lead_stagnant: 80,
  // M17 ⚠️ default weights, awaiting the owner like the others (D-043): a domain that is down outranks code that is behind.
  deployment_down: 250,
  deployment_outdated: 90,
};

/** A late task climbs with the priority it was given: an urgent bug a day late outranks a low chore a week late. */
const TASK_PRIORITY_POINTS = { urgent: 180, high: 90, medium: 30, low: 0 } as const;

/** 10 points per digit of the Rupiah amount, at most 100: Rp 5.000.000 adds 70. Size matters, but never outweighs the kind. */
const amountPoints = (amount: number) => (amount > 0 ? Math.min(Math.floor(Math.log10(amount)) * 10, 100) : 0);

/**
 * The fixed priority formula (BR-M08-14): kind of finding, plus urgency in days, plus size of the amount (for a late task:
 * 5 points per day late, at most 30 days, plus its own priority, D-046). Code decides
 * the order, never the model. ⚠️ Default awaiting the owner's confirmation (BRD-M08 section 11 question 3); the weights
 * live only here.
 */
export function priorityOf(rule: FindingRule, facts: FindingFacts, today: string): { score: number; level: PriorityLevel } {
  let score = RULE_WEIGHT[rule];
  if (facts.kind === 'invoice') {
    score += amountPoints(facts.status === 'sent' ? facts.balance : facts.total);
    if (rule === 'invoice_overdue') score += Math.min(facts.daysOverdue, 60) * 3;
    if (rule === 'invoice_draft_ready' && daysBetween(today, facts.dueDate) <= 3) score += 50;
  } else if (facts.kind === 'task') {
    score += Math.min(facts.daysLate, 30) * 5 + TASK_PRIORITY_POINTS[facts.priority];
  } else if (facts.kind === 'subscription') {
    score += amountPoints(facts.amount) + Math.max(RENEWAL_WINDOW_DAYS - facts.daysUntilDue, 0) * 10;
  }
  return { score, level: score >= 300 ? 'high' : score >= 150 ? 'medium' : 'low' };
}
