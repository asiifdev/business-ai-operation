import type { APIRoute } from 'astro';
import { z } from 'zod';
import { askAssistant, assistantRequestSchema } from '../../../ai/assistant';
import { db } from '../../../db/client';
import { attachmentsForChat, bindAttachments } from '../../../domain/assistant/attachments';
import { appendTurns } from '../../../domain/assistant/sessions';
import { DomainError } from '../../../domain/errors';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';

export const prerender = false;

const bodySchema = assistantRequestSchema.extend({ locale: z.enum(['id', 'en']).optional(), sessionId: z.string().min(1).max(40).optional(), attachmentIds: z.array(z.string().min(1).max(40)).max(6).optional(), stream: z.boolean().optional() });

/**
 * Asks the assistant one question. It answers only from this organization's data, through the tools of the caller's role.
 * With `stream: true` the answer comes as NDJSON lines: `progress` lines while it works (what it is really doing: which tool,
 * which search words, which site), then one `done` line with the same data the plain call returns, or one `error` line.
 * Checks that can refuse (sign-in, rate limit, input) answer before the stream opens, as ordinary JSON errors.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'ai-chat', 20, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));

    async function answer(onProgress?: Parameters<typeof askAssistant>[2]['onProgress']) {
      // What the person attached: the ones already in this conversation and the ones that came with this message (D-083).
      const attachments = await attachmentsForChat(ctx, body.sessionId, body.attachmentIds ?? []);
      const reply = await askAssistant(db, ctx, {
        attachments,
        onProgress,
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
      return { ...reply, sessionId };
    }

    if (!body.stream) return ok(await answer());

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (line: unknown) => {
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          } catch {
            /* the person left the page: the answer is still saved below */
          }
        };
        try {
          send({ event: 'progress', step: 'think', round: 1 });
          send({ event: 'done', data: await answer((e) => send({ event: 'progress', ...e })) });
        } catch (error) {
          if (!(error instanceof DomainError)) console.error('api error', error);
          send({ event: 'error', code: error instanceof DomainError ? error.code : 'internal' });
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
    });
    // `no-transform` and `X-Accel-Buffering` keep a proxy from holding the lines back until the end.
    return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' } });
  });
