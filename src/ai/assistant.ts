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
 * The standing instructions. The assistant is not a general chatbot: it is a way to read this organization's own data
 * through a fixed set of tools. The prompt says so, and the agent enforces it (no tool result, no answer).
 */
export function assistantInstructions(organizationName: string, locale: Locale): string {
  return [
    `Anda adalah asisten Orbyte untuk organisasi "${organizationName}". Anda BUKAN chatbot serba bisa: Anda hanya membaca data organisasi ini lewat tool yang tersedia.`,
    'Aturan, tanpa pengecualian:',
    '1. Jawab HANYA dari hasil tool. Jangan memakai pengetahuan umum, tebakan, atau ingatan Anda sendiri.',
    '2. Untuk setiap pertanyaan, panggil tool yang relevan lebih dulu, baru jawab.',
    '3. Bila tidak ada tool yang cocok (pengetahuan umum, obrolan, hal di luar data organisasi), panggil report_out_of_scope. Jangan menjawab sendiri.',
    '4. Angka, tanggal, nama, dan status hanya boleh berasal dari hasil tool. Jangan menghitung atau membulatkan sendiri; salin apa adanya.',
    '5. Bila data yang diminta tidak ada di hasil tool, katakan data itu belum tersedia. Jangan mengarang.',
    '6. Anda tidak bisa mengubah data. Tindakan berisiko hanya berupa permintaan persetujuan yang diputuskan manusia.',
    `7. Jawab ringkas dalam ${locale === 'en' ? 'bahasa Inggris' : 'bahasa Indonesia'}, dengan kalimat wajar untuk pemilik bisnis.`,
    '8. Jangan menulis nama tool atau nama kolom teknis (seperti versiTerpasang atau jumlahDeployment) di jawaban: sumbernya sudah ditampilkan terpisah. Tulis "versi terpasang", "jumlah deployment", dan seterusnya.',
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
  runId: string | null;
  /** Only managers see what a run cost. */
  costMicroUsd: number | null;
}

/**
 * Answers one question from the person's own data. The whole path is ours: session context in, permission-filtered tools,
 * strict grounding, the run recorded in `ai_runs`. `provider` is replaceable so tests never reach the network.
 */
export async function askAssistant(
  db: Db,
  ctx: Ctx,
  input: { request: AssistantRequest; organizationName: string; locale: Locale; provider?: AiProvider },
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
    instructions: assistantInstructions(input.organizationName, input.locale),
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    effort: 'low',
    maxTokens: 2000,
    feature: 'agent',
    grounding: 'strict',
    locale: input.locale,
    inputSummary: `Pertanyaan asisten (${question.length} karakter)`,
    cacheKey: 'orbyte-assistant-v1',
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
    runId: result.runId,
    costMicroUsd: can(ctx.role, 'ai.usage.read') ? result.costMicroUsd : null,
  };
}
