/** Parsing for MoneyInput. Output is always integer Rupiah or an error code (CR-04, BR-M14-04). */

export type MoneyParse = { ok: true; value: number } | { ok: false; reason: 'empty' | 'invalid' | 'fraction' };

const SUFFIX: Record<string, number> = { k: 1_000, rb: 1_000, ribu: 1_000, jt: 1_000_000, juta: 1_000_000, m: 1_000_000 };

/** "1,5" or "1.5" -> 1.5; "1.500.000" -> 1500000 (dots are thousands separators when they group by three). */
function toNumber(part: string): number | null {
  let s = part.trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function parseMoney(input: string): MoneyParse {
  const text = input.toLowerCase().replace(/rp\.?/g, '').replace(/\s+/g, '');
  if (!text) return { ok: false, reason: 'empty' };
  const m = /^([\d.,]+?)([a-z]*)$/.exec(text);
  if (!m) return { ok: false, reason: 'invalid' };
  const multiplier = m[2] === '' ? 1 : SUFFIX[m[2]];
  if (multiplier === undefined) return { ok: false, reason: 'invalid' };
  const n = toNumber(m[1]);
  if (n === null) return { ok: false, reason: 'invalid' };
  const value = n * multiplier;
  if (!Number.isInteger(Math.round(value * 1e6) / 1e6)) return { ok: false, reason: 'fraction' };
  return { ok: true, value: Math.round(value) };
}
