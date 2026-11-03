import { createHash, randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { newId } from '../../db/ids';
import { accounts, invitations, organizations, users } from '../../db/schema';
import { emailEnabled } from '../../integrations/email';
import type { EmailProvider } from '../../integrations/email/provider';
import { appUrl } from '../../lib/app-url';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { sendEmail } from '../email/service';
import { PASSWORD_MIN_LENGTH } from '../org/service';
import { assertCan, type Role } from '../permissions';
import { who } from '../portfolio/shared';

export const INVITE_TTL_DAYS = 7;
/** An invitation mail that went out cannot be sent again for this long: it stops nagging and protects the sender's reputation. */
export const RESEND_COOLDOWN_MS = 2 * 60 * 60 * 1000;
/** Accepted invitations stay in the list this long, so the inviter can see that it worked. */
const ACCEPTED_VISIBLE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).transform((v) => (v === '' ? null : v)).nullable().optional(),
  role: z.enum(['owner', 'admin', 'staff']),
  locale: z.enum(['id', 'en']).default('id'),
});
export type InviteInput = z.input<typeof inviteSchema>;

const acceptSchema = z.object({
  token: z.string().min(20).max(100),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

/** Only the SHA-256 of the token is stored. The token is 256 random bits, so a fast hash is enough (it cannot be guessed). */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const linkFor = (token: string) => `${appUrl() ?? ''}/undangan/${token}`;

/** Only an Owner may invite an Owner (the same rule as creating one by hand). */
function assertMayInviteRole(ctx: Ctx, role: Role) {
  if (role === 'owner' && ctx.role !== 'owner') throw new DomainError('forbidden', 'only an owner may invite owners');
}

export interface InviteResult {
  id: string;
  /** The email went out. When false the inviter gets `link` to hand over personally. */
  emailed: boolean;
  status: 'sent' | 'failed' | 'not_configured';
  link: string | null;
  expiresAt: Date;
}

type Deps = { provider?: EmailProvider | null };

/** Mails the link and records how it went on the invitation. Never throws (see `sendEmail`). */
async function deliver(ctx: Ctx, invitation: { id: string; email: string; name: string | null; role: Role; locale: 'id' | 'en' }, token: string, expiresAt: Date, deps: Deps): Promise<InviteResult> {
  const [[org], [inviter]] = await Promise.all([
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId)),
    db.select({ name: users.name }).from(users).where(and(eq(users.orgId, ctx.orgId), eq(users.id, ctx.userId))),
  ]);
  const link = linkFor(token);
  const canMail = Boolean(appUrl()) && (deps.provider !== undefined ? deps.provider !== null : emailEnabled());
  const result = canMail
    ? await sendEmail(
        {
          orgId: ctx.orgId,
          to: invitation.email,
          locale: invitation.locale,
          // The token is in the key: a new token (resend) is a new mail, a repeat of the same one is not.
          idempotencyKey: `invitation:${invitation.id}:${hashToken(token).slice(0, 16)}`,
          message: { template: 'invitation', data: { organizationName: org?.name ?? '', inviterName: inviter?.name ?? '', role: invitation.role, link, expiresInDays: INVITE_TTL_DAYS, name: invitation.name } },
        },
        deps,
      )
    : ({ status: 'skipped' } as const);
  const status = result.status === 'sent' ? 'sent' : result.status === 'failed' ? 'failed' : 'not_configured';
  await db.update(invitations).set({ sendStatus: status, ...(status === 'sent' ? { sentAt: ctx.clock.now() } : {}) }).where(eq(invitations.id, invitation.id));
  return { id: invitation.id, emailed: status === 'sent', status, link: status === 'sent' ? null : link, expiresAt };
}

/**
 * Invites a colleague by email (D-096). They get a one-time link, choose their own password and sign in: no password
 * travels by email. An open invitation to the same address is replaced, so only the newest link works. If the email
 * cannot go out the invitation still exists and the inviter receives the link to share personally.
 */
