import { describe, expect, it } from 'vitest';
import { getLocale, getServerLocale } from '../i18n';
import { pickLocale, runWithLocale } from '../locale-server';
import { messages } from '../i18n';

describe('pickLocale: the language a request is rendered in', () => {
  it('prefers the saved cookie, then the profile, then the browser, then Indonesian', () => {
    expect(pickLocale({ cookie: 'en', profile: 'id', acceptLanguage: 'id' })).toBe('en');
    expect(pickLocale({ cookie: undefined, profile: 'en', acceptLanguage: 'id' })).toBe('en');
    expect(pickLocale({ profile: null, acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
    expect(pickLocale({ acceptLanguage: 'fr-FR' })).toBe('id');
    expect(pickLocale({})).toBe('id');
  });
  it('ignores a cookie that is not a language we have', () => {
    expect(pickLocale({ cookie: 'xx', profile: 'en' })).toBe('en');
  });
});

describe('server rendering language', () => {
  it('gives each concurrent render its own language', async () => {
    const render = (lang: 'id' | 'en') =>
      runWithLocale(lang, async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 10));
        return [getServerLocale(), getLocale()];
      });
    const results = await Promise.all(Array.from({ length: 40 }, (_v, i) => render(i % 2 ? 'en' : 'id')));
    results.forEach(([server, general], i) => {
      expect(server).toBe(i % 2 ? 'en' : 'id');
      expect(general).toBe(server);
    });
  });
});

describe('dictionary', () => {
  it('has exactly the same keys in both languages', () => {
    expect(Object.keys(messages.id).sort()).toEqual(Object.keys(messages.en).sort());
  });
});
