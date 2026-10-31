import { DomainError } from '../errors';
import { fetchHtml, readPage } from '../marketing/page';

/**
 * Reads a whole website from its base address (D-084). Code does the finding: it opens the home page, follows the few links
 * that usually hold contact and company information (same site only), and pulls out e-mail addresses, phone numbers,
 * WhatsApp links, social profiles and postal addresses itself. The model only reads the result and answers; it never
 * invents a contact. Every fetch goes through the guarded page reader (public https only, pinned address, size and time caps).
 */

const MAX_PAGES = 8;
const PAGE_CHARS = 2500;

export interface SiteContacts {
  emails: string[];
  phones: string[];
  whatsapp: string[];
  /** Platform name to profile addresses, at most three each. */
  socials: Record<string, string[]>;
  /** Free text from the site's structured data: untrusted, wrap before showing to the model. */
  addresses: string[];
}

export interface SitePage {
  url: string;
  title: string | null;
  text: string;
}

export interface SiteReading {
  base: string;
  pages: SitePage[];
  contacts: SiteContacts;
  /** Pages that were meant to be read but could not be. */
  skipped: number;
}

// Only ever written into the answer as a link the person can click; the server never connects to these (see tests/data-practices).
const WA_SHORT = 'wa.me';
const WA_GROUP = 'chat.whatsapp.com';
const FILE_LIKE = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|map|woff2?|ttf|pdf|zip|mp4|mp3)$/i;
const PLATFORMS: Array<[string, RegExp]> = [
  ['instagram', /(^|\.)instagram\.com$/],
  ['linkedin', /(^|\.)linkedin\.com$/],
  ['facebook', /(^|\.)(facebook|fb)\.com$/],
  ['x', /(^|\.)(x|twitter)\.com$/],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['tiktok', /(^|\.)tiktok\.com$/],
  ['github', /(^|\.)github\.com$/],
  ['threads', /(^|\.)threads\.net$/],
  ['telegram', /(^|\.)t\.me$/],
];
// Share buttons, log-in pages and single posts are not the company's own profile.
const NOT_A_PROFILE = /(sharer|share|intent|dialog|plugins|login|signup|hashtag|search|\/p\/|\/reels?\/|\/tv\/|stories|explore|\/status\/|\/posts?\/|\/watch|\/shorts\/|\/video\/|\/photos?\/|\/feed\/|\/pulse\/)/i;
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;|&#47;/gi, '/');

const unique = (list: string[], cap: number) => [...new Set(list)].slice(0, cap);

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => decode((m[1] ?? m[2] ?? '').trim())).filter(Boolean);
}

function visibleText(html: string): string {
  return html.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
}

