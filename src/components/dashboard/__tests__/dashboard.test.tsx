import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { formatCompactRupiah, formatDateTime, formatDayMonth, formatFullDate, formatMonthShort, formatMonthYear } from '../../../lib/format';
import { monthGrid } from '../CalendarCard';
import { Composition } from '../Composition';
import { niceMax, RevenueChart } from '../RevenueChart';

describe('chart scale', () => {
  it('rounds the axis up to a figure people recognise', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(950_000)).toBe(1_000_000);
    expect(niceMax(2_300_000)).toBe(2_500_000);
    expect(niceMax(2_600_000)).toBe(5_000_000);
    expect(niceMax(7)).toBe(10);
  });
});

describe('calendar grid', () => {
  it('starts on Monday and holds whole weeks, with the neighbouring months filling the gaps', () => {
    const oct = monthGrid('2026-10'); // 1 October 2026 is a Thursday
    expect(oct[0]).toBe('2026-09-28');
    expect(oct[3]).toBe('2026-10-01');
    expect(oct).toHaveLength(35);
    expect(oct.at(-1)).toBe('2026-11-01');
    expect(monthGrid('2026-02')).toHaveLength(35); // 1 Feb 2026 is a Sunday, so it opens a fifth row
    expect(monthGrid('2027-02')).toHaveLength(28); // 1 Feb 2027 is a Monday and the month has 28 days: exactly four rows
  });
  it('gives six rows when a month spans six weeks', () => {
    expect(monthGrid('2026-08')).toHaveLength(42); // 1 Aug 2026 is a Saturday
  });
});

describe('display formats (Indonesian is the default language)', () => {
  it('shortens rupiah for axes', () => {
    expect(formatCompactRupiah(3_900_000)).toBe('3,9 jt');
    expect(formatCompactRupiah(950_000)).toBe('950 rb');
    expect(formatCompactRupiah(2_000_000_000)).toBe('2 M');
    expect(formatCompactRupiah(500)).toBe('500');
  });
  it('writes dates and months in words', () => {
    expect(formatDayMonth('2026-10-28')).toBe('28 Okt');
    expect(formatMonthYear('2026-10')).toBe('Oktober 2026');
    expect(formatMonthShort('2026-05')).toBe('Mei');
    expect(formatFullDate('2026-10-28')).toBe('Rabu, 28 Oktober 2026');
  });
  it('shows a moment in the organization time zone', () => {
    expect(formatDateTime('2026-10-28T03:05:00Z', 'Asia/Jakarta')).toBe('28 Okt, 10.05');
    expect(formatDateTime('2026-10-28T03:05:00Z', 'UTC')).toBe('28 Okt, 03.05');
  });
});

describe('dashboard parts', () => {
  it('draws one bar per series per month, a labelled scale, and the same numbers as a table', () => {
    const series = [
      { month: '2026-09', received: 1_000_000, invoiced: 1_000_000 },
      { month: '2026-10', received: 500_000, invoiced: 2_300_000 },
    ];
    const out = renderToStaticMarkup(<RevenueChart series={series} />);
    expect(out).toContain('2,5 jt'); // top of the scale
    expect(out).toContain('Rp 2.300.000'); // in the table
    expect(out).toContain('Sep');
    expect(out).toContain('<table');
  });
  it('says there is nothing to chart instead of drawing empty bars', () => {
    const out = renderToStaticMarkup(<RevenueChart series={[{ month: '2026-10', received: 0, invoiced: 0 }]} />);
    expect(out).toContain('Belum ada invoice');
    expect(out).not.toContain('class="bar');
  });
  it('shows each state with its count and share of the total', () => {
    const out = renderToStaticMarkup(<Composition composition={{ current: 6, behind: 4, unknown: 0, inactive: 0 }} />);
    expect(out).toContain('60%');
    expect(out).toContain('40%');
    expect(out).toContain('>10<');
  });
});
