import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectWav } from '../ai/wav';
import { env } from '../lib/env';

/**
 * Pieces of at most 9 minutes: under the 10-minute limit of Muse Voice Transcribe with room to spare, and at 24 kHz
 * 16-bit mono about 26 MB, under the 32 MB request limit (BR-M09-01, PRD M09).
 */
export const SEGMENT_SECONDS = 9 * 60;

export interface WavSegment {
  wav: Uint8Array;
  /** Where this piece starts in the whole recording, to shift its turn times. */
  offsetMs: number;
  durationMs: number;
}

export class AudioError extends Error {
  constructor(
    public readonly kind: 'ffmpeg_missing' | 'unreadable' | 'too_long',
    message: string,
  ) {
    super(message);
    this.name = 'AudioError';
  }
}

/** The duration of a WAV the transcription API takes as it is (mono 16-bit, 16/24 kHz, one piece), or null. */
function readyWav(bytes: Uint8Array): number | null {
  try {
    const { durationMs } = inspectWav(bytes);
    return durationMs <= SEGMENT_SECONDS * 1000 ? durationMs : null;
  } catch {
    return null;
  }
}

function run(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-2000);
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (err: Error & { code?: string }) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT' ? new AudioError('ffmpeg_missing', 'ffmpeg is not installed on this server') : err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new AudioError('unreadable', `ffmpeg could not read the audio (exit ${code}): ${stderr.split('\n').filter(Boolean).at(-1) ?? ''}`));
    });
  });
}

/**
 * Converts any audio ffmpeg can read (mp3, m4a, ogg/opus voice notes, webm, wav) to WAV mono 16-bit PCM 24 kHz, the
 * only format the transcription API accepts (docs/02 section 0), and cuts it into pieces. Metadata is dropped. The input
 * is untrusted: it is only ever handed to ffmpeg as a file, never interpreted here.
 */
export async function toWavSegments(input: Uint8Array, opts: { maxDurationMs: number }): Promise<WavSegment[]> {
  // Already the right WAV and short enough for one request: no conversion needed (and no ffmpeg required).
  const ready = readyWav(input);
  if (ready) return [{ wav: input, offsetMs: 0, durationMs: ready }];
  const dir = await mkdtemp(join(tmpdir(), 'orbyte-audio-'));
  try {
    const source = join(dir, 'input');
    await writeFile(source, input);
    const bin = env('FFMPEG_PATH') ?? 'ffmpeg';
    await run(
      bin,
      ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', source, '-vn', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-reset_timestamps', '1', join(dir, 'part%03d.wav')],
      10 * 60_000,
    );
    const parts = (await readdir(dir)).filter((f) => /^part\d{3}\.wav$/.test(f)).sort();
    if (parts.length === 0) throw new AudioError('unreadable', 'no audio found in the file');
    const segments: WavSegment[] = [];
    let offsetMs = 0;
    for (const name of parts) {
      const wav = new Uint8Array(await readFile(join(dir, name)));
      const { durationMs } = inspectWav(wav);
      if (durationMs < 200) continue; // a sliver at the very end carries no speech
      segments.push({ wav, offsetMs, durationMs });
      offsetMs += durationMs;
      if (offsetMs > opts.maxDurationMs) throw new AudioError('too_long', 'the recording is longer than allowed');
    }
    if (segments.length === 0) throw new AudioError('unreadable', 'no audio found in the file');
    return segments;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
