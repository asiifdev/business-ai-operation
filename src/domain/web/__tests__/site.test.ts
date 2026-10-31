import { describe, expect, it } from 'vitest';
import { extractContacts, pickLinks, readSite } from '../site';

const HOME = `<html><head><title>Kopi Senja</title>
<script type="application/ld+json">{"@type":"LocalBusiness","telephone":"+62 812-3456-7890","address":{"@type":"PostalAddress","streetAddress":"Jl. Melati 1","addressLocality":"Solo"},"sameAs":["https://www.linkedin.com/company/kopi-senja/"]}</script></head>
<body><a href="/kontak">Kontak</a><a href="/tentang-kami">Tentang</a><a href="/blog/post-1">Blog</a><a href="/logo.png">x</a><a href="https://other.com/contact">luar</a>
<a href="mailto:Halo@KopiSenja.id?subject=hi">mail</a><a href="https://wa.me/6281234567890">wa</a>
<a href="https://www.instagram.com/kopisenja/?hl=id">ig</a><a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a><a href="https://twitter.com/intent/tweet">tweet</a>
<p>Telepon 0812 3456 7890 atau foto@2x.png</p></body></html>`;

describe('extractContacts', () => {
  const c = extractContacts(HOME);
  it('finds e-mail from mailto, lower-cased, without the query and without image-like names', () => {
    expect(c.emails).toEqual(['halo@kopisenja.id']);
  });
  it('finds a phone in the text and in structured data', () => {
    expect(c.phones).toContain('+6281234567890');
    expect(c.phones).toContain('081234567890');
  });
  it('finds WhatsApp, and social profiles without share or intent links', () => {
    expect(c.whatsapp).toEqual(['+6281234567890']);
    expect(c.socials).toEqual({ instagram: ['https://instagram.com/kopisenja'], linkedin: ['https://linkedin.com/company/kopi-senja'] });
  });
  it('does not take a single post or video for the company profile', () => {
    const html = '<a href="https://www.instagram.com/p/Db4mSV2mmIg">p</a><a href="https://www.instagram.com/reel/abc">r</a><a href="https://x.com/acme/status/1">s</a><a href="https://www.instagram.com/kopikenangan.id/">ok</a>';
    expect(extractContacts(html).socials).toEqual({ instagram: ['https://instagram.com/kopikenangan.id'] });
  });
  it('ignores an empty address in structured data', () => {
    expect(extractContacts('<script type="application/ld+json">{"address":"  "}</script>').addresses).toEqual([]);
  });
  it('reads the postal address from structured data', () => {
    expect(c.addresses).toEqual(['Jl. Melati 1, Solo']);
  });
});

describe('pickLinks', () => {
  it('keeps same-site pages that look like contact or company pages, best first, and drops files and other sites', () => {
    expect(pickLinks(new URL('https://kopisenja.id/'), HOME, 5)).toEqual(['https://kopisenja.id/kontak', 'https://kopisenja.id/tentang-kami']);
  });
});

describe('readSite', () => {
  it('reads the home page and the picked pages, merges contacts, and counts pages that failed', async () => {
    const fetch = async (url: string) => {
      if (url.endsWith('/kontak')) return { url, html: '<title>Kontak</title><p>Hubungi sales@kopisenja.id</p>' };
      if (url.endsWith('/tentang-kami')) throw new Error('down');
      return { url: 'https://kopisenja.id/', html: HOME };
    };
    const site = await readSite('https://kopisenja.id', { fetch });
    expect(site.pages.map((p) => p.title)).toEqual(['Kopi Senja', 'Kontak']);
    expect(site.skipped).toBe(1);
    expect(site.contacts.emails).toEqual(['halo@kopisenja.id', 'sales@kopisenja.id']);
  });

  it('does not follow a page on another site', async () => {
    const seen: string[] = [];
    await readSite('https://kopisenja.id', { fetch: async (url) => (seen.push(url), { url, html: HOME }) });
    expect(seen.some((u) => u.includes('other.com'))).toBe(false);
  });
});