export async function inviteUser(ctx: Ctx, raw: InviteInput, deps: Deps = {}): Promise<InviteResult> {
  assertCan(ctx, 'user.create');
  const input = inviteSchema.parse(raw);
  assertMayInviteRole(ctx, input.role);
  const [taken] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`).limit(1);
  if (taken) throw new DomainError('email_taken');

  const token = newToken();
  const expiresAt = new Date(ctx.clock.now().getTime() + INVITE_TTL_DAYS * DAY_MS);
  const created = await db.transaction(async (tx) => {
    const now = ctx.clock.now();
    await tx.update(invitations).set({ revokedAt: now }).where(and(eq(invitations.orgId, ctx.orgId), sql`lower(${invitations.email}) = ${input.email}`, isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
    const [row] = await tx
      .insert(invitations)
      .values({ orgId: ctx.orgId, email: input.email, name: input.name ?? null, role: input.role, locale: input.locale, tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt })
      .returning({ id: invitations.id });
    await recordAudit(tx, who(ctx), { action: 'user.invited', entityType: 'invitation', entityId: row!.id, summary: { role: input.role } });
    return row!;
  });
  return deliver(ctx, { id: created.id, email: input.email, name: input.name ?? null, role: input.role, locale: input.locale }, token, expiresAt, deps);
}

/** When the invitation may be mailed again, or null if it may be now. */
export function resendAvailableAt(row: { sendStatus: string; sentAt: Date | null }, now: Date): Date | null {
  if (row.sendStatus !== 'sent' || !row.sentAt) return null;
  const at = new Date(row.sentAt.getTime() + RESEND_COOLDOWN_MS);
  return at > now ? at : null;
}

async function loadOpen(ctx: Ctx, id: string) {
  const [row] = await db.select().from(invitations).where(and(eq(invitations.orgId, ctx.orgId), eq(invitations.id, id), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
  if (!row) throw new DomainError('not_found', 'invitation');
  return row;
}

/** Sends it again with a NEW link and a fresh seven days; the old link stops working. */
export async function resendInvitation(ctx: Ctx, id: string, deps: Deps = {}): Promise<InviteResult> {
  assertCan(ctx, 'user.create');
  const row = await loadOpen(ctx, id);
  assertMayInviteRole(ctx, row.role);
  // Only a mail that really went out starts the wait: if it never left (email off, a failure) there is nothing to wait for.
  if (resendAvailableAt(row, ctx.clock.now())) throw new DomainError('rate_limited', 'wait before sending this invitation again');
  const token = newToken();
  const expiresAt = new Date(ctx.clock.now().getTime() + INVITE_TTL_DAYS * DAY_MS);
  await db.transaction(async (tx) => {
    await tx.update(invitations).set({ tokenHash: hashToken(token), expiresAt }).where(eq(invitations.id, id));
    await recordAudit(tx, who(ctx), { action: 'user.invitation_resent', entityType: 'invitation', entityId: id, summary: { role: row.role } });
  });
  return deliver(ctx, row, token, expiresAt, deps);
}

export async function revokeInvitation(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'user.create');
  const row = await loadOpen(ctx, id);
  assertMayInviteRole(ctx, row.role);
  await db.transaction(async (tx) => {
    await tx.update(invitations).set({ revokedAt: ctx.clock.now() }).where(eq(invitations.id, id));
    await recordAudit(tx, who(ctx), { action: 'user.invitation_revoked', entityType: 'invitation', entityId: id, summary: { role: row.role } });
  });
}

/**
 * Invitations to show the inviter: those still waiting (an expired one stays, marked, so it can be sent again) and those
 * accepted in the last 30 days, with when. Withdrawn ones are gone. `resendAt` is set while the two-hour wait after the
 * last mail is running.
 */
export async function listInvitations(ctx: Ctx) {
  assertCan(ctx, 'user.read');
  const now = ctx.clock.now();
  const rows = await db
    .select({ id: invitations.id, email: invitations.email, name: invitations.name, role: invitations.role, expiresAt: invitations.expiresAt, sentAt: invitations.sentAt, sendStatus: invitations.sendStatus, acceptedAt: invitations.acceptedAt, createdAt: invitations.createdAt })
    .from(invitations)
    .where(and(eq(invitations.orgId, ctx.orgId), isNull(invitations.revokedAt)))
    .orderBy(asc(invitations.createdAt));
  return rows
    .filter((r) => !r.acceptedAt || now.getTime() - r.acceptedAt.getTime() <= ACCEPTED_VISIBLE_MS)
    .map((r) => ({ ...r, status: r.acceptedAt ? ('accepted' as const) : r.expiresAt <= now ? ('expired' as const) : ('waiting' as const), resendAt: r.acceptedAt ? null : resendAvailableAt(r, now) }))
    // Waiting ones first (they need attention), accepted ones after.
    .sort((x, y) => Number(x.status === 'accepted') - Number(y.status === 'accepted'));
}

export type InvitationPreview =
  | { state: 'invalid' }
  | { state: 'expired' | 'used' | 'valid'; organizationName: string; email: string; name: string | null; role: Role; locale: 'id' | 'en' };

/** For the public accept page: what the link is, without changing anything. An unknown token reveals nothing. */
export async function previewInvitation(token: string, now: Date = new Date()): Promise<InvitationPreview> {
  if (token.length < 20 || token.length > 100) return { state: 'invalid' };
  const [row] = await db
    .select({ email: invitations.email, name: invitations.name, role: invitations.role, locale: invitations.locale, expiresAt: invitations.expiresAt, acceptedAt: invitations.acceptedAt, revokedAt: invitations.revokedAt, organizationName: organizations.name })
    .from(invitations)
    .innerJoin(organizations, eq(organizations.id, invitations.orgId))
    .where(eq(invitations.tokenHash, hashToken(token)));
  if (!row) return { state: 'invalid' };
  const state = row.acceptedAt || row.revokedAt ? 'used' : row.expiresAt <= now ? 'expired' : 'valid';
  return { state, organizationName: row.organizationName, email: row.email, name: row.name, role: row.role, locale: row.locale };
}

/**
 * The invited person sets their name and password. One transaction: the user, the credential, the invitation marked used
 * and the audit rows, or nothing. The link proves the address, so the email counts as verified. Returns what the
 * endpoint needs to sign them in.
 */
export async function acceptInvitation(raw: unknown, now: Date = new Date()): Promise<{ orgId: string; userId: string; email: string }> {
  const input = acceptSchema.parse(raw);
  const passwordHash = await hashPassword(input.password);
  const userId = newId();
  try {
    return await db.transaction(async (tx) => {
      const [inv] = await tx.select().from(invitations).where(eq(invitations.tokenHash, hashToken(input.token))).for('update');
      if (!inv) throw new DomainError('not_found', 'invitation');
      if (inv.acceptedAt || inv.revokedAt || inv.expiresAt <= now) throw new DomainError('expired', 'invitation');
      await tx.insert(users).values({ id: userId, orgId: inv.orgId, name: input.name, email: inv.email, emailVerified: true, role: inv.role, locale: inv.locale, mustChangePassword: false });
      await tx.insert(accounts).values({ id: newId(), accountId: userId, providerId: 'credential', userId, password: passwordHash });
      await tx.update(invitations).set({ acceptedAt: now }).where(eq(invitations.id, inv.id));
      const actor = { orgId: inv.orgId, actor: `user:${userId}` as const, userId };
      await recordAudit(tx, actor, { action: 'user.invitation_accepted', entityType: 'invitation', entityId: inv.id, summary: { role: inv.role } });
      await recordAudit(tx, actor, { action: 'user.created', entityType: 'user', entityId: userId, summary: { role: inv.role, via: 'invitation' } });
      return { orgId: inv.orgId, userId, email: inv.email };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'uq_users_email_lower')) throw new DomainError('email_taken');
    throw err;
  }
}
