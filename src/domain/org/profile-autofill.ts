import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { getAiProvider } from '../../ai';
import type { AiProvider } from '../../ai/provider';
import { chatOnce } from '../../ai/run';
import { UNTRUSTED_NOTICE, wrapUntrusted } from '../../ai/untrusted';
import { db } from '../../db/client';
import { orgServices, products } from '../../db/schema';
import type { Ctx } from '../ctx';
import { assertCan } from '../permissions';
import { readSite, type SiteReading } from '../web/site';
import { SOCIAL_KEYS, type SocialKey } from './profile-rules';

/** What the model may write. Contacts are NOT here: code finds those on the pages, so a phone number is never invented. */
const answerSchema = z.object({
  tagline: z.string().max(400),
  industry: z.string().max(300),
  description: z.string().max(4000),
  targetAudience: z.string().max(2500),
  valueProps: z.string().max(2500),
  services: z.array(z.object({ name: z.string().max(300), description: z.string().max(1500) })).max(20),
});
type Answer = z.infer<typeof answerSchema>;

/**
 * Pure: an answer that says something about the company, a description or at least one service. A model can answer the
 * schema with every field empty although the pages describe the company (seen 2026-11-03 in onboarding: the same seven
 * pages filled everything on the next try), so an empty answer counts as a miss, not as a suggestion.
 */
export const answerIsUsable = (a: Pick<Answer, 'description' | 'services'>) => Boolean(a.description.trim()) || a.services.some((s) => s.name.trim().length >= 2);

const text = (maxLength: number, description: string) => ({ type: 'string', maxLength, description });
export const autofillJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tagline', 'industry', 'description', 'targetAudience', 'valueProps', 'services'],
  properties: {
    tagline: text(400, 'One short line about what the company does, from the site. Empty if the site has none.'),
    industry: text(300, 'The field of business in a few words.'),
    description: text(4000, 'About the company in a few sentences: what it does, for whom, how.'),
    targetAudience: text(2500, 'Who the company serves, only if the pages say so.'),
    valueProps: text(2500, 'Strengths and reasons to choose the company, only if the pages say so.'),
    services: {
      type: 'array',
      maxItems: 20,
      items: { type: 'object', additionalProperties: false, required: ['name', 'description'], properties: { name: text(300, 'Name of one service or product'), description: text(1500, 'One or two sentences, from the pages') } },
    },
  },
} as const;

export const autofillInstructions = (language: string) =>
  'You fill in a company profile from the pages of the company\'s own website. ' +
  `${UNTRUSTED_NOTICE} ` +
  `Write in ${language} unless the site is clearly in another language, then use the site's language. ` +
  'Base everything on what the pages say. Never invent a service, a client, a number, an award or a claim that the pages do not support. ' +
  'But do summarise and conclude from the text, do not leave a field empty just because it is not written word for word: ' +
  '- industry: ALWAYS fill it, a short label of the field of business (for example "Software development agency") concluded from what the company does. ' +
  '- tagline: use the site\'s own headline or slogan when there is one; otherwise write one short line (under 100 characters) that says what the company does, using only facts from the pages. ' +
  '- description: three to five factual sentences in the third person: what the company does, for whom and how. ' +
  '- targetAudience: who the company serves, from its clients, case studies, industries or the way the pages address visitors; write it even when the site only implies it. ' +
  '- valueProps: the strengths and reasons to choose the company that the pages show (approach, experience, process, technology, guarantees); one or two sentences or short lines. ' +
  'Leave targetAudience or valueProps empty only when the pages give nothing at all to go on. ' +
  'List the real services or products the company offers, one entry each, without prices; not navigation labels, cookie notices or other firms.';

export interface ProfileSuggestion {
  fields: {
    tagline: string;
    industry: string;
    description: string;
    targetAudience: string;
    valueProps: string;
    website: string;
    contactEmail: string;
    contactPhone: string;
    address: string;
    socials: Partial<Record<SocialKey, string>>;
  };
  services: Array<{ name: string; description: string }>;
  /** Suggested services left out because the organization already lists them (or a product by that name). */
  alreadyListed: string[];
  /** How many pages were read, and their addresses, so the person can see where it came from. */
  sources: string[];
}

/** "Pembuatan Web-App" and "web app" are the same service: compare on letters and digits only. */
export const serviceKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** The same name, or one that contains the other when the shorter is long enough not to match by accident. */
export function sameService(a: string, b: string): boolean {
  const x = serviceKey(a);
  const y = serviceKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short);
}

const clip = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

/** Pure: the facts the pages state outright (found by code), as profile fields. */
export function contactFields(reading: SiteReading): Pick<ProfileSuggestion['fields'], 'website' | 'contactEmail' | 'contactPhone' | 'address' | 'socials'> {
  const c = reading.contacts;
  const socials: Partial<Record<SocialKey, string>> = {};
  for (const key of SOCIAL_KEYS) {
    const url = c.socials[key]?.[0];
    if (url) socials[key] = url.slice(0, 300);
  }
  const phone = c.phones[0] ?? c.whatsapp.find((w) => w.startsWith('+')) ?? '';
  return { website: reading.base, contactEmail: c.emails[0] ?? '', contactPhone: phone, address: clip(c.addresses[0] ?? '', 500), socials };
}

