import { describe, expect, it } from 'vitest';
import { priorityOf, stillApplies, type FindingFacts } from '../facts';
import { parseExplanation } from '../explain';

const invoice = (over: Partial<Extract<FindingFacts, { kind: 'invoice' }>> = {}): FindingFacts => ({
  kind: 'invoice',
  invoiceId: 'inv1',
  number: 'INV-2026-0001',
  status: 'sent',
  clientId: 'c1',
  clientName: 'Aksara Studio',
  dueDate: '2026-10-20',
  total: 5_000_000,
  balance: 5_000_000,
  overdue: true,
  daysOverdue: 8,
  isAiDraft: false,
  ...over,
});
const subscription = (over: Partial<Extract<FindingFacts, { kind: 'subscription' }>> = {}): FindingFacts => ({
  kind: 'subscription',
  subscriptionId: 's1',
  status: 'active',
  clientId: 'c1',
  clientName: 'Aksara Studio',
  productName: 'Orbit CRM',
  packageName: 'Bisnis',
  amount: 450_000,
  nextDueDate: '2026-11-01',
  daysUntilDue: 4,
  invoicedForPeriod: false,
  ...over,
});

describe('stillApplies (BR-M08-12: a finding whose condition is gone closes by itself)', () => {
  it('keeps an overdue finding only while the invoice is sent and past due', () => {
    expect(stillApplies('invoice_overdue', '2026-10-20', invoice())).toBe(true);
    expect(stillApplies('invoice_overdue', '2026-10-20', invoice({ status: 'paid', balance: 0, overdue: false, daysOverdue: 0 }))).toBe(false);
    expect(stillApplies('invoice_overdue', '2026-10-20', invoice({ status: 'void', overdue: false }))).toBe(false);
    expect(stillApplies('invoice_overdue', '2026-10-20', { kind: 'missing' })).toBe(false);
  });

  it('keeps a "draft ready" finding only while the invoice is still a draft', () => {
    expect(stillApplies('invoice_draft_ready', '2026-11', invoice({ status: 'draft', overdue: false }))).toBe(true);
    expect(stillApplies('invoice_draft_ready', '2026-11', invoice({ status: 'sent', overdue: false }))).toBe(false);
  });

  it('closes a renewal finding once the period is invoiced, the due date moved on, or the subscription stopped', () => {
    expect(stillApplies('renewal_upcoming', '2026-11-01', subscription())).toBe(true);
    expect(stillApplies('renewal_upcoming', '2026-11-01', subscription({ invoicedForPeriod: true }))).toBe(false);
    expect(stillApplies('renewal_upcoming', '2026-11-01', subscription({ nextDueDate: '2026-12-01' }))).toBe(false);
    expect(stillApplies('renewal_upcoming', '2026-11-01', subscription({ status: 'stopped' }))).toBe(false);
  });
});

describe('priorityOf (BR-M08-14: a fixed formula, never the model)', () => {
  const today = '2026-10-28';
  it('puts an overdue invoice above a renewal and a renewal above a draft to review', () => {
    const overdue = priorityOf('invoice_overdue', invoice({ balance: 100_000, daysOverdue: 1 }), today);
    const renewal = priorityOf('renewal_upcoming', subscription(), today);
    const draft = priorityOf('invoice_draft_ready', invoice({ status: 'draft', overdue: false, dueDate: '2026-11-20' }), today);
    expect(overdue.score).toBeGreaterThan(renewal.score);
    expect(renewal.score).toBeGreaterThan(draft.score);
    expect(overdue.level).toBe('high');
    expect(draft.level).toBe('medium');
  });

  it('ranks a later and larger overdue invoice higher, with a cap so one never runs away', () => {
    const small = priorityOf('invoice_overdue', invoice({ balance: 100_000, daysOverdue: 2 }), today).score;
    const late = priorityOf('invoice_overdue', invoice({ balance: 100_000, daysOverdue: 30 }), today).score;
    const big = priorityOf('invoice_overdue', invoice({ balance: 50_000_000, daysOverdue: 2 }), today).score;
    expect(late).toBeGreaterThan(small);
    expect(big).toBeGreaterThan(small);
    expect(priorityOf('invoice_overdue', invoice({ daysOverdue: 400 }), today).score).toBe(priorityOf('invoice_overdue', invoice({ daysOverdue: 60 }), today).score);
  });

  it('is deterministic: the same facts always give the same order', () => {
    expect(priorityOf('renewal_upcoming', subscription(), today)).toEqual(priorityOf('renewal_upcoming', subscription(), today));
  });
});

describe('parseExplanation', () => {
  it('splits the explanation from the client message draft', () => {
    const out = parseExplanation('PENJELASAN:\nInvoice ini terlambat.\n\nDRAF PESAN:\nHalo Bu Rina, kami mengingatkan...');
    expect(out).toEqual({ explanation: 'Invoice ini terlambat.', draftMessage: 'Halo Bu Rina, kami mengingatkan...' });
  });

  it('accepts bold markers and treats "-" as no draft', () => {
    expect(parseExplanation('**PENJELASAN:** Draf siap.\n**DRAF PESAN:** -')).toEqual({ explanation: 'Draf siap.', draftMessage: null });
  });

  it('keeps a plain answer as the explanation when the model ignored the format', () => {
    expect(parseExplanation('Invoice ini terlambat delapan hari.')).toEqual({ explanation: 'Invoice ini terlambat delapan hari.', draftMessage: null });
  });
});

const task = (over: Partial<Extract<FindingFacts, { kind: 'task' }>> = {}): FindingFacts => ({
  kind: 'task',
  taskId: 't1',
  title: 'Pengingat jadwal tidak terkirim',
  taskKind: 'bug',
  status: 'open',
  priority: 'medium',
  dueDate: '2026-10-25',
  late: true,
  daysLate: 3,
  isDraft: false,
  assigneeName: null,
  clientId: 'c1',
  clientName: 'Klinik Sehat Sentosa',
  ...over,
});

describe('task_late (BR-M05-03 through the Action Center)', () => {
  it('stays open while the task is late for the same due date, and closes when done or rescheduled', () => {
    expect(stillApplies('task_late', '2026-10-25', task())).toBe(true);
    expect(stillApplies('task_late', '2026-10-25', task({ status: 'done', late: false, daysLate: 0 }))).toBe(false);
    expect(stillApplies('task_late', '2026-10-25', task({ dueDate: '2026-11-05', late: false, daysLate: 0 }))).toBe(false);
    expect(stillApplies('task_late', '2026-10-25', { kind: 'missing' })).toBe(false);
  });

  it('ranks an urgent late task high and a low one a day late low', () => {
    expect(priorityOf('task_late', task({ priority: 'urgent', daysLate: 1 }), '2026-10-26').level).toBe('high');
    expect(priorityOf('task_late', task({ priority: 'low', daysLate: 1 }), '2026-10-26').level).toBe('low');
    const aWeek = priorityOf('task_late', task({ daysLate: 7 }), '2026-11-01').score;
    const aMonth = priorityOf('task_late', task({ daysLate: 30 }), '2026-11-24').score;
    expect(aMonth).toBeGreaterThan(aWeek);
    expect(priorityOf('task_late', task({ daysLate: 300 }), '2027-08-21').score).toBe(aMonth); // capped at 30 days
  });
});
