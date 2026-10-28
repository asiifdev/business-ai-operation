import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServerLocale, messages, setLocale, t } from '../i18n';
import { monthName, weekdayInitials } from '../format';

afterEach(() => setLocale('id'));

describe('i18n', () => {
  it('has the same keys in Indonesian and English', () => {
    expect(Object.keys(messages.id).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it('never leaves a message empty and keeps placeholders in sync', () => {
    for (const key of Object.keys(messages.en) as Array<keyof typeof messages.en>) {
      expect(messages.en[key].length).toBeGreaterThan(0);
      expect(messages.id[key].length).toBeGreaterThan(0);
      const vars = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(messages.id[key])).toEqual(vars(messages.en[key]));
    }
  });

  it('switches message, month and weekday language together', () => {
    setLocale('en');
    expect(t('required')).toBe('required');
    expect(monthName(4)).toBe('May');
    expect(weekdayInitials()[0]).toBe('M');
    setLocale('id');
    expect(t('required')).toBe('wajib');
    expect(monthName(4)).toBe('Mei');
    expect(weekdayInitials()[2]).toBe('R');
  });

  it('fills placeholders', () => {
    setLocale('id');
    expect(t('moneyMin', { min: 'Rp 10.000' })).toBe('Nominal minimal Rp 10.000.');
  });
});

describe('server locale', () => {
  it('on the server follows the active language, so server rendering can be tested in either language', () => {
    setLocale('en');
    expect(getServerLocale()).toBe('en');
  });

  it('in the browser is always the default, so hydration matches what the server rendered', () => {
    setLocale('en');
    vi.stubGlobal('window', {});
    try {
      expect(getServerLocale()).toBe('id');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
