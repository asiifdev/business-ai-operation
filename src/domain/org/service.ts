import { hashPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { newId } from '../../db/ids';
import { accounts, aiBudgets, organizations, users } from '../../db/schema';
import { DomainError } from '../errors';
import { recordAudit } from '../audit/service';

/** Default daily AI caps in micro-USD (D-025). The Owner can change them in organization settings. */
export const DEFAULT_AI_BUDGETS_MICRO_USD = { agent: 2_000_000, minutes: 1_000_000, transcribe: 1_000_000, image: 1_000_000 } as const;

export const PASSWORD_MIN_LENGTH = 10;

export const registerSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  locale: z.enum(['id', 'en']).default('id'),
});
export type RegisterInput = z.input<typeof registerSchema>;

/**
 * Creates an organization with its first Owner in ONE transaction (M01): organization, default AI budgets, user,
 * credential account (password hash in Better Auth's format) and audit rows. Either everything exists or nothing does.
 */
export async function registerOrganization(raw: RegisterInput) {
  const input = registerSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  const userId = newId();

  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: input.organizationName, locale: input.locale }).returning();
      await tx.insert(aiBudgets).values(
        (Object.entries(DEFAULT_AI_BUDGETS_MICRO_USD) as [keyof typeof DEFAULT_AI_BUDGETS_MICRO_USD, number][]).map(
          ([feature, dailyLimitMicroUsd]) => ({ orgId: org.id, feature, dailyLimitMicroUsd }),
        ),
      );
      await tx.insert(users).values({ id: userId, orgId: org.id, name: input.name, email: input.email, role: 'owner', locale: input.locale });
      await tx.insert(accounts).values({ id: newId(), accountId: userId, providerId: 'credential', userId, password: passwordHash });

      const who = { orgId: org.id, actor: `user:${userId}` as const, userId };
      await recordAudit(tx, who, { action: 'org.created', entityType: 'organization', entityId: org.id, summary: { name: input.organizationName } });
      await recordAudit(tx, who, { action: 'user.created', entityType: 'user', entityId: userId, summary: { role: 'owner', self_registered: true } });
      return { orgId: org.id, userId, email: input.email };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_users_email_lower')) throw new DomainError('email_taken');
    throw err;
  }
}
