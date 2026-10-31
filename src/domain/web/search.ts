import { getAiProvider } from '../../ai';
import type { AiProvider } from '../../ai/provider';
import { webSearchOnce } from '../../ai/run';
import { wrapUntrusted } from '../../ai/untrusted';
import { db } from '../../db/client';
import type { Ctx } from '../ctx';

/**
 * D-085: the assistant may search the public web (Muse Spark `web_search`) to research a prospect, a product or a market, and
 * to find people or companies who might become clients. Only the query leaves the system, so it is checked here, in code:
 * a query with an e-mail address, a money amount or a long number (a phone or account number) is refused, because the model
 * is never trusted to keep client data out of its own query. What comes back is data from outside: wrapped, and a run that
 * used it never acts by itself (D-082).
 */
export const QUERY_MIN = 3;
export const QUERY_MAX = 200;
/** Most searches the model may run for one question. */
export const SEARCHES_PER_QUESTION = 3;

export type SearchRefusal = 'private' | 'quota' | 'ai' | 'empty';
export type SearchResult =
  | { ok: true; answer: string; sources: Array<{ url: string; title: string | null }>; searches: number }
  | { ok: false; reason: SearchRefusal; message: string };

/** Words that must not go out in a search: an e-mail address, a money amount, or a run of 8 or more digits. */
export function leaksPrivateData(query: string): boolean {
  return /\S+@\S+\.\S+/.test(query) || /\b(?:rp|idr|usd)\.?\s*\d/i.test(query) || /\d[\d .-]{6,}\d/.test(query);
}

const INSTRUCTION = 'Jawab dalam bahasa Indonesia, ringkas dan terstruktur. Hanya fakta yang benar-benar ditemukan di sumber; sebut sumbernya, dan katakan "tidak ditemukan" untuk yang tidak ada. Jangan menebak kontak pribadi.';

export async function searchWeb(ctx: Ctx, rawQuery: string, provider: AiProvider = getAiProvider()): Promise<SearchResult> {
  const query = rawQuery.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
  if (query.length < QUERY_MIN) return { ok: false, reason: 'empty', message: 'Kata kunci terlalu pendek.' };
  if (leaksPrivateData(query)) return { ok: false, reason: 'private', message: 'Kueri memuat email, nominal, atau nomor panjang. Pencarian web hanya boleh memakai kata umum seperti nama bisnis, bidang, dan kota.' };
  const out = await webSearchOnce({ db, ctx, provider, inputSummary: `Pencarian web: ${query}`.slice(0, 200), request: { query: `${query}\n\n${INSTRUCTION}`, maxTokens: 4000, maxSearches: SEARCHES_PER_QUESTION } });
  if (!out.ok) return { ok: false, reason: out.kind === 'budget' ? 'quota' : 'ai', message: out.message };
  return { ok: true, answer: wrapUntrusted('hasil pencarian web', out.value.text ?? ''), sources: out.value.sources.slice(0, 8), searches: out.value.searches };
}
