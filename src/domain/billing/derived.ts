import { daysBetween } from './dates';

/** Net money received on an invoice: payments minus corrections (ERD section 6). */
export const netPaid = (rows: readonly { kind: 'payment' | 'correction'; amount: number }[]): number =>
  rows.reduce((sum, r) => sum + (r.kind === 'payment' ? r.amount : -r.amount), 0);

export interface InvoiceFacts {
  status: 'draft' | 'sent' | 'paid' | 'void';
  total: number;
  dueDate: string;
}

/**
 * The conditions that are never stored (CR-01). "Overdue" and "balance" are computed from the due date, the status and
 * the payment rows, by this one function, for the screen, the AI tools and Telegram alike.
 */
export function deriveInvoice(invoice: InvoiceFacts, paid: number, today: string) {
  const outstanding = invoice.status === 'sent';
  const balance = outstanding ? Math.max(invoice.total - paid, 0) : 0;
  const overdue = outstanding && invoice.dueDate < today;
  return { paid, balance, overdue, daysOverdue: overdue ? daysBetween(invoice.dueDate, today) : 0 };
}
