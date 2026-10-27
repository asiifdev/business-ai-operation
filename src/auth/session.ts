import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { organizations } from '../db/schema';
import { auth } from './auth';
import { userCtx, type Ctx } from '../domain/ctx';
import type { Role } from '../domain/permissions';

type SessionUser = NonNullable<App.Locals['user']>;

/**
 * Resolves the signed-in user and the request context from the cookie. The organization and role always come from
 * the stored user record, never from request input (BR-M01-01). Deactivated users resolve to null (BR-M01-06).
 */
export async function resolveSession(headers: Headers): Promise<{ user: SessionUser; ctx: Ctx; organizationName: string } | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const u = session.user as typeof session.user & { orgId: string; role: Role; locale?: 'id' | 'en'; isActive?: boolean; mustChangePassword?: boolean };
  if (u.isActive === false) return null;
  const user: SessionUser = {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    orgId: u.orgId,
    locale: u.locale ?? 'id',
    mustChangePassword: Boolean(u.mustChangePassword),
  };
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, user.orgId)).limit(1);
  if (!org) return null;
  return { user, ctx: userCtx({ orgId: user.orgId, userId: user.id, role: user.role }), organizationName: org.name };
}
