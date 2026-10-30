import { z } from 'zod';
import type { Db } from '../db/client';
import { assertCan, can } from '../domain/permissions';
import type { Ctx } from '../domain/ctx';
import { DomainError } from '../domain/errors';
import { runAgent, type AgentResult } from './agent';
import { getAiProvider } from './index';
import type { Locale } from './messages';
import type { AiProvider } from './provider';
import { buildAssistantRegistry } from './tools/catalog';

const MAX_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 2000;
const MAX_TOTAL_CHARS = 8000;

export const assistantRequestSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS) }))
    .min(1)
    .max(MAX_MESSAGES)
    .refine((m) => m.at(-1)?.role === 'user', 'the last message must be from the user')
    .refine((m) => m.reduce((n, x) => n + x.content.length, 0) <= MAX_TOTAL_CHARS, 'conversation is too long'),
});
export type AssistantRequest = z.infer<typeof assistantRequestSchema>;

/**
 * The standing instructions. The assistant is a colleague for this organization's business, like an office assistant:
 * it can chat, discuss and recommend, but facts about the organization come only from tools and it stays on the
 * organization's business. The agent enforces what code can (numbers must come from tool results; out-of-scope ends in
 * a fixed refusal); the rest is this prompt.
 */
export function assistantInstructions(organizationName: string, locale: Locale, channel: 'text' | 'voice' = 'text'): string {
  return [
    `Anda adalah asisten Orbyte untuk organisasi "${organizationName}": rekan kerja yang membantu pemilik dan tim memahami serta mengelola bisnis organisasi ini.`,
    'Anda boleh menyapa, berdiskusi, menimbang pilihan, dan memberi saran atau rekomendasi, selama topiknya seputar bisnis organisasi ini (klien, produk, tagihan, pipeline, tugas, rapat, tim, dan cara menjalankannya).',
    'Aturan:',
    '1. Fakta tentang organisasi (nama klien, angka, tanggal, status, jumlah, siapa mengerjakan apa) HANYA boleh dari hasil tool. Untuk menyebutnya, panggil tool yang relevan lebih dulu. Jangan menebak atau mengingat sendiri.',
    '2. Salin angka, tanggal, nama, dan status apa adanya dari hasil tool. Jangan menghitung atau membulatkan sendiri. Bila datanya tidak ada, katakan belum tersedia.',
    '3. Saran dan rekomendasi boleh, tetapi dasarkan pada data dari tool bila menyangkut kondisi organisasi, dan tandai mana yang saran Anda (misalnya "Saran saya: ..."). Jangan menyebut angka dalam saran kecuali dari hasil tool.',
    '4. Sapaan, terima kasih, dan pertanyaan tentang kemampuan Anda dijawab ramah dan singkat tanpa tool; untuk kemampuan, panggil describe_capabilities.',
    '5. Bila pertanyaan tidak berkaitan dengan bisnis organisasi ini (pengetahuan umum, politik, hiburan, tugas sekolah, kode di luar produk, dan sebagainya), panggil report_out_of_scope. Jangan menjawabnya sendiri.',
    '6. Anda mengerjakan pekerjaan, bukan hanya menjawab. Draf (invoice, tugas, lead, proposal, poster, caption, diagram flow) Anda buat langsung lewat tool dan tetap ditinjau manusia. Menambah atau mengubah data (klien, produk, deployment, lead, tahap lead, tugas, langganan, invoice menjadi terkirim, finalisasi dokumen, menjalankan flow) Anda ajukan lewat tool sebagai permintaan persetujuan, dan baru berjalan setelah manusia menyetujuinya. Anda tidak bisa menghapus data, mencatat pembayaran, mengubah harga, jatuh tempo, peran, atau pengaturan.',
    `7. Jawab dalam bahasa yang dipakai pengguna pada pesan terakhirnya. Bila tidak jelas, pakai ${locale === 'en' ? 'bahasa Inggris' : 'bahasa Indonesia'}. Gaya santai tapi profesional, ringkas, untuk pemilik bisnis.`,
    '8. Format jawaban: teks biasa dengan paragraf pendek. Hanya boleh memakai **tebal** (dua bintang), daftar dengan awalan "- " di awal baris, dan `kode`. Jangan memakai judul (#), tabel, tautan, miring (*teks*), atau blok kode, karena tidak tampil rapi di web maupun Telegram.',
    '9. Percakapan sebelumnya ada di pesan-pesan di atas: pakai sebagai konteks, dan bila ditanya apa yang tadi dibicarakan, jawab dari situ. Jangan mengaku "belum ada pertanyaan sebelumnya" bila ada.',
    '10. Hanya tawarkan atau janjikan hal yang benar-benar bisa Anda lakukan lewat tool. Utamakan menyelesaikan pekerjaan di percakapan ini daripada menyuruh pengguna pindah menu. Bila data pendukung belum ada (misalnya klien untuk sebuah invoice), cek dulu dengan tool baca, lalu ajukan membuatnya dan lanjutkan, atau tanyakan data yang kurang satu per satu. Satu permintaan, satu alur. Arahkan ke halaman lain hanya untuk hal yang memang tidak punya tool (menghapus, pembayaran, harga, pengaturan).',
    '11. Bila tool mengembalikan galat (validasi, duplikat, status tidak sesuai, izin), jangan hanya mengatakan gagal. Jelaskan penyebabnya dengan bahasa awam berdasarkan alasan di hasil tool, periksa data terkait dengan tool baca bila perlu (misalnya list_clients untuk dugaan duplikat), beri saran konkret, dan tanyakan pilihan pengguna secara singkat (misalnya "Klien ini sudah ada, pakai yang itu atau beri nama berbeda?"). Setelah pengguna menjawab, coba lagi.',
    '12. Jangan menulis nama tool atau nama kolom teknis (seperti versiTerpasang atau jumlahDeployment) di jawaban: sumbernya sudah ditampilkan terpisah. Tulis "versi terpasang", "jumlah deployment", dan seterusnya.',
    ...(channel === 'voice'
      ? [
          'SALURAN SUARA: pengguna berbicara lewat voice note di Telegram dan jawaban Anda akan DIBACAKAN sebagai voice note. Jadi Anda BISA membalas dengan suara: jangan pernah mengatakan bahwa Anda hanya bisa membalas teks, dan abaikan pesan lama di percakapan yang mengatakan sebaliknya.',
          'Tulis untuk didengar: kalimat pendek dan natural, paling banyak sekitar 5 kalimat, tanpa daftar bernomor, tanpa tanda markdown, tanpa nama tool. Sebut angka dan nama seperti diucapkan. Bila jawabannya panjang, ringkas dan tawarkan detail di aplikasi.',
        ]
      : []),
  ].join('\n');
}

