import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { db, pg } from '../../../db/client';
import { auditLog, emailLog, invitations, users } from '../../../db/schema';
import { FakeEmailProvider } from '../../../integrations/email/fake';
import { EmailError } from '../../../integrations/email/provider';
import { makeOrg } from '../../ai/__tests__/support';
import { DomainError } from '../../errors';
import { deactivateUser, deleteUserPermanently } from '../service';
import { sendEmail } from '../../email/service';
import { acceptInvitation, hashToken, inviteUser, listInvitations, previewInvitation, resendInvitation, revokeInvitation } from '../invitations';

afterAll(async () => {
  await pg.end();
});
const prev = process.env.APP_URL;
process.env.APP_URL = 'https://app.test';
afterEach(() => {
  process.env.APP_URL = 'https://app.test';
});
afterAll(() => {
  if (prev === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = prev;
});

const rejects = async (promise: Promise<unknown>, code: string) => {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};
const tokenOf = (fake: FakeEmailProvider, n = 0) => /undangan\/([A-Za-z0-9_-]+)/.exec(fake.sent[n]!.message.text)![1]!;
const mail = () => `u${Math.random().toString(36).slice(2, 10)}@invite.test`;

describe('invitations (D-096)', () => {
  it('emails a one-time link, stores only its hash, and lets the person join with their own password', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider();
    const email = mail();
    const r = await inviteUser(o.adminCtx, { email, role: 'staff', name: 'Budi' }, { provider: fake });
    expect(r).toMatchObject({ emailed: true, status: 'sent', link: null });
    expect(fake.sent).toHaveLength(1);
    const token = tokenOf(fake);
    const [row] = await db.select().from(invitations).where(eq(invitations.id, r.id));
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);

    expect(await previewInvitation(token, o.clock.now())).toMatchObject({ state: 'valid', email, role: 'staff' });
    const joined = await acceptInvitation({ token, name: 'Budi Santoso', password: 'rahasia-panjang-1' }, o.clock.now());
    expect(joined.email).toBe(email);
    const [u] = await db.select().from(users).where(eq(users.id, joined.userId));
    expect(u).toMatchObject({ orgId: o.orgId, role: 'staff', mustChangePassword: false, emailVerified: true });
    expect(await previewInvitation(token, o.clock.now())).toMatchObject({ state: 'used' });
    await rejects(acceptInvitation({ token, name: 'Lagi', password: 'rahasia-panjang-1' }, o.clock.now()), 'expired');
  });

  it('hands the link to the inviter when email is off or fails, and keeps the invitation', async () => {
    const o = await makeOrg();
    const off = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: null });
    expect(off).toMatchObject({ emailed: false, status: 'not_configured' });
    expect(off.link).toContain('https://app.test/undangan/');
    const down = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: new FakeEmailProvider([new EmailError('auth', 'bad key')]) });
    expect(down).toMatchObject({ emailed: false, status: 'failed' });
    expect((await listInvitations(o.adminCtx)).map((i) => i.sendStatus).sort()).toEqual(['failed', 'not_configured']);
  });

  it('replaces an open invitation to the same address and refuses people who already have an account', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider();
    const email = mail();
    await inviteUser(o.adminCtx, { email, role: 'staff' }, { provider: fake });
    await inviteUser(o.adminCtx, { email: email.toUpperCase(), role: 'admin' }, { provider: fake });
    expect(await previewInvitation(tokenOf(fake, 0), o.clock.now())).toMatchObject({ state: 'used' }); // the old link is dead
    expect(await previewInvitation(tokenOf(fake, 1), o.clock.now())).toMatchObject({ state: 'valid', role: 'admin' });
    expect(await listInvitations(o.adminCtx)).toHaveLength(1);
    const [admin] = await db.select({ email: users.email }).from(users).where(eq(users.id, o.adminCtx.userId));
    await rejects(inviteUser(o.ownerCtx, { email: admin!.email, role: 'staff' }, { provider: null }), 'email_taken');
  });

  it('only an Owner invites an Owner, staff cannot invite at all, and other organizations see nothing', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await rejects(inviteUser(a.staffCtx, { email: mail(), role: 'staff' }, { provider: null }), 'forbidden');
    await rejects(inviteUser(a.adminCtx, { email: mail(), role: 'owner' }, { provider: null }), 'forbidden');
    const r = await inviteUser(a.ownerCtx, { email: mail(), role: 'owner' }, { provider: null });
    expect(await listInvitations(b.adminCtx)).toEqual([]);
    await rejects(revokeInvitation(b.adminCtx, r.id), 'not_found');
  });

  it('sending again rotates the link, withdrawing kills it, and an expired link cannot be used', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider();
    const r = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: fake });
    await rejects(resendInvitation(o.adminCtx, r.id, { provider: fake }), 'rate_limited'); // the first mail just went out
    o.clock.set(new Date(o.clock.now().getTime() + 2 * 3_600_000 + 1000)); // two hours later
    await resendInvitation(o.adminCtx, r.id, { provider: fake });
    const at = o.clock.now();
    const later = new Date(at.getTime() + 8 * 86_400_000);
    expect(await previewInvitation(tokenOf(fake, 0), at)).toMatchObject({ state: 'invalid' });
    const fresh = tokenOf(fake, 1);
    expect(await previewInvitation(fresh, at)).toMatchObject({ state: 'valid' });
    expect(await previewInvitation(fresh, later)).toMatchObject({ state: 'expired' });
    await rejects(acceptInvitation({ token: fresh, name: 'Budi', password: 'rahasia-panjang-1' }, later), 'expired');
    await revokeInvitation(o.adminCtx, r.id);
    expect(await previewInvitation(fresh, at)).toMatchObject({ state: 'used' });
    const acts = await db.select({ a: auditLog.action }).from(auditLog).where(and(eq(auditLog.orgId, o.orgId)));
    expect(acts.map((x) => x.a)).toEqual(expect.arrayContaining(['user.invited', 'user.invitation_resent', 'user.invitation_revoked']));
  });

  it('refuses a weak password and an unknown token without saying which', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider();
    await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: fake });
    await expect(acceptInvitation({ token: tokenOf(fake), name: 'Budi', password: 'pendek' }, o.clock.now())).rejects.toThrow();
    await rejects(acceptInvitation({ token: 'x'.repeat(43), name: 'Budi', password: 'rahasia-panjang-1' }, o.clock.now()), 'not_found');
    expect(await previewInvitation('nope')).toEqual({ state: 'invalid' });
  });
});

