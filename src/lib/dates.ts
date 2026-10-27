const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  id: ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'],
} as const;

/** "2026-10-28" -> "28 October 2026" / "28 Oktober 2026". Fixed by the page language, not by the viewer's device. */
export function longDate(locale: 'en' | 'id', iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[locale][Number(m[2]) - 1]} ${m[1]}`;
}
