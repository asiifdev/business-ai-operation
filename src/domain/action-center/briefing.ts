import { and, eq } from 'drizzle-orm';
import { getAiProvider } from '../../ai/index';
import type { Locale } from '../../ai/messages';
import { findUnverifiedNumbers } from '../../ai/numbers';
import type { AiProvider } from '../../ai/provider';
import { chatOnce } from '../../ai/run';
import { db } from '../../db/client';
import { briefings, organizations } from '../../db/schema';
import type { Clock } from '../../lib/clock';
import { formatRupiah } from '../../lib/format';
import { recordAudit } from '../audit/service';
import { automationOnce } from '../automation/once';
import { todayIn } from '../billing/dates';
import { getFinanceSummary } from '../billing/summary';
import type { Ctx } from '../ctx';
import { assertCan } from '../permissions';
import { listPendingApprovals } from './approvals';
import { listFindings } from './findings';
import { systemCtx } from './system';

/** The numbers of one morning, from the same services as the dashboard (BR-M08-13), frozen at the moment of writing. */
export interface BriefingFacts {
  date: string;
  receivedThisMonth: number;
  mrr: number;
  outstanding: { amount: number; count: number };
  overdue: { amount: number; count: number };
  dueToday: number;
  renewalsSoon: number;
  draftsToReview: number;
  openFindings: number;
  highPriorityFindings: number;
  pendingApprovals: number;
}

export interface BriefingView {
  date: string;
  facts: BriefingFacts;
  /** The AI's wording of the same numbers. Null means "numbers only, not an AI result" (BR-M08-11). */
  narrative: string | null;
  isAi: boolean;
  createdAt: Date;
}

const NARRATIVE_MAX = 1500;

export async function collectBriefingFacts(ctx: Ctx): Promise<BriefingFacts> {
  const [finance, open, waiting] = await Promise.all([getFinanceSummary(ctx), listFindings(ctx, 'open'), listPendingApprovals(ctx)]);
  return {
    date: finance.today,
    receivedThisMonth: finance.receivedThisMonth,
    mrr: finance.mrr,
    outstanding: finance.outstanding,
    overdue: { amount: finance.overdue.amount, count: finance.overdue.count },
    dueToday: finance.dueToday.length,
    renewalsSoon: finance.renewalsSoon.length,
    draftsToReview: finance.draftsToReview,
    openFindings: open.findings.length,
    highPriorityFindings: open.findings.filter((f) => f.priority.level === 'high').length,
    pendingApprovals: waiting.length,
  };
}

/** The same facts in the words and Rupiah text the model may quote. Everything it writes is checked against this. */
function factsForModel(f: BriefingFacts) {
  const rp = (n: number) => ({ teks: formatRupiah(n), angka: n });
  return {
    tanggal: f.date,
    diterimaBulanIni: rp(f.receivedThisMonth),
    pendapatanBerulangPerBulan: rp(f.mrr),
    belumDibayar: { jumlahInvoice: f.outstanding.count, total: rp(f.outstanding.amount) },
    lewatJatuhTempo: { jumlahInvoice: f.overdue.count, total: rp(f.overdue.amount) },
    jatuhTempoHariIni: f.dueToday,
    perpanjangan7Hari: f.renewalsSoon,
    drafMenungguTinjauan: f.draftsToReview,
    temuanTerbuka: f.openFindings,
    temuanPrioritasTinggi: f.highPriorityFindings,
    persetujuanMenunggu: f.pendingApprovals,
  };
}

function parseStored(row: typeof briefings.$inferSelect): BriefingView {
  const body = JSON.parse(row.content) as { facts: BriefingFacts; narrative: string | null };
  return { date: row.briefingDate, facts: body.facts, narrative: row.isAi ? body.narrative : null, isAi: row.isAi, createdAt: row.createdAt };
}

