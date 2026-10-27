import { describe, expect, it } from 'vitest';
import { parseMoney } from '../money';

describe('parseMoney', () => {
  it.each([
    ['500k', 500_000],
    ['2rb', 2_000],
    ['1,5jt', 1_500_000],
    ['1.5jt', 1_500_000],
    ['1.500.000', 1_500_000],
    ['Rp 2.500', 2_500],
    ['750', 750],
  ])('%s -> %i', (input, expected) => {
    expect(parseMoney(input)).toEqual({ ok: true, value: expected });
  });

  it('rejects fractions of a rupiah and garbage', () => {
    expect(parseMoney('1,5')).toEqual({ ok: false, reason: 'fraction' });
    expect(parseMoney('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoney('5xyz')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseMoney('')).toEqual({ ok: false, reason: 'empty' });
  });
});
