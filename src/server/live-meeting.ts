import { z } from 'zod';
import { AiProviderError } from '../ai/errors';
import { db } from '../db/client';
import { AiRun } from '../domain/ai/runs';
import type { Ctx } from '../domain/ctx';
import { DomainError } from '../domain/errors';
import { LiveTranscript } from '../domain/meetings/live';
import { MAX_DURATION_MS } from '../domain/meetings/rules';
import { createLiveMeeting } from '../domain/meetings/service';
import { assertCan } from '../domain/permissions';
import { env } from '../lib/env';
import { limiter } from '../lib/rate-limit';
import WebSocket from 'ws';

/** PCM 24 kHz, 16-bit, mono: 48,000 bytes per second, the model's native rate (docs: speech to text, send audio). */
const BYTES_PER_MS = 48;
const MAX_FRAME_BYTES = 96_000;
/** The provider closes a realtime session at 60 minutes; stop a little before so the transcript is saved cleanly. */
const MAX_LIVE_MS = Math.min(MAX_DURATION_MS, 58 * 60_000);
const BUDGET_CHECK_MS = 60_000;
const FLUSH_WAIT_MS = 15_000;
const MAX_LIVE_STARTS_PER_HOUR = 6;

export interface UpstreamEvents {
  onEvent: (event: Record<string, unknown>) => void;
  onClose: (code: number, reason: string) => void;
}
export interface Upstream {
  send(pcm: Buffer): void;
  /** Ends the input and lets the provider flush what it still has. */
  end(): void;
  close(): void;
}
export type OpenUpstream = (events: UpstreamEvents) => Promise<Upstream>;

/** The part of a browser socket the session needs; `ws` sockets and the test double both fit. */
export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', fn: (data: Buffer, isBinary: boolean) => void): unknown;
  on(event: 'close', fn: () => void): unknown;
}

/** The realtime endpoint of Muse Voice Transcribe. The key travels in the handshake frame, never in a header (skill, section 7). */
export function metaUpstream(): OpenUpstream {
  return (events) =>
    new Promise<Upstream>((resolve, reject) => {
      const key = env('MODEL_API_KEY');
      if (!key) return reject(new AiProviderError('config', 'MODEL_API_KEY is not set'));
      const base = (env('MODEL_API_BASE_URL') ?? 'https://api.meta.ai/v1').replace(/^http/, 'ws').replace(/\/$/, '');
      const socket = new WebSocket(`${base}/asr/realtime`);
      let ready = false;
      const timer = setTimeout(() => {
        socket.terminate();
        reject(new AiProviderError('timeout', 'the transcription service did not answer'));
      }, 15_000);
      socket.on('open', () =>
        socket.send(
          JSON.stringify({ authorization: { accessToken: `Bearer ${key}` }, audioEncoding: 'PCM_24KHZ', model: 'muse-voice-transcribe-1.0', mode: 'DIARIZATION', partialMode: 'CUMULATIVE', emitAudioProgress: true, languageBias: ['Indonesian', 'English'] }),
        ),
      );
      socket.on('message', (data, isBinary) => {
        if (isBinary) return;
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(data));
        } catch {
          return;
        }
        if (!ready) {
          // The acknowledgement is the only frame with no `type`; a failure here is an error event.
          if (typeof message.sessionId === 'string' && message.type === undefined) {
            ready = true;
            clearTimeout(timer);
            resolve({ send: (pcm) => socket.readyState === WebSocket.OPEN && socket.send(pcm), end: () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'endStream' })), close: () => socket.close() });
          } else if (message.type === 'error') {
            clearTimeout(timer);
            reject(new AiProviderError('unavailable', String(message.message ?? 'handshake failed')));
          }
          return;
        }
        events.onEvent(message);
      });
      socket.on('close', (code, reason) => {
        clearTimeout(timer);
        if (!ready) reject(new AiProviderError(code === 1013 ? 'rate_limited' : 'unavailable', `closed before the handshake (${code})`));
        else events.onClose(code, String(reason));
      });
      socket.on('error', () => undefined); // the close event follows and carries the outcome
    });
}

const startSchema = z.object({ type: z.literal('start'), title: z.string().trim().min(2).max(160), consent: z.literal(true) });

export interface LiveDeps {
  openUpstream: OpenUpstream;
}

/**
 * One live meeting over one browser socket (D-051). The browser sends `{type:'start', title, consent}` then raw PCM frames,
 * and `{type:'stop'}` at the end. Captions flow back as `partial` and `final`; at the end the transcript becomes a meeting
 * and the usual job writes the minutes. Audio is never stored. A dropped connection ends the meeting like a stop, so
 * nothing already said is lost. Spending is recorded in `ai_runs` and checked against the daily budget every minute.
 */
