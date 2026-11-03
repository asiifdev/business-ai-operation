import { describe, expect, it } from 'vitest';
import { contactFields, sameService } from '../profile-autofill';
import { extractContacts } from '../../web/site';

describe('profile autofill (D-095)', () => {
  it('takes contacts and social links straight from the page, never from the model', () => {
    const html = `<a href="mailto:Halo@Aksara.id">m</a> <a href="tel:+6281234567890">t</a>
      <a href="https://www.instagram.com/aksara.dev/">i</a><a href="https://linkedin.com/company/aksara">l</a>
      <script type="application/ld+json">{"@type":"Organization","address":{"streetAddress":"Jl. Merdeka 1","addressLocality":"Bandung"}}</script>`;
    const f = contactFields({ base: 'https://aksara.id', pages: [], skipped: 0, rendered: 0, contacts: extractContacts(html) });
    expect(f).toMatchObject({ website: 'https://aksara.id', contactEmail: 'halo@aksara.id', contactPhone: '+6281234567890', address: 'Jl. Merdeka 1, Bandung' });
    expect(f.socials).toEqual({ instagram: 'https://instagram.com/aksara.dev', linkedin: 'https://linkedin.com/company/aksara' });
  });

  it('keeps an unknown network out of the profile', () => {
    const f = contactFields({ base: 'https://a.id', pages: [], skipped: 0, rendered: 0, contacts: { emails: [], phones: [], whatsapp: [], socials: { github: ['https://github.com/a'] }, addresses: [] } });
    expect(f.socials).toEqual({});
    expect(f.contactEmail).toBe('');
  });
});

describe('service uniqueness on autofill', () => {
  it('treats case, spacing and punctuation as the same service', () => {
    expect(sameService('Web App', 'web-app')).toBe(true);
    expect(sameService('Pembuatan Web App', 'web app')).toBe(true);
    expect(sameService('Desain UI', 'UI')).toBe(false); // a very short name is not enough to call two services the same
    expect(sameService('Pembuatan Website', 'Website')).toBe(true);
    expect(sameService('Konsultasi IT', 'Desain UI')).toBe(false);
    expect(sameService('', 'x')).toBe(false);
  });
});