function socialOf(raw: string): { platform: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const found = PLATFORMS.find(([, re]) => re.test(host));
  if (!found || NOT_A_PROFILE.test(u.pathname) || u.pathname.replace(/\//g, '') === '') return null;
  return { platform: found[0], url: `https://${host.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}` };
}

/** Structured data (`application/ld+json`) often names the address, phone, e-mail and `sameAs` profiles outright. */
function structuredData(html: string): { emails: string[]; phones: string[]; sameAs: string[]; addresses: string[] } {
  const out = { emails: [] as string[], phones: [] as string[], sameAs: [] as string[], addresses: [] as string[] };
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    const walk = (node: unknown, depth: number) => {
      if (depth > 6 || !node || typeof node !== 'object') return;
      if (Array.isArray(node)) return void node.forEach((n) => walk(n, depth + 1));
      const o = node as Record<string, unknown>;
      if (typeof o.email === 'string') out.emails.push(o.email.replace(/^mailto:/i, ''));
      if (typeof o.telephone === 'string') out.phones.push(o.telephone);
      const same = o.sameAs;
      if (typeof same === 'string') out.sameAs.push(same);
      else if (Array.isArray(same)) same.forEach((s) => typeof s === 'string' && out.sameAs.push(s));
      const addr = o.address;
      if (typeof addr === 'string') addr.trim() && out.addresses.push(addr.trim());
      else if (addr && typeof addr === 'object') {
        const a = addr as Record<string, unknown>;
        const line = ['streetAddress', 'addressLocality', 'addressRegion', 'postalCode', 'addressCountry'].map((k) => (typeof a[k] === 'string' ? (a[k] as string) : '')).filter(Boolean).join(', ');
        if (line) out.addresses.push(line);
      }
      Object.values(o).forEach((v) => walk(v, depth + 1));
    };
    walk(data, 0);
  }
  return out;
}

const digits = (s: string) => s.replace(/[^\d+]/g, '');

/** Pure: everything contact-like that one HTML page states. */
export function extractContacts(html: string): SiteContacts {
  const links = hrefs(html);
  const text = visibleText(html);
  const ld = structuredData(html);

  const emails = [
    ...links.filter((h) => /^mailto:/i.test(h)).map((h) => h.slice(7).split('?')[0]!),
    ...(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g) ?? []),
    ...ld.emails,
  ]
    .map((e) => decodeURIComponent(e).trim().toLowerCase())
    .filter((e) => /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(e) && !FILE_LIKE.test(e) && !/(example\.|sentry|wixpress|@2x|@3x)/.test(e));

  const phones = [
    ...links.filter((h) => /^tel:/i.test(h)).map((h) => digits(decodeURIComponent(h.slice(4)))),
    ...(text.match(/(?:\+62|\b62|\b0)\s?8\d{1,3}[\s.-]?\d{3,4}[\s.-]?\d{2,5}\b/g) ?? []).map(digits),
    ...ld.phones.map(digits),
  ].filter((p) => p.replace(/\D/g, '').length >= 8 && p.replace(/\D/g, '').length <= 15);

  const whatsapp = links
    .map((h) => {
      const wa = h.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?(?:[^"#]*&)?phone=|chat\.whatsapp\.com\/)([A-Za-z0-9]+)/i);
      return wa ? (/chat\.whatsapp/i.test(h) ? `https://${WA_GROUP}/${wa[1]}` : /^\d+$/.test(wa[1]!) ? `+${wa[1]}` : `https://${WA_SHORT}/${wa[1]}`) : null;
    })
    .filter((v): v is string => Boolean(v));

  const socials: Record<string, string[]> = {};
  for (const raw of [...links, ...ld.sameAs]) {
    const s = socialOf(raw);
    if (!s) continue;
    socials[s.platform] = unique([...(socials[s.platform] ?? []), s.url], 3);
  }

  return { emails: unique(emails, 10), phones: unique(phones, 10), whatsapp: unique(whatsapp, 5), socials, addresses: unique(ld.addresses, 3) };
}

const KEYWORDS: Array<[RegExp, number]> = [
  [/kontak|contact|hubungi|reach|get-in-touch/, 10],
  [/tentang|about|profil|company|perusahaan|siapa/, 8],
  [/layanan|service|solusi|solution|produk|product/, 6],
  [/tim|team|people|karir|career/, 4],
  [/portofolio|portfolio|proyek|project|klien|client/, 3],
];

/** Pure: the same-site links most likely to hold contact and company facts, best first, home page excluded. */
export function pickLinks(base: URL, html: string, limit: number): string[] {
  const host = (h: string) => h.toLowerCase().replace(/^www\./, '');
  const scored = new Map<string, number>();
  for (const raw of hrefs(html)) {
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:' || host(u.hostname) !== host(base.hostname) || FILE_LIKE.test(u.pathname)) continue;
    u.hash = '';
    u.search = '';
    const path = u.pathname.replace(/\/$/, '') || '/';
    if (path === '/' || path === (base.pathname.replace(/\/$/, '') || '/')) continue;
    const key = `${u.origin}${path}`;
    const score = KEYWORDS.reduce((sum, [re, w]) => sum + (re.test(path.toLowerCase()) ? w : 0), 0);
    if (score > 0 && !scored.has(key)) scored.set(key, score);
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}

const merge = (all: SiteContacts[]): SiteContacts => {
  const socials: Record<string, string[]> = {};
  for (const c of all) for (const [k, v] of Object.entries(c.socials)) socials[k] = unique([...(socials[k] ?? []), ...v], 3);
  return {
    emails: unique(all.flatMap((c) => c.emails), 10),
    phones: unique(all.flatMap((c) => c.phones), 10),
    whatsapp: unique(all.flatMap((c) => c.whatsapp), 5),
    socials,
    addresses: unique(all.flatMap((c) => c.addresses), 3),
  };
};

export async function readSite(rawUrl: string, opts: { maxPages?: number; fetch?: typeof fetchHtml } = {}): Promise<SiteReading> {
  const get = opts.fetch ?? fetchHtml;
  const maxPages = Math.min(Math.max(opts.maxPages ?? 6, 1), MAX_PAGES);
  const home = await get(rawUrl);
  const base = new URL(home.url);
  const pages: SitePage[] = [];
  const contacts: SiteContacts[] = [extractContacts(home.html)];
  const homeFacts = readPage(home.url, home.html);
  pages.push({ url: home.url, title: homeFacts.title, text: homeFacts.text.slice(0, PAGE_CHARS) });

  const next = pickLinks(base, home.html, maxPages - 1);
  const results = await Promise.allSettled(next.map((u) => get(u)));
  let skipped = 0;
  results.forEach((r) => {
    if (r.status !== 'fulfilled') {
      skipped += 1;
      return;
    }
    contacts.push(extractContacts(r.value.html));
    const facts = readPage(r.value.url, r.value.html);
    pages.push({ url: r.value.url, title: facts.title, text: facts.text.slice(0, PAGE_CHARS) });
  });
  if (pages.every((p) => !p.text) && !contacts.some((c) => c.emails.length || c.phones.length)) throw new DomainError('validation', 'page cannot be read');
  return { base: base.origin, pages, contacts: merge(contacts), skipped };
}
