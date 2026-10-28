import type { AiErrorKind } from './errors';

export type Locale = 'id' | 'en';

/** Shown next to every AI result (BR-M07-11, CR-13). */
export const AI_LABEL: Record<Locale, string> = { id: 'dibantu AI', en: 'AI-assisted' };
/** Shown instead when the AI could not answer, so a plain number or message is never mistaken for an AI result. */
export const NOT_AI_LABEL: Record<Locale, string> = { id: 'ini bukan hasil AI', en: 'this is not an AI result' };

const FRIENDLY: Record<AiErrorKind, Record<Locale, string>> = {
  budget: { id: 'Anggaran AI harian untuk fitur ini sudah habis. Fitur lain tetap berjalan, dan anggaran terisi lagi besok.', en: "Today's AI budget for this feature is used up. Everything else still works, and the budget resets tomorrow." },
  rate_limited: { id: 'Layanan AI sedang sibuk. Coba lagi sebentar lagi.', en: 'The AI service is busy. Please try again in a moment.' },
  unavailable: { id: 'Layanan AI sedang tidak tersedia. Coba lagi nanti.', en: 'The AI service is unavailable. Please try again later.' },
  timeout: { id: 'Layanan AI terlalu lama menjawab. Coba lagi dengan permintaan yang lebih kecil.', en: 'The AI service took too long. Try again with a smaller request.' },
  content_policy: { id: 'Permintaan ini ditolak oleh kebijakan konten layanan AI. Ubah isinya lalu coba lagi.', en: 'The AI service declined this request under its content policy. Change it and try again.' },
  auth: { id: 'Layanan AI belum dikonfigurasi dengan benar. Hubungi pemilik organisasi.', en: 'The AI service is not set up correctly. Contact the organization owner.' },
  config: { id: 'Layanan AI belum dikonfigurasi dengan benar. Hubungi pemilik organisasi.', en: 'The AI service is not set up correctly. Contact the organization owner.' },
  empty: { id: 'AI tidak menghasilkan jawaban. Coba lagi.', en: 'The AI did not produce an answer. Please try again.' },
  invalid_output: { id: 'Jawaban AI tidak bisa dipakai. Coba lagi.', en: 'The AI answer could not be used. Please try again.' },
  bad_request: { id: 'Permintaan ke AI tidak valid.', en: 'The request to the AI was not valid.' },
  not_found: { id: 'Model AI tidak ditemukan.', en: 'The AI model was not found.' },
  too_large: { id: 'Permintaan terlalu besar untuk AI.', en: 'The request is too large for the AI.' },
};

export function friendlyAiError(kind: AiErrorKind, locale: Locale = 'id'): string {
  return FRIENDLY[kind][locale];
}
