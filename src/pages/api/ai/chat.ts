import type { APIRoute } from 'astro';
import { z } from 'zod';
import { askAssistant, assistantRequestSchema } from '../../../ai/assistant';
import type { AgentProgress } from '../../../ai/progress';
import { db } from '../../../db/client';
import { attachmentsForChat, bindAttachments, readPendingAttachments } from '../../../domain/assistant/attachments';
import { appendTurns, beginAnswer, endAnswer } from '../../../domain/assistant/sessions';
import { DomainError } from '../../../domain/errors';
import { handle, ok, rateLimit, readJson, requireCtx } from '../../../lib/api';
import { toWavSegments } from '../../../server/audio';

export const prerender = false;

const bodySchema = assistantRequestSchema.extend({ locale: z.enum(['id', 'en']).optional(), sessionId: z.string().min(1).max(40).optional(), attachmentIds: z.array(z.string().min(1).max(40)).max(6).optional(), stream: z.boolean().optional() });

/**
 * Asks the assistant one question. It answers only from this organization's data, through the tools of the caller's role.
 * The question is stored the moment it arrives (D-090), so every view of the conversation shows it while the answer is made.
 * Attachments are only uploaded before this; they are read here, after the message is sent, with progress.
 * With `stream: true` the answer comes as NDJSON lines: a `session` line with the conversation's id, `progress` lines while it works
 * (what it is really doing: which file, which tool, which search words), then one `done` line with the same data the plain call
 * returns, or one `error` line. Checks that can refuse (sign-in, rate limit, input) answer before the stream opens, as ordinary JSON errors.
 */
export const POST: APIRoute = (context) =>
  handle(async () => {
    const ctx = requireCtx(context);
    const limited = rateLimit(ctx, 'ai-chat', 20, 60_000);
    if (limited) return limited;
    const body = bodySchema.parse(await readJson(context.request));

    async function answer(onProgress?: (e: AgentProgress) => void, onSession?: (id: string) => void) {
      const question = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      // What the person attached: the ones already in this conversation and the ones that came with this message (D-083).
      const before = await attachmentsForChat(ctx, body.sessionId, body.attachmentIds ?? []);
      const added = before.filter((a) => a.isNew).map((a) => ({ id: a.id, name: a.name, kind: a.kind }));
      // The question is kept first. A conversation that was deleted meanwhile (another tab) starts a new one.
      const userTurn = [{ kind: 'user' as const, body: { text: question, ...(added.length ? { attachments: added } : {}) } }];
      const sessionId = await appendTurns(ctx, body.sessionId, userTurn, question).catch((error: unknown) => {
        if (body.sessionId && error instanceof DomainError && error.code === 'not_found') return appendTurns(ctx, null, userTurn, question);
        throw error;
      });
      await bindAttachments(ctx, added.map((a) => a.id), sessionId);
      beginAnswer(sessionId);
      try {
        onSession?.(sessionId);
        const issues = await readPendingAttachments(ctx, added.map((a) => a.id), { toWav: toWavSegments }, (name) => onProgress?.({ step: 'attachment', name }));
        const newIds = new Set(added.map((a) => a.id));
        const attachments = (await attachmentsForChat(ctx, sessionId, [])).map((a) => ({ ...a, isNew: newIds.has(a.id) }));
        const reply = await askAssistant(db, ctx, {
          attachments,
          attachmentIssues: issues,
          onProgress,
          request: { messages: body.messages },
          organizationName: context.locals.organizationName ?? '',
          locale: body.locale ?? context.locals.user?.locale ?? 'id',
        });
        await appendTurns(ctx, sessionId, [{ kind: 'assistant', body: reply }], question);
        return { ...reply, sessionId };
      } finally {
        endAnswer(sessionId);
      }
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
          send({ event: 'done', data: await answer((e) => send({ event: 'progress', ...e }), (id) => send({ event: 'session', sessionId: id })) });
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
