import { and, count, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../auth/auth';
import { db, pg } from '../../db/client';
import { accounts, aiBudgets, auditLog, organizations, sessions, users } from '../../db/schema';
import { userCtx } from '../ctx';
import { DomainError } from '../errors';
import { registerOrganization } from '../org/service';
import { createUser, deactivateUser, listUsers, setUserRole } from '../users/service';

afterAll(async () => {
  await pg.end();
});

const PASSWORD = 'correct horse battery';
let counter = 0;
const unique = () => `${Date.now()}-${++counter}`;

async function register(over: Partial<{ email: string; organizationName: string }> = {}) {
  const n = unique();
  const result = await registerOrganization({
    organizationName: over.organizationName ?? `Org ${n}`,
    name: 'Owner Satu',
    email: over.email ?? `owner-${n}@example.test`,
    password: PASSWORD,
    locale: 'id',
  });
  return { ...result, ctx: userCtx({ orgId: result.orgId, userId: result.userId, role: 'owner' }) };
}

async function rejects(promise: Promise<unknown>, code: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

describe('registerOrganization', () => {
  it('creates the organization, Owner, credential account, default budgets and audit rows together', async () => {
    const r = await register();
    const [org] = await db.select().from(organizations).where(eq(organizations.id, r.orgId));
    expect(org.currency).toBe('IDR');
    expect(org.timezone).toBe('Asia/Jakarta');

    const [owner] = await db.select().from(users).where(eq(users.id, r.userId));
    expect(owner).toMatchObject({ role: 'owner', orgId: r.orgId, isActive: true, mustChangePassword: false });

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, r.userId));
    expect(account.providerId).toBe('credential');
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD); // stored as a hash only (BR-M01-05)

    const budgets = await db.select().from(aiBudgets).where(eq(aiBudgets.orgId, r.orgId));
    expect(budgets.map((b) => b.feature).sort()).toEqual(['agent', 'image', 'minutes', 'transcribe']);

    const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, r.orgId));
    expect(audit.map((a) => a.action).sort()).toEqual(['org.created', 'user.created']);
    expect(audit.every((a) => a.actor === `user:${r.userId}`)).toBe(true);
  });

  it('rolls everything back when the email is already taken (case-insensitive) and leaves no stray organization', async () => {
    const first = await register();
    const [{ value: before }] = await db.select({ value: count() }).from(organizations);
    await rejects(
      registerOrganization({ organizationName: 'Dupe', name: 'Dupe', email: first.email.toUpperCase(), password: PASSWORD }),
      'email_taken',
    );
    const [{ value: after }] = await db.select({ value: count() }).from(organizations);
    expect(after).toBe(before);
  });

  it('rejects a short password before touching the database', async () => {
    const [{ value: before }] = await db.select({ value: count() }).from(organizations);
    await expect(registerOrganization({ organizationName: 'X Org', name: 'Xx', email: `short-${unique()}@example.test`, password: 'short' })).rejects.toThrow();
    const [{ value: after }] = await db.select({ value: count() }).from(organizations);
    expect(after).toBe(before);
  });
});

describe('login with Better Auth', () => {
  it('accepts the password hash our service stored (formats are compatible)', async () => {
    const r = await register();
    const res = await auth.api.signInEmail({ body: { email: r.email, password: PASSWORD } });
    expect(res.user.id).toBe(r.userId);
    const stored = await db.select().from(sessions).where(eq(sessions.userId, r.userId));
    expect(stored.length).toBe(1);
  });

  it('rejects a wrong password and an unknown email with the same failure', async () => {
    const r = await register();
    const wrong = await auth.api.signInEmail({ body: { email: r.email, password: 'wrong password!!' } }).then(() => null, (e: Error) => e);
    const unknown = await auth.api.signInEmail({ body: { email: `nobody-${unique()}@example.test`, password: PASSWORD } }).then(() => null, (e: Error) => e);
    expect(wrong).not.toBeNull();
    expect(unknown).not.toBeNull();
    expect(wrong!.message).toBe(unknown!.message); // does not reveal whether the email exists (BR-M01-09)
  });

  it('exposes the extra user fields (orgId, role) on the session user', async () => {
    const r = await register();
    const res = await auth.api.signInEmail({ body: { email: r.email, password: PASSWORD } });
    expect(res.user).toMatchObject({ orgId: r.orgId, role: 'owner' });
  });
});

