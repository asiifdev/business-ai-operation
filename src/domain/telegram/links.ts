import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client';
import { organizations, telegramLinks, telegramPairingCodes, users } from '../../db/schema';
import { generatePairingCode, hashPairingCode, pairingLink } from '../../integrations/telegram/pairing';
import type { Clock } from '../../lib/clock';
import { recordAudit } from '../audit/service';
import type { Ctx } from '../ctx';
import { assertCan, type Role } from '../permissions';
import { who } from '../portfolio/shared';

/** How long a pairing code works (PRD section 6). */
export const PAIRING_TTL_MS = 10 * 60 * 1000;

export interface TelegramStatus {
  linked: boolean;
  username: string | null;
  linkedAt: Date | null;
}

export async function getTelegramStatus(ctx: Ctx): Promise<TelegramStatus> {
  assertCan(ctx, 'telegram.link_self');
  const [link] = await db
    .select({ username: telegramLinks.username, linkedAt: telegramLinks.linkedAt })
    .from(telegramLinks)
    .where(and(eq(telegramLinks.orgId, ctx.orgId), eq(telegramLinks.userId, ctx.userId), isNull(telegramLinks.unlinkedAt)));
  return { linked: Boolean(link), username: link?.username ?? null, linkedAt: link?.linkedAt ?? null };
}

/**
 * A one-time code for `/start <code>` (PRD section 6). Only its hash is stored; the code itself is shown once. A person
 * links only their own account, and the bot gets their role and nothing more (BR-M01-08).
 */
export async function createPairingCode(ctx: Ctx, botUsername: string): Promise<{ code: string; link: string; expiresAt: Date }> {
  assertCan(ctx, 'telegram.link_self');
  const code = generatePairingCode();
  const expiresAt = new Date(ctx.clock.now().getTime() + PAIRING_TTL_MS);
  await db.transaction(async (tx) => {
    await tx.insert(telegramPairingCodes).values({ orgId: ctx.orgId, userId: ctx.userId, codeHash: hashPairingCode(code), expiresAt });
    await recordAudit(tx, who(ctx), { action: 'telegram.code_created', entityType: 'user', entityId: ctx.userId, summary: {} });
  });
  return { code, link: pairingLink(botUsername, code), expiresAt };
}

/** Ends the person's link from the web. The bot stops sending to that chat at once. */
export async function unlinkTelegram(ctx: Ctx): Promise<void> {
  assertCan(ctx, 'telegram.link_self');
  await db.transaction(async (tx) => {
    const ended = await tx
      .update(telegramLinks)
      .set({ unlinkedAt: ctx.clock.now() })
      .where(and(eq(telegramLinks.orgId, ctx.orgId), eq(telegramLinks.userId, ctx.userId), isNull(telegramLinks.unlinkedAt)))
      .returning({ id: telegramLinks.id });
    if (ended.length) await recordAudit(tx, who(ctx), { action: 'telegram.unlinked', entityType: 'user', entityId: ctx.userId, summary: { channel: 'web' } });
  });
}

export interface LinkedUser {
  orgId: string;
  organizationName: string;
  userId: string;
  name: string;
  role: Role;
  locale: 'id' | 'en';
  chatId: number;
  linkedAt: Date;
  timezone: string;
}

const linkedColumns = {
  orgId: users.orgId,
  organizationName: organizations.name,
  userId: users.id,
  name: users.name,
  role: users.role,
  locale: users.locale,
  chatId: telegramLinks.chatId,
  linkedAt: telegramLinks.linkedAt,
  timezone: organizations.timezone,
};

/**
 * Who a private chat belongs to. Only an active link of an active user counts: a deactivated person loses the bot at the
 * same moment as the web (BR-M01-06). Null means "say nothing about the organization".
 */
