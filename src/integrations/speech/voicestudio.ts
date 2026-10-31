import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
  speak(text: string, narrator: Narrator, opts?: { seed?: number }): Promise<Uint8Array>;
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

export interface ProfileRow {
  id?: unknown;
  name?: unknown;
}

/** Pure: the id of the profile with this name (case-insensitive), or null. */
export function findProfileId(profiles: unknown, name: string): string | null {
  if (!Array.isArray(profiles)) return null;
  const hit = (profiles as ProfileRow[]).find((p) => typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase());
  return typeof hit?.id === 'string' ? hit.id : null;
}

/** Where the narrators' reference recordings live. The server runs from the project folder. */
const referencePath = (file: string) => join(process.cwd(), 'src', 'config', 'voices', file);

export class VoiceStudioNarration implements Narration {
  readonly engine = NARRATION_ENGINE;
  /** Narrator key -> profile id, so the list is asked for once, not for every scene. */
  private readonly profiles = new Map<string, string>();

  /**
   * The voice profile of this narrator, made from its reference recording the first time (D-086). One fixed reference is
   * what keeps every scene in the same voice; a voice described only in words changed from scene to scene.
   */
  async profileOf(narrator: Narrator): Promise<string> {
    const known = this.profiles.get(narrator.key);
    if (known) return known;
    const list = await call('/profiles');
    if (!list.ok) throw new NarrationError('unreachable', `VoiceStudio answered ${list.status}`);
    let id = findProfileId(await list.json().catch(() => null), narrator.profile);
    if (!id) {
      const form = new FormData();
      form.set('name', narrator.profile);
      form.set('kind', 'clone');
      form.set('language', 'Indonesian');
      form.set('seed', String(narrator.seed));
      form.set('ref_text', narrator.reference.text);
      form.set('ref_audio', new Blob([new Uint8Array(await readFile(referencePath(narrator.reference.file)))], { type: 'audio/wav' }), narrator.reference.file);
      const made = await call('/profiles', { method: 'POST', body: form, timeoutMs: 60_000 });
      if (!made.ok) throw new NarrationError('failed', `VoiceStudio could not create the voice (${made.status})`);
      const row = (await made.json().catch(() => ({}))) as ProfileRow;
      id = typeof row.id === 'string' ? row.id : null;
    }
    if (!id) throw new NarrationError('failed', 'VoiceStudio did not return a voice');
    this.profiles.set(narrator.key, id);
    return id;
  }

  async check(): Promise<void> {
    const res = await call('/engines/tts');
    if (!res.ok) throw new NarrationError('unreachable', `VoiceStudio answered ${res.status}`);
    const list = (await res.json().catch(() => ({}))) as EngineList;
    if (!engineReady(list, this.engine)) throw new NarrationError('wrong_engine', `The voice engine ${this.engine} is not the active one`);
  }

  async speak(text: string, narrator: Narrator, opts: { seed?: number } = {}): Promise<Uint8Array> {
    const voice = await this.profileOf(narrator);
    const res = await call('/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.engine, input: text, language: narrator.language, voice, seed: opts.seed ?? narrator.seed, response_format: 'wav' }),
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
