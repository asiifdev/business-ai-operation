import { describe, expect, it } from 'vitest';
import { parseAnswer, parseRuns } from '../answer';
import { formatUsd } from '../usd';

describe('parseAnswer', () => {
  it('splits paragraphs and bullet lists and keeps bold runs', () => {
    expect(parseAnswer('Ada **3** orang:\n- Budi\n- Sari\n\nSumber: list_team_members')).toEqual([
      { kind: 'p', runs: [{ text: 'Ada ', bold: false }, { text: '3', bold: true }, { text: ' orang:', bold: false }] },
      { kind: 'ul', items: [[{ text: 'Budi', bold: false }], [{ text: 'Sari', bold: false }]] },
      { kind: 'p', runs: [{ text: 'Sumber: list_team_members', bold: false }] },
    ]);
  });

  it('marks `code` spans and keeps ** inside them literal', () => {
    expect(parseRuns('Dari `get_ai_usage` dan `a**b**`')).toEqual([
      { text: 'Dari ', bold: false },
      { text: 'get_ai_usage', bold: false, code: true },
      { text: ' dan ', bold: false },
      { text: 'a**b**', bold: false, code: true },
    ]);
  });

  it('leaves markup as literal text, never as HTML', () => {
    const [block] = parseAnswer('<img src=x onerror=alert(1)> **ok**');
    expect(block.kind).toBe('p');
    expect(JSON.stringify(block)).toContain('<img src=x onerror=alert(1)>');
  });

  it('copes with an unbalanced bold marker, empty text and Windows line breaks', () => {
    expect(parseRuns('a **b')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }]);
    expect(parseAnswer('')).toEqual([]);
    expect(parseAnswer('satu\r\ndua')).toHaveLength(2);
  });
});

describe('formatUsd', () => {
  it('shows fractions of a cent', () => {
    expect(formatUsd(2_000_000)).toBe('USD 2.00');
    expect(formatUsd(2_100)).toBe('USD 0.0021');
  });
});
