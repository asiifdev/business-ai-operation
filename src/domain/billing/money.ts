import { DomainError } from '../errors';

export interface ItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Totals {
  lines: { description: string; quantity: number; unitPrice: number; lineTotal: number }[];
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** The largest invoice we accept (10 trillion Rupiah). Keeps every sum inside a safe integer and a bigint column. */
export const MAX_INVOICE_TOTAL = 10_000_000_000_000;

/**
 * The ONLY place an invoice total is computed (BR-M03-01). The screen, the PDF and the database all use this result,
 * so they cannot disagree. Integer Rupiah throughout (CR-04): tax is rounded half up, using BigInt so a large
 * subtotal times the rate cannot lose precision.
 */
export function calculateTotals(items: readonly ItemInput[], taxRateBps: number): Totals {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0 || taxRateBps > 10_000) throw new DomainError('validation', 'tax rate');
  let subtotal = 0;
  const lines = items.map((item) => {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) throw new DomainError('validation', 'quantity');
    if (!Number.isInteger(item.unitPrice) || item.unitPrice < 0) throw new DomainError('validation', 'unit price');
    const lineTotal = item.quantity * item.unitPrice;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_INVOICE_TOTAL) throw new DomainError('validation', 'line total too large');
    subtotal += lineTotal;
    if (subtotal > MAX_INVOICE_TOTAL) throw new DomainError('validation', 'invoice total too large');
    return { description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal };
  });
  const taxAmount = Number((BigInt(subtotal) * BigInt(taxRateBps) + 5_000n) / 10_000n);
  return { lines, subtotal, taxAmount, total: subtotal + taxAmount };
}