export async function runLiveSession(socket: ClientSocket, ctx: Ctx, deps: LiveDeps): Promise<void> {
  const say = (event: Record<string, unknown>) => {
    try {
      socket.send(JSON.stringify(event));
    } catch {
      /* the browser is gone; the transcript is still saved below */
    }
  };
  const fail = (code: string, message: string) => {
    say({ type: 'error', code, message });
    socket.close(1000, code);
  };

  let transcript: LiveTranscript | null = null;
  let upstream: Upstream | null = null;
  let run: AiRun | null = null;
  let title = '';
  let bytes = 0;
  let starting = false;
  let stopping = false;
  let finished = false;
  let budgetTimer: ReturnType<typeof setInterval> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveClosed: () => void = () => undefined;
  const upstreamClosed = new Promise<void>((resolve) => (resolveClosed = resolve));
  const pending: Buffer[] = [];
  let opening: Promise<void> = Promise.resolve();

  const finish = async (reason: 'stop' | 'dropped' | 'limit' | 'budget' | 'upstream') => {
    if (finished) return;
    // A stop that arrives while the connection is still opening waits for it, so the transcript service is always closed properly.
    await opening;
    if (finished || !transcript) return;
    finished = true;
    stopping = true;
    clearInterval(budgetTimer);
    // Let the provider flush the last words before the transcript is read.
    if (upstream) {
      upstream.end();
      flushTimer = setTimeout(resolveClosed, FLUSH_WAIT_MS);
      await upstreamClosed;
      clearTimeout(flushTimer);
      upstream.close();
    }
    const audioMs = Math.max(transcript.audioMs, Math.round(bytes / BYTES_PER_MS));
    run?.addAudio(audioMs);
    try {
      const turns = transcript.turns();
      if (turns.length === 0) {
        await run?.finish('ok', { outputSummary: 'no speech' });
        say({ type: 'ended', reason, meetingId: null });
      } else {
        const meeting = await createLiveMeeting(ctx, { title, durationMs: audioMs, turns });
        await run?.finish('ok', { outputSummary: `${turns.length} giliran, ${Math.round(audioMs / 1000)} detik` });
        say({ type: 'ended', reason, meetingId: meeting.id });
      }
    } catch (error) {
      await run?.finish('error', { error: 'could not save the live meeting' }).catch(() => undefined);
      say({ type: 'error', code: 'save_failed', message: error instanceof DomainError ? error.message : 'save failed' });
    }
    socket.close(1000, 'done');
  };

  const start = async (message: unknown) => {
    if (starting || upstream) return;
    starting = true;
    const parsed = startSchema.safeParse(message);
    if (!parsed.success) return fail('invalid', 'title and consent are required');
    try {
      assertCan(ctx, 'meeting.upload');
    } catch {
      return fail('forbidden', 'not allowed');
    }
    if (!limiter.allow(`live-start:${ctx.userId}`, MAX_LIVE_STARTS_PER_HOUR, 3_600_000)) return fail('rate_limited', 'too many live meetings in an hour');
    title = parsed.data.title;
    transcript = new LiveTranscript();
    try {
      run = await AiRun.start(db, ctx, { feature: 'transcribe', model: 'muse-voice-transcribe-1.0', inputSummary: 'Rapat langsung (realtime)', entityType: 'meeting' });
      upstream = await deps.openUpstream({
        onEvent: (event) => {
          if (event.type === 'error') return say({ type: 'warning', message: String(event.message ?? '') });
          const caption = transcript!.handle(event);
          if (caption) say(caption);
        },
        onClose: (code) => {
          resolveClosed();
          // An early close that we did not ask for ends the meeting with what was captured.
          if (!stopping) void finish('upstream');
          void code;
        },
      });
    } catch (error) {
      await run?.finish('error', { error: error instanceof AiProviderError ? error.kind : 'unexpected' }).catch(() => undefined);
      const kind = error instanceof AiProviderError ? error.kind : 'unavailable';
      finished = true;
      return fail(kind, kind === 'budget' ? 'daily AI budget used up' : 'transcription is not available');
    }
    for (const frame of pending.splice(0)) upstream.send(frame);
    budgetTimer = setInterval(() => {
      void run
        ?.assertBudget()
        .then(() => undefined)
        .catch(() => void finish('budget'));
    }, BUDGET_CHECK_MS);
    say({ type: 'ready' });
  };

  socket.on('message', (data, isBinary) => {
    if (finished) return;
    if (!isBinary) {
      let message: { type?: string };
      try {
        message = JSON.parse(String(data));
      } catch {
        return;
      }
      if (message.type === 'start') opening = start(message);
      else if (message.type === 'stop') void finish('stop');
      return;
    }
    if (data.byteLength === 0 || data.byteLength > MAX_FRAME_BYTES || data.byteLength % 2 !== 0) return;
    bytes += data.byteLength;
    if (bytes / BYTES_PER_MS > MAX_LIVE_MS) return void finish('limit');
    if (upstream) upstream.send(data);
    else if (starting && pending.length < 400) pending.push(data); // about 30 seconds while the connection opens
  });
  socket.on('close', () => {
    // A closed browser still saves what was said (nothing captured is thrown away silently).
    if (!finished && transcript) void finish('dropped');
  });
}
