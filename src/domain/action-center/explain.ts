import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { runAgent } from '../../ai/agent';
import { getAiProvider } from '../../ai/index';
import type { Locale } from '../../ai/messages';
import type { AiProvider } from '../../ai/provider';
import { buildActionRegistry } from '../../ai/tools/actions';
import { db } from '../../db/client';
import { approvals, findings, organizations } from '../../db/schema';
import type { Clock } from '../../lib/clock';
import { recordAudit } from '../audit/service';
import { todayIn } from '../billing/dates';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import type { FindingRule } from './facts';
import { getFinding, type FindingCard } from './findings';
import { systemCtx } from './system';

const EXPLANATION_MAX = 1500;
const DRAFT_MAX = 2000;
const DRAFT_MARKER = /^\s*\**\s*DRAF(?:T)?\s+PESAN\s*\**\s*:?\s*\**/im;
const EXPLANATION_MARKER = /^\s*\**\s*PENJELASAN\s*\**\s*:?\s*\**\s*/i;

/** What each rule asks of the model. Our own trusted text; the facts come only from the tool. */
const RULE_TASK: Record<FindingRule, string> = {
  invoice_overdue:
    'Invoice ini sudah lewat jatuh tempo. Jelaskan dalam 2 sampai 3 kalimat apa yang terjadi dan apa langkah yang disarankan. Lalu tulis draf pesan pengingat yang sopan untuk klien (akan disalin manual oleh pengguna, tidak dikirim otomatis).',
  invoice_draft_ready:
    'Draf invoice perpanjangan sudah disiapkan sistem dan menunggu ditinjau. Jelaskan dalam 2 sampai 3 kalimat apa isinya dan apa yang perlu dicek sebelum dikirim. Bila datanya wajar, ajukan mark_invoice_sent supaya pengguna tinggal menyetujui. Lalu tulis draf pesan pengantar invoice untuk klien.',
  renewal_upcoming:
    'Langganan klien ini mendekati jatuh tempo dan belum ada invoice untuk periodenya. Jelaskan dalam 2 sampai 3 kalimat dan sarankan langkahnya. Lalu tulis draf pesan pengingat perpanjangan yang ramah untuk klien.',
  task_late:
    'Tugas ini sudah lewat tenggat dan belum selesai. Jelaskan dalam 2 sampai 3 kalimat apa yang tertunda dan sarankan langkahnya (misalnya tetapkan penanggung jawab, naikkan prioritas, atau sepakati tenggat baru). Bila tugas ini Bug atau Maintenance untuk seorang klien, tulis draf kabar perkembangan singkat untuk klien itu; selain itu tulis "-" sebagai draf pesan.',
  lead_stagnant:
    'Lead ini sudah lama tidak berpindah tahap. Jelaskan dalam 2 sampai 3 kalimat sudah berapa lama dan di tahap apa, lalu sarankan langkah berikutnya (misalnya hubungi kembali, kirim proposal, atau tandai Kalah dengan alasan bila sudah tidak berjalan). Lalu tulis draf pesan tindak lanjut yang sopan untuk calon klien (akan disalin manual oleh pengguna, tidak dikirim otomatis).',
  deployment_outdated: 'Kode yang terpasang di deployment ini tertinggal dari branch-nya. Jelaskan dalam 2 sampai 3 kalimat dampaknya dan sarankan memperbarui lewat run yang perlu persetujuan.',
  deployment_down: 'Domain deployment ini tidak dapat dijangkau. Jelaskan dalam 2 sampai 3 kalimat apa yang perlu dicek lebih dulu dan sarankan langkahnya.',
};

export function explainInstructions(rule: FindingRule, organizationName: string, locale: Locale): string {
  return [
    `Anda menyiapkan kartu Action Center untuk organisasi "${organizationName}". Anda tidak memutuskan ada atau tidaknya masalah: sistem sudah menemukannya dari data.`,
    '1. Panggil get_finding_facts lebih dulu. Semua angka, tanggal, nama, dan status hanya boleh berasal dari hasilnya. Jangan menghitung sendiri.',
    '2. Tulis tanggal sebagai DD/MM/YYYY dan uang persis seperti teks Rupiah di hasil tool.',
    `3. ${RULE_TASK[rule]}`,
    '4. Anda tidak bisa mengirim pesan atau mengubah data. Aksi berisiko hanya berupa usulan yang diputuskan manusia.',
    `5. Tulis dalam ${locale === 'en' ? 'bahasa Inggris' : 'bahasa Indonesia'}, tanpa nama tool atau nama kolom teknis.`,
    'Format jawaban akhir, persis:',
    'PENJELASAN:',
    '<penjelasan>',
    'DRAF PESAN:',
    '<draf pesan untuk klien, atau "-" bila tidak perlu>',
  ].join('\n');
}