describe('sendEmail (D-096)', () => {
  const base = (orgId: string) => ({ orgId, to: 'a@b.id', locale: 'id' as const, idempotencyKey: 'k', message: { template: 'welcome' as const, data: { name: 'A', organizationName: 'B', link: 'https://app.test/app/onboarding' } } });

  it('retries once on a temporary failure, logs the attempt without the message, and never throws', async () => {
    const o = await makeOrg();
    const flaky = new FakeEmailProvider([new EmailError('transient', 'busy')]);
    expect(await sendEmail(base(o.orgId), { provider: flaky, wait: async () => undefined })).toMatchObject({ status: 'sent' });
    const dead = new FakeEmailProvider([new EmailError('transient', 'x'), new EmailError('transient', 'y')]);
    expect(await sendEmail(base(o.orgId), { provider: dead, wait: async () => undefined })).toEqual({ status: 'failed', kind: 'transient' });
    expect(await sendEmail(base(o.orgId), { provider: null })).toEqual({ status: 'skipped' });
    const rows = await db.select().from(emailLog).where(eq(emailLog.orgId, o.orgId));
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'sent', 'skipped']);
    expect(JSON.stringify(rows)).not.toContain('onboarding');
  });

  it('does not retry a refusal', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider([new EmailError('rejected', 'bad address')]);
    expect(await sendEmail(base(o.orgId), { provider: fake, wait: async () => undefined })).toEqual({ status: 'failed', kind: 'rejected' });
    expect(fake.sent).toHaveLength(0);
  });
});