describe('user management (M01)', () => {
  it('lets an Owner add a colleague who must change the password, and audits it', async () => {
    const o = await register();
    const email = `staff-${unique()}@example.test`;
    const { id } = await createUser(o.ctx, { name: 'Staf Satu', email, role: 'staff', password: 'temporary-pass-1' });
    const [u] = await db.select().from(users).where(eq(users.id, id));
    expect(u).toMatchObject({ role: 'staff', orgId: o.orgId, mustChangePassword: true });
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'user.created')));
    expect(entry.actor).toBe(`user:${o.userId}`);
    const login = await auth.api.signInEmail({ body: { email, password: 'temporary-pass-1' } });
    expect(login.user.id).toBe(id);
  });

  it('forbids Staff from adding users and stops an Admin from creating an Owner', async () => {
    const o = await register();
    const staff = await createUser(o.ctx, { name: 'Staf', email: `s-${unique()}@example.test`, role: 'staff', password: 'temporary-pass-1' });
    const admin = await createUser(o.ctx, { name: 'Admin', email: `a-${unique()}@example.test`, role: 'admin', password: 'temporary-pass-1' });
    const staffCtx = userCtx({ orgId: o.orgId, userId: staff.id, role: 'staff' });
    const adminCtx = userCtx({ orgId: o.orgId, userId: admin.id, role: 'admin' });
    await rejects(createUser(staffCtx, { name: 'X Y', email: `x-${unique()}@example.test`, role: 'staff', password: 'temporary-pass-1' }), 'forbidden');
    await rejects(createUser(adminCtx, { name: 'X Y', email: `y-${unique()}@example.test`, role: 'owner', password: 'temporary-pass-1' }), 'forbidden');
    await expect(createUser(adminCtx, { name: 'Ok Ok', email: `z-${unique()}@example.test`, role: 'staff', password: 'temporary-pass-1' })).resolves.toBeTruthy();
  });

  it('refuses to demote or deactivate the last active Owner, with a domain error', async () => {
    const o = await register();
    await rejects(setUserRole(o.ctx, o.userId, 'admin'), 'last_owner');
    await rejects(deactivateUser(o.ctx, o.userId), 'last_owner');
    const [still] = await db.select().from(users).where(eq(users.id, o.userId));
    expect(still).toMatchObject({ role: 'owner', isActive: true });
  });

  it('lets an Owner step down once a second Owner exists, and records the role change with who did it', async () => {
    const o = await register();
    const second = await createUser(o.ctx, { name: 'Owner Dua', email: `o2-${unique()}@example.test`, role: 'owner', password: 'temporary-pass-1' });
    await setUserRole(o.ctx, o.userId, 'admin');
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.entityId, o.userId), eq(auditLog.action, 'user.role_changed')));
    expect(entry.summary).toEqual({ from: 'owner', to: 'admin' });
    expect(entry.actor).toBe(`user:${o.userId}`);
    expect(second.id).toBeTruthy();
  });

  it('stops an Admin from changing or removing an Owner', async () => {
    const o = await register();
    const admin = await createUser(o.ctx, { name: 'Admin', email: `a-${unique()}@example.test`, role: 'admin', password: 'temporary-pass-1' });
    const adminCtx = userCtx({ orgId: o.orgId, userId: admin.id, role: 'admin' });
    await rejects(setUserRole(adminCtx, o.userId, 'staff'), 'forbidden');
    await rejects(deactivateUser(adminCtx, o.userId), 'forbidden');
  });

  it('ends access immediately on deactivation: sessions are revoked and sign-in is refused', async () => {
    const o = await register();
    const email = `leaver-${unique()}@example.test`;
    const { id } = await createUser(o.ctx, { name: 'Leaver', email, role: 'staff', password: 'temporary-pass-1' });
    await auth.api.signInEmail({ body: { email, password: 'temporary-pass-1' } });
    expect((await db.select().from(sessions).where(eq(sessions.userId, id))).length).toBe(1);

    await deactivateUser(o.ctx, id);
    expect((await db.select().from(sessions).where(eq(sessions.userId, id))).length).toBe(0);
    const again = await auth.api.signInEmail({ body: { email, password: 'temporary-pass-1' } }).then(() => null, (e: Error) => e);
    expect(again, 'a deactivated user must not be able to sign in').not.toBeNull();
    expect((await db.select().from(sessions).where(eq(sessions.userId, id))).length).toBe(0);
  });

  it('isolates organizations: another organization\'s users look like they do not exist', async () => {
    const a = await register();
    const b = await register();
    await rejects(setUserRole(b.ctx, a.userId, 'staff'), 'not_found');
    await rejects(deactivateUser(b.ctx, a.userId), 'not_found');
    const listB = await listUsers(b.ctx);
    expect(listB.map((u) => u.id)).toEqual([b.userId]);
    expect(listB.some((u) => u.id === a.userId)).toBe(false);
  });

  it('forbids Staff from listing users', async () => {
    const o = await register();
    const s = await createUser(o.ctx, { name: 'Staf', email: `s-${unique()}@example.test`, role: 'staff', password: 'temporary-pass-1' });
    await rejects(listUsers(userCtx({ orgId: o.orgId, userId: s.id, role: 'staff' })), 'forbidden');
  });
});
