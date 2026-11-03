import { DomainError } from '../errors';
import { fetchHtml, readPage } from '../marketing/page';
import { embeddedText, substantial, hasPrice, looksEmpty, markdownToAnchors, priceLines, renderRemote } from './render';

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
  /** Pages whose content only appeared after a real browser opened them (D-099). */
  rendered: number;
  /** Only when asked for prices: what the pages state, and the extra addresses that were tried. */
  pricing?: { found: boolean; lines: string[]; tried: string[] };
}

export type SiteFocus = 'general' | 'pricing';

/** Addresses where price lists usually live, tried when the pages that were linked did not show a price. */
export const PRICING_PATHS = ['/pricing', '/harga', '/paket', '/price', '/plans', '/tarif', '/biaya', '/daftar-harga', '/paket-harga', '/pricelist'];
const PRICING_WORDS = /harga|pricing|price|paket|package|plans?\b|tarif|biaya/;
const MAX_RENDERS = 3;

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
export function pickLinks(base: URL, html: string, limit: number, focus: SiteFocus = 'general'): string[] {
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
    const lower = path.toLowerCase();
    const score = KEYWORDS.reduce((sum, [re, w]) => sum + (re.test(lower) ? w : 0), 0) + (PRICING_WORDS.test(lower) ? (focus === 'pricing' ? 20 : 5) : 0);
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

interface Loaded {
  url: string;
  html: string;
  title: string | null;
  text: string;
  rendered: boolean;
  prices: string[];
}

/**
 * One page, read as a visitor sees it. The plain GET comes first; when its text is only an app shell the data the
 * framework embedded is read, and when that is still thin (or a price page shows no price) a real browser renders it.
 */
async function loadPage(get: typeof fetchHtml, url: string, pageChars: number, focus: SiteFocus, budget: { renders: number }): Promise<Loaded> {
  const raw = await get(url);
  const facts = readPage(raw.url, raw.html, 20_000);
  let text = facts.text;
  let html = raw.html;
  let rendered = false;
  // Framework state counts as the page only when it is substantial; a few stray strings are not a price list.
  const embedded = looksEmpty(text, raw.html) ? embeddedText(raw.html) : '';
  if (substantial(embedded)) text = `${text} ${embedded}`.trim();
  const pricePage = focus === 'pricing' && PRICING_WORDS.test(new URL(raw.url).pathname.toLowerCase());
  const thin = looksEmpty(text, raw.html) && !substantial(embedded);
  if ((thin || (pricePage && !hasPrice(text))) && budget.renders > 0) {
    budget.renders -= 1;
    const md = await renderRemote(raw.url);
    if (md && md.length > text.length / 2) {
      text = md;
      html = `${raw.html}\n${markdownToAnchors(md)}`;
      rendered = true;
    }
  }
  return { url: raw.url, html, title: facts.title, text: text.slice(0, pageChars), rendered, prices: priceLines(text) };
}

export async function readSite(rawUrl: string, opts: { maxPages?: number; pageChars?: number; focus?: SiteFocus; fetch?: typeof fetchHtml } = {}): Promise<SiteReading> {
  const get = opts.fetch ?? fetchHtml;
  const focus = opts.focus ?? 'general';
  const pageChars = Math.min(Math.max(opts.pageChars ?? (focus === 'pricing' ? 6000 : PAGE_CHARS), 500), 8000);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 6, 1), MAX_PAGES);
  const budget = { renders: MAX_RENDERS };
  const home = await loadPage(get, rawUrl, pageChars, focus, budget);
  const base = new URL(home.url);
  const loaded: Loaded[] = [home];
  let skipped = 0;

  const next = pickLinks(base, home.html, maxPages - 1, focus);
  const results = await Promise.allSettled(next.map((u) => loadPage(get, u, pageChars, focus, budget)));
  results.forEach((r) => (r.status === 'fulfilled' ? loaded.push(r.value) : void (skipped += 1)));

  // A price page nobody linked to, or whose link only exists after JavaScript ran: ask for the usual addresses before giving up.
  const tried: string[] = [];
  if (focus === 'pricing' && !loaded.some((p) => hasPrice(p.text))) {
    const seen = new Set(loaded.map((p) => new URL(p.url).pathname.replace(/\/$/, '') || '/'));
    const guesses = PRICING_PATHS.filter((p) => !seen.has(p)).map((p) => `${base.origin}${p}`);
    const probes = await Promise.allSettled(guesses.map((u) => loadPage(get, u, pageChars, focus, budget)));
    probes.forEach((r, i) => {
      tried.push(guesses[i]!);
      if (r.status === 'fulfilled' && (r.value.text.length > 200 || hasPrice(r.value.text))) loaded.push(r.value);
    });
  }

  const contacts = merge(loaded.map((p) => extractContacts(p.html)));
  const pages: SitePage[] = loaded.map((p) => ({ url: p.url, title: p.title, text: p.text }));
  if (pages.every((p) => !p.text) && !(contacts.emails.length || contacts.phones.length)) throw new DomainError('validation', 'page cannot be read');
  const prices = [...new Set(loaded.flatMap((p) => p.prices))].slice(0, 60);
  return {
    base: base.origin,
    pages,
    contacts,
    skipped,
    rendered: loaded.filter((p) => p.rendered).length,
    ...(focus === 'pricing' ? { pricing: { found: prices.length > 0, lines: prices, tried } } : {}),
  };
}
