import type { APIRoute } from 'astro';
import { z } from 'zod';
import { askAssistant, assistantRequestSchema } from '../../../ai/assistant';
import { db } from '../../../db/client';
import { attachmentsForChat, bindAttachments } from '../../../domain/assistant/attachments';
import { appendTurns } from '../../../domain/assistant/sessions';
import { DomainError } from '../../../domain/errors';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const bodySchema = assistantRequestSchema.extend({ locale: z.enum(['id', 'en']).optional(), sessionId: z.string().min(1).max(40).optional(), attachmentIds: z.array(z.string().min(1).max(40)).max(6).optional() });

/** Asks the assistant one question. It answers only from this organization's data, through the tools of the caller's role. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'ai-chat', 20, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));
    // What the person attached: the ones already in this conversation and the ones that came with this message (D-083).
    const attachments = await attachmentsForChat(ctx, body.sessionId, body.attachmentIds ?? []);
    const reply = await askAssistant(db, ctx, {
      attachments,
      request: { messages: body.messages },
      organizationName: context.locals.organizationName ?? '',
      locale: body.locale ?? context.locals.user?.locale ?? 'id',
    });
    // The conversation is kept for the person: their question and the whole answer, in one transaction.
    const question = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const added = attachments.filter((a) => a.isNew).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
    const turns = [{ kind: 'user' as const, body: { text: question, ...(added.length ? { attachments: added } : {}) } }, { kind: 'assistant' as const, body: reply }];
    // A conversation that was deleted meanwhile (another tab) must not lose this answer: it starts a new one.
    const sessionId = await appendTurns(ctx, body.sessionId, turns, question).catch((error: unknown) => {
      if (body.sessionId && error instanceof DomainError && error.code === 'not_found') return appendTurns(ctx, null, turns, question);
      throw error;
    });
    await bindAttachments(ctx, added.map((a) => a.id), sessionId);
    return ok({ ...reply, sessionId });
  });
