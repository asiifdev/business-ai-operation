import { AiProviderError } from './errors';

export interface WavInfo {
  sampleRate: number;
  durationMs: number;
}

/** Meta limits for the file endpoint: 10 minutes and 32 MB per request. */
export const MAX_WAV_MS = 10 * 60 * 1000;
export const MAX_WAV_BYTES = 32 * 1024 * 1024;

function tag(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
}

/**
 * Checks that the audio is what Muse Voice Transcribe accepts (RIFF/WAVE, mono, 16-bit PCM, 16 or 24 kHz) and that it
 * is within the length and size limits, so a wrong file fails here with a clear message instead of costing a request.
 */
export function inspectWav(bytes: Uint8Array): WavInfo {
  const fail = (message: string): never => {
    throw new AiProviderError('bad_request', message);
  };
  if (bytes.byteLength > MAX_WAV_BYTES) fail('Audio is larger than 32 MB: split it into shorter clips');
  if (bytes.byteLength < 44 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    return fail('Audio must be a WAV file: convert it with ffmpeg first');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let sampleRate = 0;
  let byteRate = 0;
  let dataBytes = -1;
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && body + 16 <= bytes.byteLength) {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      byteRate = view.getUint32(body + 8, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) fail('Audio must be mono 16-bit PCM WAV');
    } else if (id === 'data') {
      // Streaming encoders leave the size as 0xFFFFFFFF or 0: use what is actually there.
      dataBytes = size === 0 || body + size > bytes.byteLength ? bytes.byteLength - body : size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!sampleRate || !byteRate || dataBytes < 0) return fail('Audio WAV header is incomplete');
  if (sampleRate !== 16000 && sampleRate !== 24000) fail('Audio must be 16 kHz or 24 kHz');
  const durationMs = Math.round((dataBytes / byteRate) * 1000);
  if (durationMs > MAX_WAV_MS) fail('Audio is longer than 10 minutes: split it into shorter clips');
  if (durationMs === 0) fail('Audio is empty');
  return { sampleRate, durationMs };
}
