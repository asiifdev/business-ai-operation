import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { itemsFor, NAV, TAB_LIMIT } from '../../lib/nav';
import { messages } from '../../lib/i18n';
import { AppChrome } from '../shell/AppChrome';

const html = (current?: 'dashboard' | 'assistant' | 'ai', role: 'owner' | 'admin' | 'staff' = 'owner') =>
  renderToStaticMarkup(<AppChrome organizationName="Orbit Studio" userName="Rina" role={role} current={current} />);

describe('app shell', () => {
  it('renders a sidebar for wide screens and a tab bar for phones, both with every destination', () => {
    const out = html('assistant');
    expect(out).toContain('<aside');
    expect(out).toContain('lg:flex'); // sidebar only from 64rem
    expect(out).toContain('lg:hidden'); // phone chrome only below 64rem
    NAV.forEach((item, i) => {
      const inTabs = i < TAB_LIMIT; // destinations past the limit sit behind "More" on a phone
      const expected = 1 + (inTabs ? 1 : 0) + (item.href === '/app' ? 1 : 0); // sidebar, tab bar, and the logo links home
      expect(out.match(new RegExp(`href="${item.href}"`, 'g'))?.length, item.href).toBe(expected);
    });
  });

  it('marks the current page in the navigations it appears in and nothing else', () => {
    expect(html('assistant').match(/aria-current="page"/g)).toHaveLength(2); // sidebar and tab bar
    expect(html('ai').match(/aria-current="page"/g)).toHaveLength(1); // only in the sidebar: it is behind "More" on a phone
    expect(html('assistant')).not.toMatch(/href="\/app"[^>]*aria-current/);
    expect(html().match(/aria-current/g)).toBeNull();
  });

  it('keeps the phone tab bar to four destinations plus More, so every tab stays easy to tap', () => {
    expect(TAB_LIMIT).toBe(4);
    const phone = html('dashboard').split('lg:hidden')[1];
    expect(phone).toContain('grid-template-columns:repeat(5, minmax(0, 1fr))'); // four destinations + More
    expect(phone).toContain(messages.id.navMore);
    expect(phone).toContain('aria-haspopup="dialog"');
  });

  it('shows the organization and the person, and offers sign out, language and theme in the account block', () => {
    const out = html();
    expect(out).toContain('Orbit Studio');
    expect(out).toContain('Rina');
    expect(out).toContain(messages.id.signOut);
    expect(out).toContain('aria-pressed'); // language and theme switches
  });

  it('gives each role only the destinations it may see', () => {
    expect(itemsFor('staff').map((i) => i.id)).toEqual(['dashboard', 'clients', 'products', 'assistant', 'ai']);
  });

  it('has a translated label for every destination in both languages', () => {
    for (const item of NAV) {
      expect(messages.id[item.label].length).toBeGreaterThan(0);
      expect(messages.en[item.label].length).toBeGreaterThan(0);
    }
  });
});
