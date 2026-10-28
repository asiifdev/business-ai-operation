import { and, count, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { aiBudgets, aiRuns, users } from '../../db/schema';
import type { AiFeature } from '../../ai/types';
import type { Ctx } from '../ctx';
import { assertCan, can } from '../permissions';
import { getBudgetStatus } from './budget';

export const AI_FEATURES: readonly AiFeature[] = ['agent', 'minutes', 'transcribe', 'image'];

export interface FeatureUsage {
  feature: AiFeature;
  limitMicroUsd: number;
  spentMicroUsd: number;
  remainingMicroUsd: number;
  exhausted: boolean;
  runsToday: number;
}

/** Today's AI spend and cap for every feature (managers only, `ai.usage.read`). Numbers come from `ai_runs`, nothing is estimated. */
export async function getAiOverview(db: Db, ctx: Ctx): Promise<{ dayStart: Date; features: FeatureUsage[] }> {
  assertCan(ctx, 'ai.usage.read');
  const now = ctx.clock.now();
  const statuses = await Promise.all(AI_FEATURES.map((feature) => getBudgetStatus(db, ctx.orgId, feature, now)));
  const dayStart = statuses[0].dayStart;
  const counts = await db
    .select({ feature: aiRuns.feature, n: count() })
    .from(aiRuns)
    .where(and(eq(aiRuns.orgId, ctx.orgId), gte(aiRuns.startedAt, dayStart)))
    .groupBy(aiRuns.feature);
  const runsByFeature = new Map(counts.map((c) => [c.feature, c.n]));
  return {
    dayStart,
    features: AI_FEATURES.map((feature, i) => ({
      feature,
      limitMicroUsd: statuses[i].limitMicroUsd,
      spentMicroUsd: statuses[i].spentMicroUsd,
      remainingMicroUsd: statuses[i].remainingMicroUsd,
      exhausted: statuses[i].exhausted,
      runsToday: runsByFeature.get(feature) ?? 0,
    })),
  };
}

export interface AiRunRow {
  id: string;
  feature: AiFeature;
  model: string;
  status: 'ok' | 'error' | 'blocked_budget' | 'rejected_tool';
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  tools: Array<{ round: number; name: string; tier: string; status: string }>;
  inputSummary: string | null;
  outputSummary: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  userName: string | null;
}

/**
 * The AI run trail (BRD-M07 §2): managers see every run of the organization, staff only their own. Newest first, paged by
 * `before` (a run start time) so the page stays fast as the log grows.
 */
export async function listAiRuns(db: Db, ctx: Ctx, options: { limit?: number; before?: Date } = {}): Promise<AiRunRow[]> {
  assertCan(ctx, 'ai.run.read_own');
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const own = !can(ctx.role, 'ai.run.read_any');
  const rows = await db
    .select({
      id: aiRuns.id,
      feature: aiRuns.feature,
      model: aiRuns.model,
      status: aiRuns.status,
      inputTokens: aiRuns.inputTokens,
      outputTokens: aiRuns.outputTokens,
      costMicroUsd: aiRuns.costMicroUsd,
      tools: aiRuns.tools,
      inputSummary: aiRuns.inputSummary,
      outputSummary: aiRuns.outputSummary,
      error: aiRuns.error,
      startedAt: aiRuns.startedAt,
      finishedAt: aiRuns.finishedAt,
      userName: users.name,
    })
    .from(aiRuns)
    .leftJoin(users, and(eq(users.orgId, aiRuns.orgId), eq(users.id, aiRuns.onBehalfOf)))
    .where(and(eq(aiRuns.orgId, ctx.orgId), own ? eq(aiRuns.onBehalfOf, ctx.userId) : undefined, options.before ? lt(aiRuns.startedAt, options.before) : undefined))
    .orderBy(desc(aiRuns.startedAt))
    .limit(limit);
  return rows as AiRunRow[];
}

/** Total of every feature cap, for a one-line summary. */
export async function totalDailyLimitMicroUsd(db: Db, orgId: string): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${aiBudgets.dailyLimitMicroUsd}), 0)::text` }).from(aiBudgets).where(eq(aiBudgets.orgId, orgId));
  return Number(row?.total ?? 0);
}
