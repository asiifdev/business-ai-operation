import { getLocale } from './i18n';

/** Single place for display formatting (BR-M14-08). Components never call Intl/toLocaleString themselves. */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 1500000 -> "Rp 1.500.000". Money is integer Rupiah (CR-04). */
export function formatRupiah(amount: number): string {
  const n = Math.trunc(amount);
  return `${n < 0 ? '-' : ''}Rp ${group(String(Math.abs(n)))}`;
}

/** 1500000 -> "1.500.000" */
export function formatNumber(value: number): string {
  const [int, frac] = String(value).split('.');
  const sign = int.startsWith('-') ? '-' : '';
  return `${sign}${group(int.replace('-', ''))}${frac ? `,${frac}` : ''}`;
}

/** 0.256 -> "25,6%" (one decimal at most) */
export function formatPercent(ratio: number): string {
  return `${String(Math.round(ratio * 1000) / 10).replace('.', ',')}%`;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** "2026-11-04" -> "04/11/2026". Server values stay ISO (YYYY-MM-DD). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** "04/11/2026" -> "2026-11-04", or null when not a real calendar date. */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${pad(y, 4)}-${pad(mo)}-${pad(d)}`;
}

/** 1536000 -> "1,5 MB" */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const text = i === 0 ? String(v) : String(Math.round(v * 10) / 10).replace('.', ',');
  return `${text} ${units[i]}`;
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
} as const;
const WEEKDAYS = { en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], id: ['S', 'S', 'R', 'K', 'J', 'S', 'M'] } as const;

/** Month name in the active UI language (month index 0-11). */
export const monthName = (monthIndex: number) => MONTHS[getLocale()][monthIndex];
/** Weekday initials, Monday first, in the active UI language. */
export const weekdayInitials = () => WEEKDAYS[getLocale()];

const MONTHS_SHORT = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
} as const;
const WEEKDAYS_LONG = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  id: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
} as const;

const parts = (iso: string) => {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso);
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: m[3] ? Number(m[3]) : 1 } : null;
};

/** 3900000 -> "3,9 jt" (id) / "3.9M" (en). For chart axes and tight cards, where the full figure would not fit. */
export function formatCompactRupiah(amount: number): string {
  const id = getLocale() === 'id';
  const units = id ? ([[1e9, ' M'], [1e6, ' jt'], [1e3, ' rb']] as const) : ([[1e9, 'B'], [1e6, 'M'], [1e3, 'K']] as const);
  for (const [size, suffix] of units) {
    if (Math.abs(amount) >= size) {
      const v = Math.round((amount / size) * 10) / 10;
      return `${String(v).replace('.', id ? ',' : '.')}${suffix}`;
    }
  }
  return String(Math.trunc(amount));
}

/** "2026-10-28" -> "28 Okt" / "Oct 28". */
export function formatDayMonth(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  return getLocale() === 'id' ? `${p.d} ${MONTHS_SHORT.id[p.m]}` : `${MONTHS_SHORT.en[p.m]} ${p.d}`;
}

/** "2026-10" -> "Oktober 2026" / "October 2026". */
export function formatMonthYear(monthKey: string): string {
  const p = parts(monthKey);
  return p ? `${MONTHS[getLocale()][p.m]} ${p.y}` : monthKey;
}

/** "2026-10" -> "Okt" / "Oct" (a month label under a chart bar). */
export function formatMonthShort(monthKey: string): string {
  const p = parts(monthKey);
  return p ? MONTHS_SHORT[getLocale()][p.m] : monthKey;
}

/** "2026-10-28" -> "Rabu, 28 Oktober 2026" / "Wednesday, October 28, 2026". */
export function formatFullDate(iso: string): string {
  const p = parts(iso);
  if (!p) return iso;
  const weekday = WEEKDAYS_LONG[getLocale()][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
  return getLocale() === 'id' ? `${weekday}, ${p.d} ${MONTHS.id[p.m]} ${p.y}` : `${weekday}, ${MONTHS.en[p.m]} ${p.d}, ${p.y}`;
}

/** A moment as "28 Okt, 10.46" in the given time zone. */
export function formatDateTime(instant: string | Date, timeZone: string): string {
  const d = new Date(instant);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const get = (t: string) => f.formatToParts(d).find((x) => x.type === t)?.value ?? '';
  const day = `${get('day')} ${MONTHS_SHORT[getLocale()][Number(get('month')) - 1]}`;
  return `${day}, ${get('hour')}.${get('minute')}`;
}

const WEEKDAYS_SHORT = { en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], id: ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'] } as const;
/** Three-letter weekday names, Monday first, for a calendar header. */
export const weekdayShort = () => WEEKDAYS_SHORT[getLocale()];
