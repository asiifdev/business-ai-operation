import type { Db } from '../db/client';
import type { Ctx } from '../domain/ctx';
import { respellForSpeech } from '../integrations/speech/lexicon';
import { chatOnce } from './run';
import type { AiProvider } from './provider';
import { getAiProvider } from './index';

const instructions = (organizationName: string) =>
  [
    'Anda menyiapkan teks untuk dibacakan mesin suara berbahasa Indonesia. Mesin itu membaca setiap kata dengan ejaan Indonesia, jadi kata Inggris harus ditulis seperti orang Indonesia mengucapkannya (ejaan lisan).',
    'Aturan:',
    '1. Kata atau frasa Inggris ditulis dengan ejaan lisan Indonesia. Contoh: generate image menjadi "generet imej", invoice menjadi "invois", deadline menjadi "dedlain", agency menjadi "ejensi", follow up menjadi "folo ap", email menjadi "imel".',
    `2. Nama organisasi, merek, dan singkatan ditulis seperti diucapkan, tidak dieja huruf per huruf dan tidak huruf kapital semua. Nama organisasi ini: "${organizationName}". Contoh: ASIIFDEV DIGITAL AGENCY menjadi "asif dev digital ejensi".`,
    '3. Jangan mengubah makna. Jangan menambah atau mengurangi informasi, dan jangan mengubah angka, nama orang, atau nama klien. Kata Indonesia dibiarkan apa adanya.',
    '4. Keluarkan hanya teks hasilnya, satu paragraf, tanpa tanda markdown dan tanpa penjelasan.',
  ].join('\n');

const digits = (text: string) => text.replace(/\D+/g, ' ').trim();

/**
 * The words of an answer as they should sound (D-052). A model rewrites the English in it with Indonesian spelling, which a
 * word list can never cover. The rewrite is only for the ear: it is refused (and the plain word list used instead) when it
 * changes a number, comes back empty or much longer, or the call fails. So a spoken answer can never carry a figure the
 * written answer did not have.
 */
export async function toSpokenIndonesian(input: { db: Db; ctx: Ctx; text: string; organizationName: string; provider?: AiProvider }): Promise<string> {
  const fallback = respellForSpeech(input.text);
  const out = await chatOnce({
    db: input.db,
    ctx: input.ctx,
    provider: input.provider ?? getAiProvider(),
    locale: 'id',
    feature: 'agent',
    inputSummary: 'Penulisan ulang untuk dibacakan (ejaan lisan)',
    request: {
      messages: [
        { role: 'developer', content: instructions(input.organizationName) },
        { role: 'user', content: input.text },
      ],
      effort: 'low',
      maxTokens: 1200,
      cacheKey: 'orbyte-spoken-v1',
    },
  }).catch(() => null);
  const spoken = out?.ok ? (out.value.text ?? '').replace(/\s+/g, ' ').trim() : '';
  if (!spoken || spoken.length > input.text.length * 1.8 + 40 || spoken.length < input.text.length * 0.4) return fallback;
  // Every figure must come through exactly as written: none added, dropped, spelled out or changed.
  if (digits(spoken) !== digits(input.text)) return fallback;
  return respellForSpeech(spoken);
}
