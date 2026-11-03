import { and, eq, exists, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { clients, organizationProfiles, organizations, packages, products, telegramLinks, users } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';
import { who } from '../portfolio/shared';
import { computeOnboarding, profileIsFilled, stepSchema, type OnboardingProgress, type OnboardingState } from './onboarding-rules';

const count = sql<number>`count(*)::int`;

/** Where the first-run wizard stands for this organization, read from real rows (D-095). Owner and Admin. */
export async function getOnboarding(ctx: Ctx): Promise<OnboardingState> {
  assertCan(ctx, 'org.profile.update');
  const [[org], [profile], [clientCount], [userCount], [linked], [withPackage]] = await Promise.all([
    db.select({ bankAccountName: organizations.bankAccountName, bankAccountNumber: organizations.bankAccountNumber, progress: organizations.onboardingProgress, completedAt: organizations.onboardingCompletedAt }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    db.select({ industry: organizationProfiles.industry, description: organizationProfiles.description }).from(organizationProfiles).where(eq(organizationProfiles.orgId, ctx.orgId)),
    db.select({ n: count }).from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.archivedAt))),
    db.select({ n: count }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.isActive, true))),
    db.select({ n: count }).from(telegramLinks).where(and(eq(telegramLinks.orgId, ctx.orgId), eq(telegramLinks.userId, ctx.userId), isNull(telegramLinks.unlinkedAt))),
    db
      .select({ n: count })
      .from(products)
      .where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt), exists(db.select({ one: sql`1` }).from(packages).where(and(eq(packages.orgId, products.orgId), eq(packages.productId, products.id), isNull(packages.archivedAt)))))),
  ]);
  if (!org) throw new DomainError('not_found', 'organization');
  return computeOnboarding(
    {
      profileFilled: profile ? profileIsFilled(profile) : false,
      bankFilled: Boolean(org.bankAccountName?.trim() && org.bankAccountNumber?.trim()),
      productWithPackage: (withPackage?.n ?? 0) > 0,
      hasClient: (clientCount?.n ?? 0) > 0,
      activeUsers: userCount?.n ?? 0,
      telegramLinked: (linked?.n ?? 0) > 0,
    },
    org.progress,
    org.completedAt,
  );
}

async function updateProgress(ctx: Ctx, mutate: (p: OnboardingProgress) => OnboardingProgress, action: string, summary: Record<string, unknown>) {
  await db.transaction(async (tx) => {
    const [row] = await tx.select({ progress: organizations.onboardingProgress }).from(organizations).where(eq(organizations.id, ctx.orgId)).for('update');
    if (!row) throw new DomainError('not_found', 'organization');
    await tx.update(organizations).set({ onboardingProgress: mutate(row.progress) }).where(eq(organizations.id, ctx.orgId));
    await recordAudit(tx, who(ctx), { action, entityType: 'organization', entityId: ctx.orgId, summary });
  });
}

const without = (list: string[] | undefined, step: string) => (list ?? []).filter((s) => s !== step);

/** Sets a step aside on purpose ("later"). It stays visible as skipped until it is really done. */
export async function skipOnboardingStep(ctx: Ctx, raw: unknown): Promise<void> {
  assertCan(ctx, 'org.profile.update');
  const { step } = stepSchema.parse(raw);
  await updateProgress(ctx, (p) => ({ ...p, skipped: [...without(p.skipped, step), step] }), 'org.onboarding_step_skipped', { step });
}

/** Confirms the one step that has no data of its own (choosing how much the assistant does alone). Owner only, like the setting. */
export async function confirmOnboardingStep(ctx: Ctx, raw: unknown): Promise<void> {
  assertCan(ctx, 'org.ai_autonomy.update');
  const { step } = stepSchema.parse(raw);
  if (step !== 'assistant') throw new DomainError('validation', 'only the assistant step is confirmed by hand');
  await updateProgress(ctx, (p) => ({ ...p, skipped: without(p.skipped, step), confirmed: [...without(p.confirmed, step), step] }), 'org.onboarding_step_confirmed', { step });
}

/** The Owner closes the wizard (finished or "later"). Idempotent; the dashboard card keeps reminding about required steps. */
export async function completeOnboarding(ctx: Ctx): Promise<{ completedAt: string }> {
  assertCan(ctx, 'org.settings.update');
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ completedAt: organizations.onboardingCompletedAt }).from(organizations).where(eq(organizations.id, ctx.orgId)).for('update');
    if (!row) throw new DomainError('not_found', 'organization');
    if (row.completedAt) return { completedAt: row.completedAt.toISOString() };
    const now = ctx.clock.now();
    await tx.update(organizations).set({ onboardingCompletedAt: now }).where(eq(organizations.id, ctx.orgId));
    await recordAudit(tx, who(ctx), { action: 'org.onboarding_completed', entityType: 'organization', entityId: ctx.orgId, summary: {} });
    return { completedAt: now.toISOString() };
  });
}

/** Cheap check for the `/app` redirect: only the Owner of an organization whose wizard is still open is sent to it. */
export async function onboardingDue(ctx: Ctx): Promise<boolean> {
  if (ctx.role !== 'owner') return false;
  const [row] = await db.select({ completedAt: organizations.onboardingCompletedAt }).from(organizations).where(eq(organizations.id, ctx.orgId));
  return Boolean(row) && row!.completedAt === null;
}