export interface AssistantReply {
  ok: boolean;
  label: string;
  text: string | null;
  /** Friendly message when `ok` is false. */
  message?: string;
  refused: boolean;
  refusalReason?: AgentResult['refusalReason'];
  /** Tools whose results the answer rests on: what the interface shows as "sources". */
  sources: string[];
  tools: Array<{ name: string; status: string }>;
  pendingApprovals: Array<{ id: string; tool: string }>;
  /** Drafts made while answering, each with the tool that made it and its id. */
  drafts: Array<{ tool: string; id: string }>;
  runId: string | null;
  /** Only managers see what a run cost. */
  costMicroUsd: number | null;
}

/**
 * Answers one question from the person's own data. The whole path is ours: session context in, permission-filtered tools,
 * numbers grounded in tool results, the run recorded in `ai_runs`. `provider` is replaceable so tests never reach the network.
 */
export async function askAssistant(
  db: Db,
  ctx: Ctx,
  input: { request: AssistantRequest; organizationName: string; locale: Locale; channel?: 'text' | 'voice'; provider?: AiProvider },
): Promise<AssistantReply> {
  assertCan(ctx, 'assistant.use');
  const parsed = assistantRequestSchema.safeParse(input.request);
  if (!parsed.success) throw new DomainError('validation', parsed.error.issues[0]?.message ?? 'invalid conversation');

  const history = parsed.data.messages;
  const question = history[history.length - 1].content;
  const result = await runAgent({
    provider: input.provider ?? getAiProvider(),
    db,
    ctx,
    registry: buildAssistantRegistry(),
    instructions: assistantInstructions(input.organizationName, input.locale, input.channel),
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    effort: 'low',
    maxTokens: 2000,
    feature: 'agent',
    grounding: 'advisory',
    locale: input.locale,
    inputSummary: `Pertanyaan asisten (${question.length} karakter)`,
    cacheKey: input.channel === 'voice' ? 'orbyte-assistant-voice-v1' : 'orbyte-assistant-v2',
    trustedNumbers: [ctx.clock.now().toISOString().slice(0, 10)],
  });

  return {
    ok: result.ok,
    label: result.label,
    text: result.text,
    message: result.message,
    refused: result.refused,
    refusalReason: result.refusalReason,
    sources: result.sources,
    tools: result.tools.map((t) => ({ name: t.name, status: t.status })),
    pendingApprovals: result.pendingApprovals,
    drafts: result.drafts ?? [],
    runId: result.runId,
    costMicroUsd: can(ctx.role, 'ai.usage.read') ? result.costMicroUsd : null,
  };
}