export async function findLinkedUser(chatId: number): Promise<LinkedUser | null> {
  const [row] = await db
    .select(linkedColumns)
    .from(telegramLinks)
    .innerJoin(users, and(eq(users.orgId, telegramLinks.orgId), eq(users.id, telegramLinks.userId)))
    .innerJoin(organizations, eq(organizations.id, telegramLinks.orgId))
    .where(and(eq(telegramLinks.chatId, chatId), isNull(telegramLinks.unlinkedAt), eq(users.isActive, true)));
  return row ? { ...row, locale: row.locale === 'en' ? 'en' : 'id' } : null;
}

/** Every linked, active person of one organization: who the scheduler sends cards to. */
export async function listLinkedUsers(orgId: string): Promise<LinkedUser[]> {
  const rows = await db
    .select(linkedColumns)
    .from(telegramLinks)
    .innerJoin(users, and(eq(users.orgId, telegramLinks.orgId), eq(users.id, telegramLinks.userId)))
    .innerJoin(organizations, eq(organizations.id, telegramLinks.orgId))
    .where(and(eq(telegramLinks.orgId, orgId), isNull(telegramLinks.unlinkedAt), eq(users.isActive, true)));
  return rows.map((row) => ({ ...row, locale: row.locale === 'en' ? 'en' : 'id' }));
}

/**
 * Redeems `/start <code>`. The claim is one conditional UPDATE (unused and not expired), so a code works once even when
 * two messages race. The chat and the person each keep at most one active link: an older one is ended first. A wrong,
 * used or expired code returns null and the bot answers the same neutral text for all three (PRD section 6).
 */
export async function redeemPairingCode(code: string, chat: { id: number; username?: string }, clock: Clock): Promise<LinkedUser | null> {
  const now = clock.now();
  const linked = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(telegramPairingCodes)
      .set({ usedAt: now })
      .where(and(eq(telegramPairingCodes.codeHash, hashPairingCode(code)), isNull(telegramPairingCodes.usedAt), gt(telegramPairingCodes.expiresAt, now)))
      .returning({ orgId: telegramPairingCodes.orgId, userId: telegramPairingCodes.userId });
    if (!claimed) return false;
    const [person] = await tx.select({ isActive: users.isActive }).from(users).where(and(eq(users.orgId, claimed.orgId), eq(users.id, claimed.userId)));
    if (!person?.isActive) return false;
    await tx
      .update(telegramLinks)
      .set({ unlinkedAt: now })
      .where(and(isNull(telegramLinks.unlinkedAt), or(eq(telegramLinks.chatId, chat.id), eq(telegramLinks.userId, claimed.userId))));
    await tx.insert(telegramLinks).values({ orgId: claimed.orgId, userId: claimed.userId, chatId: chat.id, username: chat.username ?? null, linkedAt: now });
    await recordAudit(tx, { orgId: claimed.orgId, actor: `user:${claimed.userId}`, userId: claimed.userId }, { action: 'telegram.linked', entityType: 'user', entityId: claimed.userId, summary: { channel: 'telegram' } });
    return true;
  });
  return linked ? findLinkedUser(chat.id) : null;
}

/** `/putus` in the chat, or the person blocked the bot: the link ends and nothing more is sent there. */
export async function unlinkChat(chatId: number, clock: Clock, reason: 'command' | 'blocked'): Promise<boolean> {
  return db.transaction(async (tx) => {
    const ended = await tx
      .update(telegramLinks)
      .set({ unlinkedAt: clock.now() })
      .where(and(eq(telegramLinks.chatId, chatId), isNull(telegramLinks.unlinkedAt)))
      .returning({ orgId: telegramLinks.orgId, userId: telegramLinks.userId });
    for (const e of ended) {
      await recordAudit(tx, { orgId: e.orgId, actor: reason === 'blocked' ? 'system:telegram' : `user:${e.userId}`, userId: e.userId }, { action: 'telegram.unlinked', entityType: 'user', entityId: e.userId, summary: { channel: 'telegram', reason } });
    }
    return ended.length > 0;
  });
}
