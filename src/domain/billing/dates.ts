/** Calendar dates are plain `YYYY-MM-DD` strings in the organization's time zone, never `Date` objects (BR-M03 §11.6). */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parts(iso: string): [number, number, number] {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`not a date: ${iso}`);
  return [Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10))];
}

export const isValidDate = (iso: string): boolean => {
  if (!ISO_DATE.test(iso)) return false;
  const [y, m, d] = parts(iso);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
};

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Today's date where the organization is, so "due today" does not flip at the server's midnight. */
export function todayIn(timeZone: string, now: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/**
 * Moves a date by whole months and lands on `anchorDay`, or on the last day of a shorter month. Anchoring on the day
 * the subscription started stops drift: 31 Jan -> 28 Feb -> 31 Mar, not 28 Mar (BRD-M03 §11.6).
 */
export function addMonths(iso: string, months: number, anchorDay?: number): string {
  const [y, m, d] = parts(iso);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = Math.min(anchorDay ?? d, daysInMonth(year, month));
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

export const addDays = (iso: string, days: number): string => {
  const [y, m, d] = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
};

/** Whole days from `a` to `b` (positive when `b` is later). */
export const daysBetween = (a: string, b: string): number => {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
};

/** The billing period an invoice covers is named by the month of its due date, e.g. `2026-11` (ERD `period_key`). */
export const periodKey = (dueDate: string): string => dueDate.slice(0, 7);
