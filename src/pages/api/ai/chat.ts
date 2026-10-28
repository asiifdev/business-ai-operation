import type { APIRoute } from 'astro';
import { z } from 'zod';
import { askAssistant, assistantRequestSchema } from '../../../ai/assistant';
import { db } from '../../../db/client';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const bodySchema = assistantRequestSchema.extend({ locale: z.enum(['id', 'en']).optional() });

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
    return ok(reply);
  });
