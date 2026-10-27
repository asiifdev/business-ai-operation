import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatNumber, formatPercent, formatRupiah, parseDisplayDate } from '../format';
import { checkFiles, matchesAccept } from '../files';

describe('format', () => {
  it('formats Rupiah and numbers with dot grouping', () => {
    expect(formatRupiah(1500000)).toBe('Rp 1.500.000');
    expect(formatRupiah(-2500)).toBe('-Rp 2.500');
    expect(formatNumber(1234567.5)).toBe('1.234.567,5');
    expect(formatPercent(0.256)).toBe('25,6%');
    expect(formatBytes(1536000)).toBe('1,5 MB');
  });

  it('converts between ISO and display dates and rejects impossible dates', () => {
    expect(formatDate('2026-11-04')).toBe('04/11/2026');
    expect(parseDisplayDate('04/11/2026')).toBe('2026-11-04');
    expect(parseDisplayDate('31/02/2026')).toBeNull();
    expect(parseDisplayDate('4/11')).toBeNull();
  });
});

describe('files', () => {
  const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

  it('validates by MIME, not by extension', () => {
    expect(matchesAccept('audio/mpeg', ['audio/*'])).toBe(true);
    expect(matchesAccept('image/png', ['audio/*'])).toBe(false);
    const { accepted, problems } = checkFiles([file('voice.mp3', 'image/png'), file('ok.wav', 'audio/wav')], ['audio/*']);
    expect(accepted.map((f) => f.name)).toEqual(['ok.wav']);
    expect(problems[0].reason).toBe('type');
  });

  it('rejects files over the size limit', () => {
    const { problems } = checkFiles([file('big.wav', 'audio/wav', 100)], ['audio/*'], 50);
    expect(problems[0].reason).toBe('size');
  });
});