/**
 * Suggests the company profile from a website (D-095). Code reads the pages (home or the given page plus the about,
 * services, contact and similar pages on the same site) and finds the contacts itself; the model only writes the
 * descriptive parts from that text, and an empty or unreadable answer is asked once more with more reasoning. Nothing is
 * saved: the person edits the suggestion and saves it like any form.
 */
export async function suggestProfileFromSite(
  ctx: Ctx,
  raw: unknown,
  opts: { provider?: AiProvider; locale?: 'id' | 'en'; reader?: typeof readSite } = {},
): Promise<(ProfileSuggestion & { ok: true; runId: string }) | { ok: false; message: string }> {
  assertCan(ctx, 'org.profile.update');
  const { url } = z.object({ url: z.string().trim().min(4).max(300) }).parse(raw);
  const reading = await (opts.reader ?? readSite)(/^https?:\/\//i.test(url) ? url : `https://${url}`, { maxPages: 8, pageChars: 6000 });

  const locale = opts.locale ?? 'id';
  const nothingFound = locale === 'id'
    ? 'AI tidak menemukan deskripsi atau layanan perusahaan di halaman yang dibaca. Coba lagi, tempel alamat halaman Tentang atau company profile, atau isi manual.'
    : 'The AI found no company description or services on the pages it read. Try again, paste the address of the About or company-profile page, or fill it in by hand.';
  // Pages without text give the model nothing to write from: no call is spent on them.
  if (!reading.pages.some((p) => p.text.trim())) return { ok: false, message: nothingFound };

  const pages = reading.pages.map((p) => wrapUntrusted(p.url, [p.title, p.text].filter(Boolean).join('\n'))).join('\n\n');
  const provider = opts.provider ?? getAiProvider();
  const ask = (retry: boolean) =>
    chatOnce({
      db,
      ctx,
      provider,
      locale,
      feature: 'agent',
      inputSummary: `Isi profil dari ${reading.base} (${reading.pages.length} halaman)${retry ? ', diulang' : ''}`.slice(0, 300),
      entityType: 'organization',
      entityId: ctx.orgId,
      request: {
        messages: [
          { role: 'developer', content: autofillInstructions(locale === 'id' ? 'Indonesian' : 'English') },
          { role: 'user', content: pages },
        ],
        schema: { name: 'company_profile', schema: autofillJsonSchema as unknown as Record<string, unknown>, strict: true },
        // The second try reasons more; reasoning shares the output budget, so it gets more room too.
        effort: retry ? 'medium' : 'low',
        maxTokens: retry ? 8000 : 4000,
      },
    });

  // An empty or unreadable answer is asked once more (both calls are in ai_runs). Still nothing: a plain message, never
  // an empty suggestion that looks like the site has nothing to say.
  let a: Answer | null = null;
  let runId = '';
  let unreadable = false;
  for (const retry of [false, true]) {
    const out = await ask(retry);
    // A model that is down or over budget is told plainly; the form stays usable by hand.
    if (!out.ok) return { ok: false, message: out.message };
    let json: unknown = out.value.json;
    if (json === undefined && out.value.text) json = (() => { try { return JSON.parse(out.value.text!); } catch { return undefined; } })();
    const parsed = answerSchema.safeParse(json);
    unreadable = !parsed.success;
    if (parsed.success && answerIsUsable(parsed.data)) {
      a = parsed.data;
      runId = out.runId;
      break;
    }
  }
  if (!a) return { ok: false, message: unreadable ? (locale === 'id' ? 'Jawaban AI belum bisa dibaca. Coba lagi atau isi manual.' : 'The AI answer could not be read. Try again or fill it in by hand.') : nothingFound };

  // A second run must not offer what is already there: the services on the profile and the products in Portfolio count.
  const [have, prods] = await Promise.all([
    db.select({ name: orgServices.name }).from(orgServices).where(eq(orgServices.orgId, ctx.orgId)),
    db.select({ name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))),
  ]);
  const known = [...have, ...prods].map((r) => r.name);
  const services: ProfileSuggestion['services'] = [];
  const alreadyListed: string[] = [];
  for (const s of a.services.map((x) => ({ name: clip(x.name, 120), description: clip(x.description, 600) }))) {
    if (s.name.length < 2) continue;
    if (known.some((k) => sameService(k, s.name))) alreadyListed.push(s.name);
    else if (!services.some((o) => sameService(o.name, s.name))) services.push(s);
  }
  services.splice(12);

  return {
    ok: true,
    fields: {
      tagline: clip(a.tagline, 160),
      industry: clip(a.industry, 120),
      description: a.description.trim().slice(0, 2000),
      targetAudience: a.targetAudience.trim().slice(0, 1000),
      valueProps: a.valueProps.trim().slice(0, 1000),
      ...contactFields(reading),
    },
    services,
    alreadyListed,
    sources: reading.pages.map((p) => p.url),
    runId,
  };
}