/** Splits the model's answer into the explanation and the client message draft. Pure, so the format is testable. */
export function parseExplanation(text: string): { explanation: string; draftMessage: string | null } {
  const at = text.search(DRAFT_MARKER);
  const head = at >= 0 ? text.slice(0, at) : text;
  const tail = at >= 0 ? text.slice(at).replace(DRAFT_MARKER, '') : '';
  const explanation = head.replace(EXPLANATION_MARKER, '').trim().slice(0, EXPLANATION_MAX);
  const draft = tail.trim().replace(/^\*+|\*+$/g, '').trim();
  return { explanation, draftMessage: draft && draft !== '-' ? draft.slice(0, DRAFT_MAX) : null };
}

export interface ExplainResult {
  ok: boolean;
  /** True when the saved explanation was returned without calling the model (BR-M08-10). */
  cached: boolean;
  /** Friendly reason when AI could not help; the card still works with its data and manual buttons (BR-M08-11). */
  message?: string;
  pendingApprovals: Array<{ id: string; tool: string }>;
  card: FindingCard;
}

/**
 * Asks the agent once to explain a finding and draft a client message (BRD-M08 section 4 step 2). The result is saved on
 * the finding and reused on every view; `force` regenerates it on request. Strict grounding: the agent must read the
 * facts tool, and numbers that are not in it make the answer a refusal, which is not saved. For a draft that is ready,
 * the agent may propose `mark_invoice_sent`, which becomes a pending approval and nothing more.
 */
export async function explainFinding(ctx: Ctx, id: string, options: { provider?: AiProvider; locale?: Locale; force?: boolean } = {}): Promise<ExplainResult> {
  const card = await getFinding(ctx, id);
  if (card.status !== 'new' && card.status !== 'snoozed') throw new DomainError('invalid_state', 'finding is closed');
  if (card.explanation && !options.force) return { ok: true, cached: true, pendingApprovals: [], card };

  const [org] = await db.select({ name: organizations.name, timezone: organizations.timezone, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const locale = options.locale ?? org.locale;
  // Only one open proposal per finding: when one is already waiting, the act tool is not offered again.
  const [{ n: waiting }] = await db.select({ n: count() }).from(approvals).where(and(eq(approvals.orgId, ctx.orgId), eq(approvals.findingId, id), eq(approvals.status, 'pending')));
  const invoiceId = card.facts.kind === 'invoice' && waiting === 0 ? card.facts.invoiceId : undefined;

  const result = await runAgent({
    provider: options.provider ?? getAiProvider(),
    db,
    ctx,
    registry: buildActionRegistry({ id, rule: card.rule, invoiceId }),
    instructions: explainInstructions(card.rule, org.name, locale),
    messages: [{ role: 'user', content: 'Siapkan penjelasan dan draf pesan untuk temuan ini.' }],
    effort: 'low',
    maxTokens: 1500,
    feature: 'agent',
    grounding: 'strict',
    locale,
    findingId: id,
    entityType: 'finding',
    entityId: id,
    inputSummary: `Penjelasan temuan ${card.rule}`,
    cacheKey: 'orbyte-finding-v1',
    trustedNumbers: [todayIn(org.timezone, ctx.clock.now())],
  });

  if (!result.ok || result.refused || !result.text || !result.runId) {
    return { ok: false, cached: false, message: result.message, pendingApprovals: result.pendingApprovals, card };
  }
  const parsed = parseExplanation(result.text);
  if (!parsed.explanation) return { ok: false, cached: false, pendingApprovals: result.pendingApprovals, card };

  const runId = result.runId;
  await db.transaction(async (tx) => {
    await tx
      .update(findings)
      .set({ explanation: parsed.explanation, draftMessage: parsed.draftMessage, aiRunId: runId, updatedAt: ctx.clock.now() })
      .where(and(eq(findings.orgId, ctx.orgId), eq(findings.id, id)));
    await recordAudit(tx, { orgId: ctx.orgId, actor: `ai:${runId}`, userId: ctx.userId, aiRunId: runId }, { action: 'finding.explained', entityType: 'finding', entityId: id, summary: { rule: card.rule, approvals: result.pendingApprovals.length } });
  });
  return { ok: true, cached: false, pendingApprovals: result.pendingApprovals, card: await getFinding(ctx, id) };
}

/**
 * The scheduler's share (PRD section 7, job `finding.explain`): explains a few new findings that have no explanation yet,
 * oldest first. Small on purpose: a burst of fifty findings must not become fifty model calls (BRD-M08 section 11 item 5),
 * and the daily budget still applies to every call. Failures are left for a person to retry from the card.
 */
export async function explainPendingFindings(orgId: string, clock: Clock, limit = 3, provider?: AiProvider): Promise<number> {
  const rows = await db
    .select({ id: findings.id })
    .from(findings)
    .where(and(eq(findings.orgId, orgId), eq(findings.status, 'new'), isNull(findings.explanation)))
    .orderBy(asc(findings.createdAt))
    .limit(limit);
  if (rows.length === 0) return 0;
  const ctx = await systemCtx(orgId, 'finding.explain', clock);
  let done = 0;
  for (const row of rows) {
    const out = await explainFinding(ctx, row.id, { provider });
    if (out.ok) done++;
    else if (out.message) break; // budget gone or the provider is down: stop for today
  }
  return done;
}
