import type { APIRoute } from 'astro';
import { z } from 'zod';
import { askAssistant, assistantRequestSchema } from '../../../ai/assistant';
import { db } from '../../../db/client';
import { appendTurns } from '../../../domain/assistant/sessions';
import { DomainError } from '../../../domain/errors';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const bodySchema = assistantRequestSchema.extend({ locale: z.enum(['id', 'en']).optional(), sessionId: z.string().min(1).max(40).optional() });

/** Asks the assistant one question. It answers only from this organization's data, through the tools of the caller's role. */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'ai-chat', 20, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));
    const reply = await askAssistant(db, ctx, {
      request: { messages: body.messages },
      organizationName: context.locals.organizationName ?? '',
      locale: body.locale ?? context.locals.user?.locale ?? 'id',
    });
    // The conversation is kept for the person: their question and the whole answer, in one transaction.
    const question = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const turns = [{ kind: 'user' as const, body: { text: question } }, { kind: 'assistant' as const, body: reply }];
    // A conversation that was deleted meanwhile (another tab) must not lose this answer: it starts a new one.
    const sessionId = await appendTurns(ctx, body.sessionId, turns, question).catch((error: unknown) => {
      if (body.sessionId && error instanceof DomainError && error.code === 'not_found') return appendTurns(ctx, null, turns, question);
      throw error;
    });
    return ok({ ...reply, sessionId });
  });
