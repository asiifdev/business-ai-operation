import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation, pgError } from '../../db/errors';
import { newId } from '../../db/ids';
import { accounts, sessions, users } from '../../db/schema';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { PASSWORD_MIN_LENGTH } from '../org/service';
import { assertCan, type Role } from '../permissions';

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['owner', 'admin', 'staff']),
  /** Initial password chosen by the Owner/Admin; the person must change it at first login (BRD-M01). */
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
  locale: z.enum(['id', 'en']).default('id'),
});

const who = (ctx: Ctx) => ({ orgId: ctx.orgId, actor: ctx.actor, userId: ctx.userId, aiRunId: ctx.aiRunId });

/** Only an Owner may create, change or deactivate another Owner (an Admin cannot escalate or remove the top role). */
function assertMayTouchRole(ctx: Ctx, role: Role) {
  if (role === 'owner' && ctx.role !== 'owner') throw new DomainError('forbidden', 'only an owner may manage owners');
}

/** Maps the database guard "organization must keep an active owner" to a domain error. */
function mapLastOwner(err: unknown): never {
  if (/at least one active owner/.test(pgError(err).message)) throw new DomainError('last_owner');
  throw err;
}

async function getTarget(ctx: Ctx, userId: string) {
  const [target] = await db.select().from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.id, userId))).limit(1);
  if (!target) throw new DomainError('not_found'); // other organizations' users look exactly like missing ones
  return target;
}

export async function listUsers(ctx: Ctx) {
  assertCan(ctx, 'user.read');
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, isActive: users.isActive, locale: users.locale, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.orgId, ctx.orgId))
    .orderBy(asc(users.createdAt));
}

export async function createUser(ctx: Ctx, raw: z.input<typeof createUserSchema>) {
  assertCan(ctx, 'user.create');
  const input = createUserSchema.parse(raw);
  assertMayTouchRole(ctx, input.role);
  const passwordHash = await hashPassword(input.password);
  const id = newId();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id, orgId: ctx.orgId, name: input.name, email: input.email, role: input.role, locale: input.locale, mustChangePassword: true });
      await tx.insert(accounts).values({ id: newId(), accountId: id, providerId: 'credential', userId: id, password: passwordHash });
      await recordAudit(tx, who(ctx), { action: 'user.created', entityType: 'user', entityId: id, summary: { role: input.role } });
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_users_email_lower')) throw new DomainError('email_taken');
    throw err;
  }
  return { id };
}

export async function setUserRole(ctx: Ctx, userId: string, role: Role) {
  assertCan(ctx, 'user.update_role');
  const target = await getTarget(ctx, userId);
  assertMayTouchRole(ctx, target.role); // changing an existing owner
  assertMayTouchRole(ctx, role); // promoting someone to owner
  if (target.role === role) return;
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ role }).where(and(eq(users.orgId, ctx.orgId), eq(users.id, userId)));
      await recordAudit(tx, who(ctx), { action: 'user.role_changed', entityType: 'user', entityId: userId, summary: { from: target.role, to: role } });
    });
  } catch (err) {
    mapLastOwner(err);
  }
}

/** Deactivates a user and revokes every session at once, so access ends immediately (BR-M01-06). */
export async function deactivateUser(ctx: Ctx, userId: string) {
  assertCan(ctx, 'user.deactivate');
  const target = await getTarget(ctx, userId);
  assertMayTouchRole(ctx, target.role);
  if (!target.isActive) return;
  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set({ isActive: false }).where(and(eq(users.orgId, ctx.orgId), eq(users.id, userId)));
      await tx.delete(sessions).where(eq(sessions.userId, userId));
      await recordAudit(tx, who(ctx), { action: 'user.deactivated', entityType: 'user', entityId: userId, summary: { role: target.role } });
    });
  } catch (err) {
    mapLastOwner(err);
  }
}
