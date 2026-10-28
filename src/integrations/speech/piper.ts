import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { env } from '../../lib/env';
import type { SpeechLocale, SpeechProvider } from './provider';
import { MAX_SPOKEN_CHARS } from './spoken';

export class SpeechError extends Error {
  constructor(
    public readonly kind: 'unavailable' | 'failed' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'SpeechError';
  }
}

const TIMEOUT_MS = 30_000;

function run(bin: string, args: string[], input: Uint8Array | string): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new SpeechError('timeout', `${bin} took too long`));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.stderr.on('data', (d) => (stderr = (stderr + String(d)).slice(-500)));
    child.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timer);
      reject(new SpeechError(err.code === 'ENOENT' ? 'unavailable' : 'failed', `${bin}: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(Buffer.concat(chunks));
      else reject(new SpeechError('failed', `${bin} exited with ${code}: ${stderr.trim().split('\n').at(-1) ?? ''}`));
    });
    child.stdin.on('error', () => undefined); // the exit code says what went wrong
    child.stdin.end(input);
  });
}

const VOICE_ENV: Record<SpeechLocale, { name: string; fallback: string }> = {
  id: { name: 'PIPER_VOICE_ID', fallback: 'id_ID-news_tts-medium' },
  en: { name: 'PIPER_VOICE_EN', fallback: 'en_US-libritts_r-medium' },
};

/** Where `scripts/setup-piper.sh` put Piper and the voice for this language, or null when it is not there (that language stays text). */
export function piperPaths(locale: SpeechLocale): { python: string; voice: string; speaker?: string } | null {
  const dir = resolve(env('PIPER_DIR') ?? '.piper');
  const python = resolve(dir, 'venv/bin/python');
  const voice = resolve(dir, 'voices', `${env(VOICE_ENV[locale].name) ?? VOICE_ENV[locale].fallback}.onnx`);
  if (!existsSync(python) || !existsSync(voice)) return null;
  // A multi-speaker voice (the English one) needs a speaker; the same one every time keeps the voice recognisable.
  return { python, voice, speaker: locale === 'en' ? (env('PIPER_EN_SPEAKER') ?? '40') : undefined };
}

/** Spoken replies are on whenever Piper is installed (`pnpm tts:setup`); without it the bot simply answers in text. */
export const speechEnabled = (): boolean => piperPaths('id') !== null || piperPaths('en') !== null;

/**
 * Text to a Telegram voice note, locally (D-052): Piper (separate process, GPL, never linked into this code) makes a WAV,
 * ffmpeg turns it into OGG/Opus, the only format `sendVoice` plays as a voice note. Nothing leaves the server.
 */
export class PiperSpeech implements SpeechProvider {
  async synthesize(text: string, locale: SpeechLocale) {
    const paths = piperPaths(locale);
    if (!paths) throw new SpeechError('unavailable', `No Piper voice for "${locale}" (run pnpm tts:setup)`);
    const wav = await run(paths.python, [resolve('scripts/piper_tts.py'), paths.voice, ...(paths.speaker ? [paths.speaker] : [])], text.slice(0, MAX_SPOKEN_CHARS));
    const ogg = await run(env('FFMPEG_PATH') ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0', '-vn', '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'], wav);
    // The WAV header gives the length: 16-bit mono after a 44-byte header.
    const sampleRate = wav.readUInt32LE(24);
    const durationMs = Math.round(((wav.byteLength - 44) / 2 / sampleRate) * 1000);
    return { ogg: new Uint8Array(ogg), durationMs };
  }
}