describe('deleting a user for good (D-097)', () => {
  it('is Owner-only, needs deactivation first, refuses yourself, then frees the address for a new invitation', async () => {
    const o = await makeOrg();
    await rejects(deleteUserPermanently(o.adminCtx, o.staffCtx.userId), 'forbidden');
    await rejects(deleteUserPermanently(o.ownerCtx, o.staffCtx.userId), 'invalid_state'); // still active
    await rejects(deleteUserPermanently(o.ownerCtx, o.ownerCtx.userId), 'invalid_state'); // yourself
    const [staff] = await db.select({ email: users.email }).from(users).where(eq(users.id, o.staffCtx.userId));
    await rejects(inviteUser(o.ownerCtx, { email: staff!.email, role: 'staff' }, { provider: null }), 'email_taken');

    await deactivateUser(o.ownerCtx, o.staffCtx.userId);
    await deleteUserPermanently(o.ownerCtx, o.staffCtx.userId);
    expect(await db.select().from(users).where(eq(users.id, o.staffCtx.userId))).toEqual([]);
    expect(await inviteUser(o.ownerCtx, { email: staff!.email, role: 'staff' }, { provider: null })).toMatchObject({ status: 'not_configured' });
    const acts = await db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.orgId, o.orgId));
    expect(acts.map((x) => x.a)).toContain('user.deleted');
  });

  it('keeps a person who left records behind, and never reaches into another organization', async () => {
    const a = await makeOrg();
    const b = await makeOrg();
    await deactivateUser(a.ownerCtx, a.adminCtx.userId);
    // An accepted invitation they sent points at them: that history must keep a real person.
    const fake = new FakeEmailProvider();
    const joined = await inviteUser(a.ownerCtx, { email: mail(), role: 'staff' }, { provider: fake });
    await db.update(invitations).set({ invitedBy: a.adminCtx.userId, acceptedAt: new Date() }).where(eq(invitations.id, joined.id));
    await rejects(deleteUserPermanently(a.ownerCtx, a.adminCtx.userId), 'has_history');
    expect(await db.select().from(users).where(eq(users.id, a.adminCtx.userId))).toHaveLength(1);
    await rejects(deleteUserPermanently(b.ownerCtx, a.adminCtx.userId), 'not_found');
  });
});

describe('invitation status and the two-hour wait (D-097)', () => {
  it('shows waiting, expired and accepted with when, and holds a resend back for two hours after a real send', async () => {
    const o = await makeOrg();
    const fake = new FakeEmailProvider();
    const waiting = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: fake });
    const accepted = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: fake });
    await acceptInvitation({ token: tokenOf(fake, 1), name: 'Budi', password: 'rahasia-panjang-1' }, o.clock.now());
    const list = await listInvitations(o.adminCtx);
    const byId = (id: string) => list.find((i) => i.id === id)!;
    expect(byId(waiting.id)).toMatchObject({ status: 'waiting' });
    expect(byId(waiting.id).resendAt).not.toBeNull();
    expect(byId(accepted.id)).toMatchObject({ status: 'accepted', resendAt: null });
    expect(byId(accepted.id).acceptedAt).not.toBeNull();
    expect(list[list.length - 1]!.status).toBe('accepted'); // waiting ones come first
    await rejects(resendInvitation(o.adminCtx, accepted.id, { provider: fake }), 'not_found'); // nothing to resend once accepted
  });

  it('does not make anyone wait for a mail that never left', async () => {
    const o = await makeOrg();
    const r = await inviteUser(o.adminCtx, { email: mail(), role: 'staff' }, { provider: null });
    expect((await listInvitations(o.adminCtx))[0]!.resendAt).toBeNull();
    expect(await resendInvitation(o.adminCtx, r.id, { provider: new FakeEmailProvider() })).toMatchObject({ emailed: true });
  });
});
