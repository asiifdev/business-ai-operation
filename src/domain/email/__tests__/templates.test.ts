import { describe, expect, it } from 'vitest';
import { render } from '../templates';

const invitation = { template: 'invitation', data: { organizationName: 'Aksara <b>', inviterName: 'Sari "Owner"', role: 'admin', link: 'https://app.test/undangan/abc', expiresInDays: 7, name: 'Budi' } } as const;

describe('email templates (D-096)', () => {
  it('renders the invitation in both languages with subject, html and text', () => {
    const id = render(invitation, 'id');
    expect(id.subject).toContain('mengundang Anda');
    expect(id.text).toContain('https://app.test/undangan/abc');
    expect(id.html).toContain('lang="id"');
    const en = render(invitation, 'en');
    expect(en.subject).toContain('invited you');
    expect(en.html).toContain('lang="en"');
    expect(en.text).toContain('Admin');
  });

  it('escapes everything a person typed, so a name cannot inject markup', () => {
    const { html } = render(invitation, 'id');
    expect(html).not.toContain('<b>');
    expect(html).toContain('Aksara &lt;b&gt;');
    expect(html).toContain('Sari &quot;Owner&quot;');
  });

  it('never carries a password, and the welcome email points at the setup', () => {
    const w = render({ template: 'welcome', data: { name: 'Sari', organizationName: 'Aksara', link: 'https://app.test/app/onboarding' } }, 'en');
    expect(w.text).toContain('https://app.test/app/onboarding');
    expect(`${w.html}${w.text}`).not.toMatch(/password:/i);
  });
});
