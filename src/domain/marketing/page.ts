import { request } from 'node:https';
import { resolvePublicHost } from '../connections/network';
import { DomainError } from '../errors';

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
export const PAGE_TEXT_CHARS = 3000;

export interface PageFacts {
  url: string;
  title: string | null;
  description: string | null;
  /** The readable text of the page, cut short. A person's page: data, never instructions. */
  text: string;
}

/** One GET to a public https address. The address is validated, then pinned: the connection goes to exactly that address. */
function getOnce(target: URL, pinned: { address: string; family: 4 | 6 }): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      target,
      {
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: { 'user-agent': 'Orbyte-Page/1.0', accept: 'text/html,text/plain;q=0.9' },
        // The name is only used for TLS and the Host header; the socket opens to the address that passed the check.
        lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        const type = String(res.headers['content-type'] ?? '');
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, body: '' });
        }
        if (status < 200 || status >= 300 || !/^(text\/html|text\/plain|application\/xhtml\+xml)/i.test(type)) {
          res.resume();
          return reject(new DomainError('validation', 'page cannot be read'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) return void req.destroy(new DomainError('validation', 'page is too large'));
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new DomainError('validation', 'page took too long')));
    req.on('error', (err) => reject(err instanceof DomainError ? err : new DomainError('validation', 'page cannot be reached')));
    req.end();
  });
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));

const meta = (html: string, name: string) => {
  const tag = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i'))?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).trim() || null : null;
};

/** The title, description and readable text of an HTML page. Scripts, styles and markup are dropped. Pure, so it is easy to test. */
export function readPage(url: string, html: string): PageFacts {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
  return { url, title: title ? decode(title).replace(/\s+/g, ' ').trim() || null : null, description: meta(html, 'description') ?? meta(html, 'og:description'), text: text.slice(0, PAGE_TEXT_CHARS) };
}

/**
 * Reads a web page the person pointed at (D-080). Only public https addresses on the default port: each address is checked
 * against the private-network guard and pinned, redirects are followed a few times and checked again, and the size and time
 * are capped. What comes back is data for the model to read, never instructions.
 */
export async function fetchPage(rawUrl: string): Promise<PageFacts> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DomainError('validation', 'url');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new DomainError('validation', 'url');
    const pinned = await resolvePublicHost(url.hostname);
    const res = await getOnce(url, pinned);
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) throw new DomainError('validation', 'page cannot be read');
      url = new URL(res.location, url);
      continue;
    }
    return readPage(rawUrl, res.body);
  }
  throw new DomainError('validation', 'page redirects too much');
}
