import type { Ctx } from '../domain/ctx';
import { AiRun, type AiRunStart } from '../domain/ai/runs';
import type { Db } from '../db/client';
import { AiProviderError, type AiErrorKind } from './errors';
import { AI_LABEL, NOT_AI_LABEL, friendlyAiError, type Locale } from './messages';
import type { AiProvider } from './provider';
import type { ChatRequest, ChatResult, ImageEditRequest, ImageRequest, ImageResult, TranscribeRequest, TranscribeResult, VideoReadRequest } from './types';

export type AiOutcome<T> =
  | { ok: true; value: T; runId: string; costMicroUsd: number; label: string }
  | { ok: false; kind: AiErrorKind; message: string; runId: string | null; label: string };

interface Options {
  db: Db;
  ctx: Ctx;
  provider: AiProvider;
  locale?: Locale;
  inputSummary?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * Wraps one model call with the rules every feature shares: budget checked first (BR-M07-07), the call recorded in
 * `ai_runs` with tokens and cost whether it works or not (BR-M07-08), and a failure turned into a friendly message and
 * the "not an AI result" label instead of an exception, so the rest of the page keeps working (BR-M07-11).
 */
export async function guardedCall<T>(
  options: Options,
  start: Pick<AiRunStart, 'feature' | 'model'>,
  call: (run: AiRun) => Promise<{ value: T; summary: string }>,
): Promise<AiOutcome<T>> {
  const locale = options.locale ?? 'id';
  const fail = (kind: AiErrorKind, runId: string | null): AiOutcome<T> => ({ ok: false, kind, message: friendlyAiError(kind, locale), runId, label: NOT_AI_LABEL[locale] });

  let run: AiRun;
  try {
    run = await AiRun.start(options.db, options.ctx, { ...start, inputSummary: options.inputSummary, entityType: options.entityType, entityId: options.entityId });
  } catch (error) {
    if (error instanceof AiProviderError) return fail(error.kind, null);
    throw error;
  }

  try {
    const { value, summary } = await call(run);
    await run.finish('ok', { outputSummary: summary });
    return { ok: true, value, runId: run.id, costMicroUsd: run.spentMicroUsd, label: AI_LABEL[locale] };
  } catch (error) {
    if (error instanceof AiProviderError) {
      // A call that cost tokens but gave nothing usable (for example a null answer) still costs money.
      if (error.details.usage) run.addChat(start.model, error.details.usage);
      await run.finish('error', { error: `${error.kind}: ${error.message}` });
      return fail(error.kind, run.id);
    }
    await run.finish('error', { error: 'unexpected error' });
    throw error;
  }
}

/** One chat call without tools, for example meeting minutes as structured output (M09). */
export function chatOnce(options: Options & { feature: 'agent' | 'minutes'; request: ChatRequest }): Promise<AiOutcome<ChatResult>> {
  return guardedCall(options, { feature: options.feature, model: options.request.model ?? 'muse-spark-1.3' }, async (run) => {
    const result = await options.provider.chat(options.request);
    run.addChat(result.meta.model, result.usage);
    return { value: result, summary: result.text ?? '' };
  });
}

export function transcribeOnce(options: Options & { request: TranscribeRequest }): Promise<AiOutcome<TranscribeResult>> {
  return guardedCall(options, { feature: 'transcribe', model: 'muse-voice-transcribe-1.0' }, async (run) => {
    const result = await options.provider.transcribe(options.request);
    run.addAudio(result.durationMs);
    return { value: result, summary: `${Math.round(result.durationMs / 1000)} detik audio, ${result.turns.length} giliran` };
  });
}

export function editImagesOnce(options: Options & { request: ImageEditRequest }): Promise<AiOutcome<ImageResult>> {
  return guardedCall(options, { feature: 'image', model: 'muse-image-1.0' }, async (run) => {
    const result = await options.provider.editImage(options.request);
    run.addImages(result.images.length);
    return { value: result, summary: `${result.images.length} gambar` };
  });
}

export function generateImagesOnce(options: Options & { request: ImageRequest }): Promise<AiOutcome<ImageResult>> {
  return guardedCall(options, { feature: 'image', model: 'muse-image-1.0' }, async (run) => {
    const result = await options.provider.generateImage(options.request);
    run.addImages(result.images.length);
    return { value: result, summary: `${result.images.length} gambar` };
  });
}

/** One video read (Responses API). Recorded as an `agent` run: the model's tokens are counted like any chat call. */
export function readVideoOnce(options: Options & { request: VideoReadRequest }): Promise<AiOutcome<ChatResult>> {
  return guardedCall(options, { feature: 'agent', model: options.request.model ?? 'muse-spark-1.3' }, async (run) => {
    const result = await options.provider.readVideo(options.request);
    run.addChat(result.meta.model, result.usage);
    return { value: result, summary: result.text ?? '' };
  });
}
