import { statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARRATOR_KEYS, NARRATORS, narratorOf } from '../../../config/narrators';
import { findProfileId, NarrationError, VoiceStudioNarration } from '../voicestudio';

afterEach(() => vi.unstubAllGlobals());

/** A VoiceStudio that only knows `/profiles` and `/v1/audio/speech`, and remembers what it was asked. */
function fakeVoiceStudio(profiles: Array<{ id: string; name: string }>) {
  const asked: Array<{ path: string; method: string; body?: unknown }> = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    asked.push({ path, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body });
    if (path === '/profiles' && (init.method ?? 'GET') === 'GET') return new Response(JSON.stringify(profiles), { status: 200 });
    if (path === '/v1/audio/speech') {
      const wav = new Uint8Array(2000);
      wav.set(new TextEncoder().encode('RIFF'), 0);
      wav.set(new TextEncoder().encode('WAVE'), 8);
      return new Response(wav, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
  return asked;
}

describe('narrators', () => {
  it('offers Sinta and Personal, and Personal carries no recording in this public repository', () => {
    expect(NARRATOR_KEYS).toEqual(['sinta', 'personal']);
    expect(NARRATORS.personal).toMatchObject({ name: 'Personal', profile: 'Personal', language: 'id', seed: 7 });
    expect('reference' in NARRATORS.personal).toBe(false);
    // Sinta keeps the generated reference that fixes its voice; nothing of the owner's own voice is committed.
    expect(statSync(join(process.cwd(), 'src', 'config', 'voices', NARRATORS.sinta.reference.file)).size).toBeGreaterThan(100_000);
    expect(narratorOf('personal').key).toBe('personal');
    expect(narratorOf('unknown').key).toBe('sinta');
  });

  it('finds the saved profile "Personal" whatever its letter case', () => {
    expect(findProfileId([{ id: 'p1', name: 'Personal' }, { id: 's1', name: 'Sinta (Orbyte)' }], NARRATORS.personal.profile)).toBe('p1');
    expect(findProfileId([{ id: 'p1', name: 'personal' }], NARRATORS.personal.profile)).toBe('p1');
  });

  it('speaks with the profile the owner saved in VoiceStudio, and creates nothing', async () => {
    const asked = fakeVoiceStudio([{ id: 'voice-personal', name: 'Personal' }, { id: 'voice-sinta', name: 'Sinta (Orbyte)' }]);
    const wav = await new VoiceStudioNarration().speak('Halo semuanya', NARRATORS.personal);
    expect(wav.byteLength).toBeGreaterThan(1000);
    expect(asked.filter((a) => a.method === 'POST' && a.path === '/profiles')).toEqual([]);
    expect(asked.find((a) => a.path === '/v1/audio/speech')!.body).toMatchObject({ voice: 'voice-personal', language: 'id', seed: 7 });
  });

  it('says the voice is not saved when VoiceStudio has no "Personal", instead of failing like a stopped VoiceStudio', async () => {
    const asked = fakeVoiceStudio([{ id: 'voice-sinta', name: 'Sinta (Orbyte)' }]);
    const err = await new VoiceStudioNarration().speak('Halo', NARRATORS.personal).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(NarrationError);
    expect((err as NarrationError).kind).toBe('voice_missing');
    expect(asked.filter((a) => a.method === 'POST')).toEqual([]);
  });
});
