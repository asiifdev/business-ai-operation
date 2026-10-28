import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../errors';
import { inspectWav } from '../wav';
import { wav } from './helpers';

describe('inspectWav', () => {
  it('accepts mono 16-bit PCM at 24 kHz and 16 kHz and reports the duration', () => {
    expect(inspectWav(wav({ seconds: 2 }))).toEqual({ sampleRate: 24000, durationMs: 2000 });
    expect(inspectWav(wav({ seconds: 1, rate: 16000 })).sampleRate).toBe(16000);
  });

  it.each([
    ['stereo', wav({ channels: 2 })],
    ['8-bit', wav({ bits: 8 })],
    ['44.1 kHz', wav({ rate: 44100 })],
    ['longer than 10 minutes', wav({ seconds: 601, rate: 16000 })],
    ['not a WAV file', new Uint8Array(100)],
    ['too short to hold a header', new Uint8Array(10)],
  ])('rejects %s before any request is made', (_name, bytes) => {
    expect(() => inspectWav(bytes)).toThrow(AiProviderError);
  });

  it('uses the real data length when a streaming encoder left the size at zero', () => {
    const bytes = wav({ seconds: 1 });
    new DataView(bytes.buffer).setUint32(40, 0, true);
    expect(inspectWav(bytes).durationMs).toBe(1000);
  });
});
