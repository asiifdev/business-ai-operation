/**
 * Text to speech. Meta Model API has none (docs/02 section 4), so spoken replies come from a local engine behind this
 * interface (D-052): the replaceable part, like `AiProvider` is for the models.
 */
export type SpeechLocale = 'id' | 'en';

export interface SpeechProvider {
  /** A Telegram voice note (OGG/Opus) that reads `text` aloud in `locale` (Indonesian or English). */
  synthesize(text: string, locale: SpeechLocale): Promise<{ ogg: Uint8Array; durationMs: number }>;
}
