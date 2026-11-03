import { env } from '../../lib/env';

/**
 * Pages that build their content in the browser (D-099). A plain GET of such a page returns an empty shell, so a price list
 * or a service list is simply not in the HTML. Three steps, cheapest first, and code decides when to go further:
 *  1. `embeddedText`: server-rendered frameworks ship the page data as JSON inside the HTML (Next.js, Nuxt, JSON-LD, state
 *     blobs); the words and prices are already there, only hidden in a script tag.
 *  2. `looksEmpty`: the readable text is too short to be a real page, so the shell needs a real browser.
 *  3. `renderRemote`: a hosted headless browser opens the page and returns it as text. Only the public address leaves the
 *     system (the caller already proved it is a public https address) and no cookie, login or organization data.
 */

const SHELL_MIN_CHARS = 400;
const RENDER_TIMEOUT_S = 15;
const RENDER_MAX_CHARS = 20_000;
const READER_BASE = 'https://r.jina.ai/';

/** Pure: true when the readable text is too thin to be the whole page (an app shell, a "please enable JavaScript" note). */
export function looksEmpty(text: string, html: string): boolean {
  if (text.trim().length < SHELL_MIN_CHARS) return true;
  return /<noscript[^>]*>[^<]*(enable|aktifkan)[^<]*javascript/i.test(html) && text.trim().length < SHELL_MIN_CHARS * 3;
}

const STATE_BLOCKS: RegExp[] = [
  /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  /<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi,
  /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  /window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE|REDUX_STATE)__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi,
];

// A value worth reading: not a url, id, class name, color or build artifact.
const NOISE = /^(https?:\/\/|\/|#|[\w-]+\.(js|css|png|jpe?g|svg|webp)|[a-f0-9-]{16,}$|\d{4}-\d{2}-\d{2}T)/i;

function collect(node: unknown, out: string[], depth: number): void {
  if (out.length > 600 || depth > 12 || node == null) return;
  if (typeof node === 'string') {
    const s = node.replace(/\s+/g, ' ').trim();
    if (s.length >= 3 && s.length <= 400 && !NOISE.test(s) && /[A-Za-z]/.test(s)) out.push(s);
    else if (/^\d{4,}$/.test(s)) out.push(s);
    return;
  }
  if (typeof node === 'number') return;
  if (Array.isArray(node)) return void node.forEach((n) => collect(n, out, depth + 1));
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // The key names the number ("price": 150000 is a price, "id": 150000 is not).
      if (typeof v === 'number') {
        if (/(price|harga|amount|cost|tarif|fee|biaya)/i.test(k)) out.push(`${k}: ${v}`);
      } else collect(v, out, depth + 1);
    }
  }
}

/** Pure: the words and numbers a server-rendered framework put inside script tags, one per line, de-duplicated. */
export const substantial = (text: string): boolean => text.length >= 80 && text.split('\n').length >= 6;

export function embeddedText(html: string): string {
  const out: string[] = [];
  for (const re of STATE_BLOCKS) {
    for (const m of html.matchAll(re)) {
      try {
        collect(JSON.parse(m[1]!), out, 0);
      } catch {
        /* a script that is not plain JSON is skipped */
      }
    }
  }
  return [...new Set(out)].join('\n').slice(0, RENDER_MAX_CHARS);
}

/** Is a hosted browser allowed? On by default; `PAGE_RENDER=off` keeps every page read inside our own server. */
export const renderEnabled = (): boolean => env('PAGE_RENDER') !== 'off' && process.env.NODE_ENV !== 'test';

let override: ((url: string) => Promise<string | null>) | undefined;
/** Tests install a fake renderer; `undefined` goes back to the real one. */
export const setRenderer = (fn: typeof override) => void (override = fn);

/**
 * Opens a public https page in a hosted headless browser and returns what a visitor sees, as text with links kept in
 * `[label](address)` form. Never throws: a slow, blocked or failing render is `null` and the caller says it could not read it.
 * The caller must already have checked that the address is public.
 */
export async function renderRemote(url: string): Promise<string | null> {
  if (override) return override(url);
  if (!renderEnabled()) return null;
  const key = env('PAGE_RENDER_KEY');
  try {
    const res = await fetch(`${READER_BASE}${url}`, {
      headers: {
        accept: 'text/plain',
        'x-engine': 'browser',
        'x-respond-with': 'markdown',
        'x-timeout': String(RENDER_TIMEOUT_S),
        'x-no-cache': 'true',
        ...(key ? { authorization: `Bearer ${key}` } : {}),
      },
      signal: AbortSignal.timeout((RENDER_TIMEOUT_S + 10) * 1000),
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text ? text.slice(0, RENDER_MAX_CHARS) : null;
  } catch {
    return null;
  }
}

/** Pure: rendered markdown links turned into plain anchors, so the same contact and link finders can read them. */
export function markdownToAnchors(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>');
}

// A price as written in Indonesia (Rp 150.000, Rp150rb, IDR 1,5 jt) or a plain per-period figure.
const PRICE = /(?:(?:price|harga|tarif|biaya|amount|cost|fee):\s?\d{4,}|(?:Rp\.?|IDR)\s?\d[\d.,]*(?:\s?(?:rb|ribu|k|jt|juta))?(?:\s?\/\s?(?:bulan|bln|tahun|thn|hari|month|year|day|mo|yr))?)/gi;

/** Pure: the lines of a page that state a price, with their neighbours, so a figure is read together with what it buys. */
export function priceLines(text: string, cap = 40): string[] {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const hit = new Set<number>();
  lines.forEach((l, i) => {
    if (PRICE.test(l)) [i - 2, i - 1, i, i + 1].forEach((j) => j >= 0 && j < lines.length && hit.add(j));
    PRICE.lastIndex = 0;
  });
  return [...hit].sort((a, b) => a - b).map((i) => lines[i]!.slice(0, 200)).slice(0, cap);
}

export const hasPrice = (text: string): boolean => {
  PRICE.lastIndex = 0;
  const found = PRICE.test(text);
  PRICE.lastIndex = 0;
  return found;
};
