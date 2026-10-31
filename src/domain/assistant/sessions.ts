import { and, asc, desc, eq, ilike, inArray, isNotNull, max } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/client';
import { approvals, assistantMessages, assistantSessions } from '../../db/schema';
import type { Ctx } from '../ctx';
import { DomainError } from '../errors';
import { assertCan } from '../permissions';

export const TITLE_MAX = 80;
/** A session keeps this many turns; the oldest are dropped from the list, never from the model's context rules (those are the client's last ten). */
const MESSAGE_LIMIT = 400;

export type MessageKind = 'user' | 'assistant' | 'error';

export interface SessionRow {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredMessage {
  seq: number;
  kind: MessageKind;
  body: unknown;
  createdAt: Date;
}

/** The title of a new session: the first question, on one line and shortened. */
export const titleFrom = (question: string): string => {
  const line = question.replace(/\s+/g, ' ').trim();
  return (line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line) || '…';
};

const mine = (ctx: Ctx, id: string) => and(eq(assistantSessions.orgId, ctx.orgId), eq(assistantSessions.userId, ctx.userId), eq(assistantSessions.id, id));

async function loadMine(tx: Pick<typeof db, 'select'>, ctx: Ctx, id: string): Promise<SessionRow> {
  const [row] = await tx
    .select({ id: assistantSessions.id, title: assistantSessions.title, createdAt: assistantSessions.createdAt, updatedAt: assistantSessions.updatedAt })
    .from(assistantSessions)
    .where(mine(ctx, id));
  // Someone else's session looks exactly like a missing one.
  if (!row) throw new DomainError('not_found', 'assistant session');
  return row;
}

/** The person's own conversations, most recently used first. Nobody else's are ever listed, whatever their role. */
export async function listSessions(ctx: Ctx, opts: { q?: string; limit?: number } = {}): Promise<SessionRow[]> {
  assertCan(ctx, 'assistant.use');
  const q = opts.q?.trim();
  return db
    .select({ id: assistantSessions.id, title: assistantSessions.title, createdAt: assistantSessions.createdAt, updatedAt: assistantSessions.updatedAt })
    .from(assistantSessions)
    .where(and(eq(assistantSessions.orgId, ctx.orgId), eq(assistantSessions.userId, ctx.userId), q ? ilike(assistantSessions.title, `%${q.replace(/[%_\\]/g, '\\$&')}%`) : undefined))
    .orderBy(desc(assistantSessions.updatedAt))
    .limit(Math.min(opts.limit ?? 100, 200));
}

export async function getSession(ctx: Ctx, id: string): Promise<SessionRow & { messages: StoredMessage[] }> {
  assertCan(ctx, 'assistant.use');
  const session = await loadMine(db, ctx, id);
  const messages = await db
    .select({ seq: assistantMessages.seq, kind: assistantMessages.kind, body: assistantMessages.body, createdAt: assistantMessages.createdAt })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.orgId, ctx.orgId), eq(assistantMessages.sessionId, id)))
    .orderBy(asc(assistantMessages.seq))
    .limit(MESSAGE_LIMIT);
  return { ...session, messages: await markUndone(ctx, messages as StoredMessage[]) };
}

interface AutoRanBody { autoRan?: Array<{ id?: unknown; undone?: boolean }> }

/**
 * An action the assistant ran by itself (D-082) can be taken back, and that must still show after a reload: the stored
 * reply only knows it ran, so the cards of actions already undone get `undone: true` from the approvals table.
 */
async function markUndone(ctx: Ctx, messages: StoredMessage[]): Promise<StoredMessage[]> {
  const ids = new Set<string>();
  for (const m of messages) for (const item of (m.body as AutoRanBody | null)?.autoRan ?? []) if (typeof item.id === 'string') ids.add(item.id);
  if (ids.size === 0) return messages;
  const done = await db
    .select({ id: approvals.id })
    .from(approvals)
    .where(and(eq(approvals.orgId, ctx.orgId), inArray(approvals.id, [...ids]), isNotNull(approvals.undoneAt)));
  if (done.length === 0) return messages;
  const undone = new Set(done.map((r) => r.id));
  return messages.map((m) => {
    const body = m.body as AutoRanBody | null;
    if (!body?.autoRan?.some((item) => typeof item.id === 'string' && undone.has(item.id))) return m;
    return { ...m, body: { ...body, autoRan: body.autoRan.map((item) => (typeof item.id === 'string' && undone.has(item.id) ? { ...item, undone: true } : item)) } };
  });
}

/**
 * Adds turns to a session in order, creating the session first when there is none (its title is the first question).
 * Returns the session id so a new conversation can carry on.
 */
export async function appendTurns(ctx: Ctx, sessionId: string | null | undefined, turns: Array<{ kind: MessageKind; body: unknown }>, firstQuestion: string): Promise<string> {
  assertCan(ctx, 'assistant.use');
  if (turns.length === 0) throw new DomainError('validation', 'nothing to store');
  return db.transaction(async (tx) => {
    let id = sessionId ?? null;
    if (id) await loadMine(tx, ctx, id);
    else {
      const [created] = await tx.insert(assistantSessions).values({ orgId: ctx.orgId, userId: ctx.userId, title: titleFrom(firstQuestion) }).returning({ id: assistantSessions.id });
      id = created.id;
    }
    const [{ last }] = await tx.select({ last: max(assistantMessages.seq) }).from(assistantMessages).where(eq(assistantMessages.sessionId, id));
    let seq = (last ?? 0) + 1;
    for (const turn of turns) await tx.insert(assistantMessages).values({ orgId: ctx.orgId, sessionId: id, seq: seq++, kind: turn.kind, body: turn.body as object });
    await tx.update(assistantSessions).set({ updatedAt: ctx.clock.now() }).where(mine(ctx, id));
    return id;
  });
}

const titleSchema = z.string().trim().min(1).max(TITLE_MAX);

export async function renameSession(ctx: Ctx, id: string, title: string): Promise<void> {
  assertCan(ctx, 'assistant.use');
  const next = titleSchema.parse(title);
  await loadMine(db, ctx, id);
  await db.update(assistantSessions).set({ title: next }).where(mine(ctx, id));
}

/** A person deletes their own conversation; its messages go with it. */
export async function deleteSession(ctx: Ctx, id: string): Promise<void> {
  assertCan(ctx, 'assistant.use');
  await loadMine(db, ctx, id);
  await db.delete(assistantSessions).where(mine(ctx, id));
}
