import { parseAnswer, type Run } from '../../lib/answer';
import { detectLocale } from '../../ai/messages';
import type { SpeechLocale } from './provider';

/** Longest text read aloud: a reply is heard in seconds, not minutes. */
export const MAX_SPOKEN_CHARS = 700;

const plain = (runs: Run[]) => runs.map((r) => r.text).join('');
const sentence = (text: string) => (/[.!?…:]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

/**
 * An answer as words to read aloud: no markers, bullets as short sentences, links and code as their plain text, and the
 * language it is written in (Indonesian or English, the two voices). Returns null for an empty answer, and for one longer
 * than `limit` (read whole or not at all: a half-read answer is worse than text).
 */
export function spokenText(answer: string, limit = MAX_SPOKEN_CHARS): { text: string; locale: SpeechLocale } | null {
  const text = parseAnswer(answer)
    .map((block) => (block.kind === 'p' ? sentence(plain(block.runs)) : block.items.map((item) => sentence(plain(item))).join(' ')))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > limit) return null;
  return { text, locale: detectLocale(text, 'id') };
}
