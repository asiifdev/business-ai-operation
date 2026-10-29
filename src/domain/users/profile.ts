import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { accounts, sessions, users } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { PASSWORD_MIN_LENGTH } from '../org/service';

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

/**
 * A person changes their own password (BRD-M01). The current one must match, the new one must differ, every other
 * session is signed out (the one making the change stays), and the "must change" flag from an initial password is cleared.
 * The audit row records that it happened, never a password.
 */
export async function changeOwnPassword(ctx: Ctx, raw: z.input<typeof changePasswordSchema>, keepSessionId?: string): Promise<void> {
  const input = changePasswordSchema.parse(raw);
  if (input.newPassword === input.currentPassword) throw new z.ZodError([{ code: 'custom', path: ['newPassword'], message: 'same' }]);
  const [account] = await db.select({ id: accounts.id, password: accounts.password }).from(accounts).where(and(eq(accounts.userId, ctx.userId), eq(accounts.providerId, 'credential')));
  if (!account?.password || !(await verifyPassword({ hash: account.password, password: input.currentPassword }))) throw new DomainError('wrong_password');
  const hash = await hashPassword(input.newPassword);
  await db.transaction(async (tx) => {
    await tx.update(accounts).set({ password: hash }).where(eq(accounts.id, account.id));
    await tx.update(users).set({ mustChangePassword: false }).where(and(eq(users.orgId, ctx.orgId), eq(users.id, ctx.userId)));
    await tx.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, ctx.userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, ctx.userId));
    await recordAudit(tx, { orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId }, { action: 'user.password_changed', entityType: 'user', entityId: ctx.userId });
  });
}
