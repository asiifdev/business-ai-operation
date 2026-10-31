import type { Narrator } from '../../config/narrators';
import { env } from '../../lib/env';

/**
 * The narration engine for videos (D-086): VoiceStudio running as a SEPARATE process on this machine (AGPL-3.0, so this
 * code only ever talks to it over HTTP and never imports it), speaking with the VoxCPM2 model (Apache-2.0). Meta has no
 * text to speech, so this is the replaceable part, like `AiProvider` is for the models.
 *
 * Two guards keep the licence honest: every request names the model explicitly, and before a video starts `check()` must
 * find that exact engine active and available. The default engine of VoiceStudio (OmniVoice) has non-commercial weights,
 * so a silent fall back to it must never happen.
 */
export const NARRATION_ENGINE = 'voxcpm2';

export class NarrationError extends Error {
  constructor(
    public readonly kind: 'unreachable' | 'wrong_engine' | 'failed',
    message: string,
  ) {
    super(message);
    this.name = 'NarrationError';
  }
}

export interface Narration {
  /** The engine name recorded with the video. */
  readonly engine: string;
  /** Throws a `NarrationError` unless the engine is reachable, active and available. */
  check(): Promise<void>;
  /** A WAV of `text` read aloud. */
  speak(text: string, narrator: Narrator): Promise<Uint8Array>;
}

const baseUrl = () => (env('VOICESTUDIO_URL') ?? 'http://127.0.0.1:3900').replace(/\/+$/, '');

/** One line of speech is 20 to 90 seconds on a laptop, so a request may take a few minutes. */
const SPEAK_TIMEOUT_MS = 8 * 60_000;

async function call(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  try {
    return await fetch(`${baseUrl()}${path}`, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 10_000) });
  } catch {
    throw new NarrationError('unreachable', 'VoiceStudio cannot be reached');
  }
}

export interface EngineList {
  active?: unknown;
  backends?: Array<{ id?: unknown; available?: unknown }>;
}

/** Pure: does this `/engines/tts` answer show the narration engine active and available? */
export function engineReady(list: EngineList, engine = NARRATION_ENGINE): boolean {
  if (list.active !== engine) return false;
  return (list.backends ?? []).some((b) => b.id === engine && b.available === true);
}

/** Pure: a WAV answer is real audio, not an error page that happened to say 200. */
export function looksLikeWav(bytes: Uint8Array): boolean {
  return bytes.byteLength > 1000 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
}

export class VoiceStudioNarration implements Narration {
  readonly engine = NARRATION_ENGINE;

  async check(): Promise<void> {
    const res = await call('/engines/tts');
    if (!res.ok) throw new NarrationError('unreachable', `VoiceStudio answered ${res.status}`);
    const list = (await res.json().catch(() => ({}))) as EngineList;
    if (!engineReady(list, this.engine)) throw new NarrationError('wrong_engine', `The voice engine ${this.engine} is not the active one`);
  }

  async speak(text: string, narrator: Narrator): Promise<Uint8Array> {
    const res = await call('/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.engine, input: text, language: narrator.language, description: narrator.description, seed: narrator.seed, response_format: 'wav' }),
      timeoutMs: SPEAK_TIMEOUT_MS,
    });
    if (!res.ok) throw new NarrationError('failed', `VoiceStudio could not speak (${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!looksLikeWav(bytes)) throw new NarrationError('failed', 'VoiceStudio did not return audio');
    return bytes;
  }
}

let current: Narration | undefined;

export function getNarration(): Narration {
  return (current ??= new VoiceStudioNarration());
}

/** Tests swap the engine here. */
export function setNarration(narration: Narration | undefined): void {
  current = narration;
}
