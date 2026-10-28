import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { itemsFor, NAV, TAB_LIMIT } from '../../lib/nav';
import { messages } from '../../lib/i18n';
import { AppChrome } from '../shell/AppChrome';

const html = (current?: 'dashboard' | 'assistant' | 'ai', role: 'owner' | 'admin' | 'staff' = 'owner') =>
  renderToStaticMarkup(
    <AppChrome organizationName="Orbit Studio" userName="Rina" role={role} current={current} today="2026-10-28" counts={{ behindDeployments: 3, overdueInvoices: 1, draftsToReview: 2, pendingApprovals: 0 }} />,
  );

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

  it('shows the organization and the person, with the account menu (language, theme, sign out) one click away', () => {
    const out = html();
    expect(out).toContain('Orbit Studio');
    expect(out).toContain('Rina');
    expect(out).toContain(`aria-label="${messages.id.accountMenuOpen}"`);
    expect(out).toContain('aria-expanded="false"'); // closed until opened
  });

  it('puts the search box in the top bar and on the phone, and announces its shortcut', () => {
    const out = html();
    expect(out.match(new RegExp(`aria-label="${messages.id.searchPlaceholder}"`, 'g'))).toHaveLength(2); // wide top bar, phone header
    expect(out).toContain('aria-keyshortcuts="Control+K Meta+K"');
  });

  it('shows the page title and the date in the top bar, and a count of what needs attention on the bell and the products pill', () => {
    const out = html('dashboard');
    expect(out).toContain('Rabu, 28 Oktober 2026');
    expect(out).toContain(messages.id.navDashboard);
    expect(out.match(/aria-label="Buka pemberitahuan, 6"/g)).toHaveLength(2); // 1 overdue + 2 drafts + 3 behind, on the top bar and the phone header
    expect(out).toMatch(/>3<\/span><\/a>/); // the behind-version pill beside Products
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
