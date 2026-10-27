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
