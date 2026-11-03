import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { messages } from '../../lib/i18n';
import { CompanyProfileEditor, type CompanyData } from '../settings/CompanyProfilePage';

const m = messages.id;
const data: CompanyData = {
  profile: { name: 'Orbit Studio', tagline: null, namePronunciation: null, description: null, industry: null, website: null, contactEmail: null, contactPhone: null, address: null, socials: {}, targetAudience: null, valueProps: null, hasLogo: false },
  services: [{ id: 's1', name: 'Custom Web Application', description: 'Aplikasi web sesuai proses bisnis' }],
};
const render = (step: boolean) =>
  renderToStaticMarkup(<CompanyProfileEditor data={data} canEdit onChanged={() => undefined} step={step ? { onSaved: async () => undefined } : undefined} />);

/** Where the profile form ends (it is the first form and holds no other) and the submit button that names it. */
function layout(out: string) {
  const id = /<form id="([^"]+)"/.exec(out)?.[1] ?? '';
  const button = new RegExp(`<button type="submit"[^>]*form="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`).exec(out);
  return { formEnd: out.indexOf('</form>'), button: button?.[0] ?? '', buttonAt: button?.index ?? -1 };
}
const PANEL = 'bg-key-face p-4 shadow-card sm:p-5'; // the Panel surface (inputs share shadow-card, not this)
const REQUIRED = ` (${m.required})</span>`;

describe('company profile editor: one component for the settings page and the onboarding step (D-095)', () => {
  it('gives the onboarding step everything the settings page has: autofill, logo, pronunciation, social media and services', () => {
    for (const out of [render(false), render(true)]) {
      for (const text of [m.afTitle, m.companyLogo, m.companyPronunciation, 'Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'Custom Web Application', m.companyServiceAdd]) {
        expect(out).toContain(text);
      }
    }
  });

  it('in a step: no panel inside the step panel, business field and description needed, one save-and-continue after the services', () => {
    const out = render(true);
    const { formEnd, button, buttonAt } = layout(out);
    expect(out).not.toContain(PANEL);
    expect(out.split(REQUIRED)).toHaveLength(4); // field of business, description, and the service name
    expect(button).toContain('disabled=""'); // both still empty
    expect(buttonAt).toBeGreaterThan(formEnd); // outside the profile form, bound to it by `form`
    expect(buttonAt).toBeGreaterThan(out.indexOf('Custom Web Application'));
    expect(out.slice(buttonAt)).toContain(m.obSaveNext);
  });

  it('on the settings page: sections are panels and the save button stays in the profile form', () => {
    const out = render(false);
    const { formEnd, button, buttonAt } = layout(out);
    expect(out.split(PANEL).length - 1).toBeGreaterThanOrEqual(4); // identity, contact, customers, services
    expect(out.split(REQUIRED)).toHaveLength(2); // only the service name
    expect(button).not.toContain('disabled=""');
    expect(buttonAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeLessThan(formEnd);
    expect(out.slice(buttonAt)).toContain(m.companySave);
  });
});
