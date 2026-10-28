import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { aiBudgets, aiRuns, organizations } from '../../db/schema';
import type { AiFeature } from '../../ai/types';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';

/**
 * Start of the current day in the organization's time zone, as a UTC instant. "Today's spend" is counted from here, so
 * a Jakarta organization gets a fresh budget at 00:00 WIB. Time zones with daylight saving use the offset of `now`.
 */
export function zonedDayStart(now: Date, timeZone: string): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const wallClockAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = wallClockAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day) - offsetMs);
}

export interface BudgetStatus {
  limitMicroUsd: number;
  spentMicroUsd: number;
  remainingMicroUsd: number;
  exhausted: boolean;
  dayStart: Date;
}

/**
 * Today's spend against the daily cap for one feature (BR-M07-07). A feature with no budget row is treated as a cap of
 * zero, so a missing setting blocks the feature instead of letting it spend without limit.
 */
export async function getBudgetStatus(db: Db, orgId: string, feature: AiFeature, now: Date): Promise<BudgetStatus> {
  const [org] = await db.select({ timezone: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new DomainError('not_found', 'organization');
  const dayStart = zonedDayStart(now, org.timezone);

  const [budget] = await db.select({ limit: aiBudgets.dailyLimitMicroUsd }).from(aiBudgets).where(and(eq(aiBudgets.orgId, orgId), eq(aiBudgets.feature, feature)));
  const [spent] = await db
    .select({ total: sql<string>`coalesce(sum(${aiRuns.costMicroUsd}), 0)::text` })
    .from(aiRuns)
    .where(and(eq(aiRuns.orgId, orgId), eq(aiRuns.feature, feature), gte(aiRuns.startedAt, dayStart)));

  const limitMicroUsd = budget?.limit ?? 0;
  const spentMicroUsd = Number(spent?.total ?? 0);
  return { limitMicroUsd, spentMicroUsd, remainingMicroUsd: Math.max(0, limitMicroUsd - spentMicroUsd), exhausted: spentMicroUsd >= limitMicroUsd, dayStart };
}

/** Largest cap an Owner can set: USD 100 a day per feature, far above the USD 150 hackathon credit for all features. */
export const MAX_DAILY_BUDGET_MICRO_USD = 100_000_000;

/** Only the Owner changes AI budgets (BR-M07, permission `ai.budget.update`). The change is audited. */
export async function setAiBudget(db: Db, ctx: Ctx, feature: AiFeature, limitMicroUsd: number): Promise<void> {
  assertCan(ctx, 'ai.budget.update');
  if (!Number.isInteger(limitMicroUsd) || limitMicroUsd < 0 || limitMicroUsd > MAX_DAILY_BUDGET_MICRO_USD) {
    throw new DomainError('validation', 'budget must be a whole number of micro-USD between 0 and 100,000,000');
  }
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ limit: aiBudgets.dailyLimitMicroUsd }).from(aiBudgets).where(and(eq(aiBudgets.orgId, ctx.orgId), eq(aiBudgets.feature, feature)));
    await tx
      .insert(aiBudgets)
      .values({ orgId: ctx.orgId, feature, dailyLimitMicroUsd: limitMicroUsd })
      .onConflictDoUpdate({ target: [aiBudgets.orgId, aiBudgets.feature], set: { dailyLimitMicroUsd: limitMicroUsd } });
    await recordAudit(tx, { orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId }, {
      action: 'ai_budget.updated',
      entityType: 'ai_budget',
      entityId: feature,
      summary: { feature, from: before?.limit ?? null, to: limitMicroUsd },
    });
  });
}