/** Today's briefing, or the one of `date`. Money is in it, so it is for those who see the financial dashboard. */
export async function getBriefing(ctx: Ctx, date?: string): Promise<{ today: string; briefing: BriefingView | null }> {
  assertCan(ctx, 'dashboard.read_financial');
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const today = todayIn(org.timezone, ctx.clock.now());
  const [row] = await db.select().from(briefings).where(and(eq(briefings.orgId, ctx.orgId), eq(briefings.briefingDate, date ?? today)));
  return { today, briefing: row ? parseStored(row) : null };
}

/**
 * Writes today's briefing once (PRD section 7, key `briefing:<org>:<date>`). Numbers first, from the services; then the
 * model is asked to put them in a few sentences. Its text is kept only when every number in it appears in the facts;
 * otherwise, or when AI is unavailable or out of budget, the briefing is saved as numbers only, labelled "not an AI
 * result". A second call the same day returns the saved one.
 */
export async function generateBriefing(ctx: Ctx, options: { provider?: AiProvider; locale?: Locale } = {}): Promise<BriefingView> {
  assertCan(ctx, 'dashboard.read_financial');
  const existing = await getBriefing(ctx);
  if (existing.briefing) return existing.briefing;

  const [org] = await db.select({ name: organizations.name, locale: organizations.locale }).from(organizations).where(eq(organizations.id, ctx.orgId));
  const locale = options.locale ?? org.locale;
  const facts = await collectBriefingFacts(ctx);
  const modelFacts = JSON.stringify(factsForModel(facts));

  let narrative: string | null = null;
  let aiRunId: string | null = null;
  let provider: AiProvider | null = null;
  try {
    provider = options.provider ?? getAiProvider();
  } catch {
    provider = null; // no key configured: numbers only
  }
  if (provider) {
    const out = await chatOnce({
      db,
      ctx,
      provider,
      locale,
      feature: 'agent',
      inputSummary: `Briefing harian ${facts.date}`,
      entityType: 'briefing',
      entityId: facts.date,
      request: {
        effort: 'low',
        maxTokens: 1200,
        cacheKey: 'orbyte-briefing-v1',
        messages: [
          {
            role: 'developer',
            content: [
              `Anda menulis briefing pagi untuk pemilik "${org.name}". Tulis 3 sampai 5 kalimat ${locale === 'en' ? 'dalam bahasa Inggris' : 'dalam bahasa Indonesia'}: apa yang paling butuh perhatian hari ini dan kenapa.`,
              'Gunakan HANYA angka dari data di bawah, salin persis (uang memakai teks Rupiah-nya). Jangan menghitung, menjumlah, atau membuat persentase sendiri. Tanpa daftar berpoin, tanpa judul.',
            ].join('\n'),
          },
          { role: 'user', content: modelFacts },
        ],
      },
    });
    if (out.ok && out.value.text) {
      const text = out.value.text.trim().slice(0, NARRATIVE_MAX);
      if (findUnverifiedNumbers(text, [modelFacts], [facts.date]).length === 0) {
        narrative = text;
        aiRunId = out.runId;
      }
    }
  }

  await db.transaction(async (tx) => {
    await automationOnce(tx, ctx.orgId, 'briefing', `briefing:${ctx.orgId}:${facts.date}`, async () => {
      const [row] = await tx
        .insert(briefings)
        .values({ orgId: ctx.orgId, briefingDate: facts.date, content: JSON.stringify({ facts, narrative }), isAi: narrative !== null, aiRunId })
        .onConflictDoNothing()
        .returning({ id: briefings.id });
      if (row) await recordAudit(tx, { orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId, aiRunId }, { action: 'briefing.created', entityType: 'briefing', entityId: row.id, summary: { date: facts.date, isAi: narrative !== null } });
      return { briefingId: row?.id ?? null };
    });
  });
  return (await getBriefing(ctx)).briefing!;
}

/** The scheduler writes the briefing at the organization's briefing hour, on behalf of its Owner. */
export async function generateDailyBriefing(orgId: string, clock: Clock, provider?: AiProvider): Promise<BriefingView> {
  return generateBriefing(await systemCtx(orgId, 'briefing', clock), { provider });
}
