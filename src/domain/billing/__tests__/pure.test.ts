import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, isValidDate, periodKey, todayIn } from '../dates';
import { deriveInvoice, netPaid } from '../derived';
import { formatInvoiceNumber } from '../invoices';
import { calculateTotals } from '../money';

describe('calculateTotals (BR-M03-01, -17)', () => {
  const items = [
    { description: 'Setup', quantity: 1, unitPrice: 1_500_000 },
    { description: 'Lisensi', quantity: 3, unitPrice: 450_000 },
  ];
  it('sums quantity x price in whole Rupiah with no tax by default', () => {
    expect(calculateTotals(items, 0)).toMatchObject({ subtotal: 2_850_000, taxAmount: 0, total: 2_850_000 });
  });
  it('adds tax as a separate figure, rounded half up', () => {
    expect(calculateTotals(items, 1100)).toMatchObject({ subtotal: 2_850_000, taxAmount: 313_500, total: 3_163_500 });
    expect(calculateTotals([{ description: 'x', quantity: 1, unitPrice: 5 }], 1000).taxAmount).toBe(1); // 0.5 rounds up
    expect(calculateTotals([{ description: 'x', quantity: 1, unitPrice: 4 }], 1000).taxAmount).toBe(0); // 0.4 rounds down
  });
  it('refuses fractions, zero quantity, negative prices and sums beyond the limit', () => {
    for (const bad of [{ quantity: 1.5, unitPrice: 1 }, { quantity: 0, unitPrice: 1 }, { quantity: 1, unitPrice: -1 }, { quantity: 1, unitPrice: 0.5 }, { quantity: 2, unitPrice: 9_000_000_000_000 }]) {
      expect(() => calculateTotals([{ description: 'x', ...bad }], 0)).toThrow();
    }
    expect(() => calculateTotals(items, 10_001)).toThrow();
  });
});

describe('dates', () => {
  it('moves months and lands on the last day of a short month without drifting (BRD-M03 11.6)', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10');
  });
  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('28-10-2026')).toBe(false);
  });
  it('reads today in the organization time zone, not the server one', () => {
    const at = new Date('2026-10-28T20:00:00Z'); // 03:00 on the 29th in Jakarta
    expect(todayIn('Asia/Jakarta', at)).toBe('2026-10-29');
    expect(todayIn('UTC', at)).toBe('2026-10-28');
  });
  it('counts days and names the period', () => {
    expect(addDays('2026-10-28', 7)).toBe('2026-11-04');
    expect(daysBetween('2026-10-28', '2026-11-04')).toBe(7);
    expect(periodKey('2026-11-04')).toBe('2026-11');
  });
});

describe('derived conditions (CR-01)', () => {
  const sent = { status: 'sent' as const, total: 1_000_000, dueDate: '2026-10-20' };
  it('is overdue only when sent and past the due date; the due day itself is not overdue', () => {
    expect(deriveInvoice(sent, 0, '2026-10-20').overdue).toBe(false);
    expect(deriveInvoice(sent, 0, '2026-10-21')).toMatchObject({ overdue: true, daysOverdue: 1, balance: 1_000_000 });
    expect(deriveInvoice({ ...sent, status: 'paid' }, 1_000_000, '2026-12-01')).toMatchObject({ overdue: false, balance: 0 });
    expect(deriveInvoice({ ...sent, status: 'draft' }, 0, '2026-12-01').overdue).toBe(false);
  });
  it('nets corrections against payments', () => {
    expect(netPaid([{ kind: 'payment', amount: 600 }, { kind: 'payment', amount: 400 }, { kind: 'correction', amount: 100 }])).toBe(900);
    expect(deriveInvoice(sent, 400_000, '2026-10-20').balance).toBe(600_000);
  });
});

describe('invoice number format (BR-M03-05)', () => {
  it('fills the year and pads the sequence', () => {
    expect(formatInvoiceNumber('INV-{YYYY}-{NNNN}', 2026, 7)).toBe('INV-2026-0007');
    expect(formatInvoiceNumber('INV/{YYYY}/{NNN}', 2026, 1234)).toBe('INV/2026/1234');
  });
});
