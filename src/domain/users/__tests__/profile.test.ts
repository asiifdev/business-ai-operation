import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../../auth/auth';
import { db, pg } from '../../../db/client';
import { auditLog, users } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { userCtx } from '../../ctx';
import { DomainError } from '../../errors';
import { createUser } from '../service';
import { changeOwnPassword, saveOwnLocale } from '../profile';

afterAll(async () => {
  await pg.end();
});

describe('own language', () => {
  it('saves the chosen language on the account, writes only a real change, and audits it', async () => {
    const o = await makeOrg();
    const before = (await db.select().from(users).where(eq(users.id, o.ownerCtx.userId)))[0].locale;
    const next = before === 'id' ? 'en' : 'id';
    expect(await saveOwnLocale(o.ownerCtx, next)).toBe(true);
    expect((await db.select().from(users).where(eq(users.id, o.ownerCtx.userId)))[0].locale).toBe(next);
    expect(await saveOwnLocale(o.ownerCtx, next)).toBe(false);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'user.locale_changed')));
    expect(rows).toHaveLength(1);
    expect(rows[0].summary).toMatchObject({ locale: next });
  });
});

describe('M01 own password', () => {
  it('replaces a temporary password: old one stops working, new one works, flag cleared, audited without secrets', async () => {
    const o = await makeOrg();
    const email = `temp-${Date.now()}@example.test`;
    const { id } = await createUser(o.ownerCtx, { name: 'Orang Baru', email, role: 'staff', password: 'temporary-pass-1' });
    const ctx = userCtx({ orgId: o.orgId, userId: id, role: 'staff' });
    expect((await db.select().from(users).where(eq(users.id, id)))[0].mustChangePassword).toBe(true);

    await changeOwnPassword(ctx, { currentPassword: 'temporary-pass-1', newPassword: 'my-own-password-9' });

    expect((await db.select().from(users).where(eq(users.id, id)))[0].mustChangePassword).toBe(false);
    expect(await auth.api.signInEmail({ body: { email, password: 'temporary-pass-1' } }).then(() => 'ok', () => 'refused')).toBe('refused');
    expect(await auth.api.signInEmail({ body: { email, password: 'my-own-password-9' } }).then(() => 'ok', () => 'refused')).toBe('ok');
    const [row] = await db.select().from(auditLog).where(and(eq(auditLog.orgId, o.orgId), eq(auditLog.action, 'user.password_changed')));
    expect(JSON.stringify(row)).not.toContain('my-own-password-9');
  });

  it('refuses a wrong current password, an unchanged one, and a short one', async () => {
    const o = await makeOrg();
    const email = `pw-${Date.now()}@example.test`;
    const { id } = await createUser(o.ownerCtx, { name: 'Orang Dua', email, role: 'staff', password: 'temporary-pass-1' });
    const ctx = userCtx({ orgId: o.orgId, userId: id, role: 'staff' });
    const err = await changeOwnPassword(ctx, { currentPassword: 'not-the-password', newPassword: 'another-password-9' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('wrong_password');
    await expect(changeOwnPassword(ctx, { currentPassword: 'temporary-pass-1', newPassword: 'temporary-pass-1' })).rejects.toThrow();
    await expect(changeOwnPassword(ctx, { currentPassword: 'temporary-pass-1', newPassword: 'short' })).rejects.toThrow();
    expect(await auth.api.signInEmail({ body: { email, password: 'temporary-pass-1' } }).then(() => 'ok', () => 'refused')).toBe('ok');
  });
});
