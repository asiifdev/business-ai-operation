import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pg } from '../../db/client';
import { aiRuns } from '../../db/schema';
import { setAiBudget } from '../../domain/ai/budget';
import { makeOrg } from '../../domain/ai/__tests__/support';
import { AiProviderError } from '../errors';
import { FakeProvider, fail, say } from '../fake-provider';
import { chatOnce, generateImagesOnce, guardedCall, transcribeOnce } from '../run';
import type { ImageResult, TranscribeResult } from '../types';

afterAll(async () => {
  await pg.end();
});

const META = { model: 'muse-image-1.0', rateLimit: {}, attempts: 1 };
const transcript: TranscribeResult = { transcript: 'Halo dunia', durationMs: 22_000, turns: [{ turnId: 1, startMs: 0, endMs: 22_000, transcript: 'Halo dunia', speaker: 'A' }], meta: META };
const images = (n: number): ImageResult => ({ images: Array.from({ length: n }, () => ({ bytes: new Uint8Array(16), mime: 'image/webp' as const })), meta: META });
const wav = new Uint8Array(1);

const row = async (id: string) => (await db.select().from(aiRuns).where(eq(aiRuns.id, id)))[0];

describe('one-call helpers record every call (BR-M07-08)', () => {
  it('chatOnce: structured minutes with tokens and cost, labelled as AI', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ chat: [say('{"summary":"x"}')] });
    const out = await chatOnce({ db, ctx: o.ownerCtx, provider, feature: 'minutes', request: { messages: [{ role: 'user', content: 'rapat' }], effort: 'medium', maxTokens: 2000 }, inputSummary: 'Notulen rapat Selasa', entityType: 'meeting', entityId: 'm1' });
    expect(out).toMatchObject({ ok: true, label: 'dibantu AI', costMicroUsd: 338 });
    if (!out.ok) throw new Error('unreachable');
    expect(await row(out.runId)).toMatchObject({ feature: 'minutes', status: 'ok', inputTokens: 100, outputTokens: 50, inputSummary: 'Notulen rapat Selasa', entityType: 'meeting', entityId: 'm1' });
  });

  it('transcribeOnce: priced by the second of audio', async () => {
    const o = await makeOrg();
    const out = await transcribeOnce({ db, ctx: o.ownerCtx, provider: new FakeProvider({ transcribe: [transcript] }), request: { wav } });
    if (!out.ok) throw new Error('unreachable');
    expect(await row(out.runId)).toMatchObject({ feature: 'transcribe', status: 'ok', audioMs: 22_000, costMicroUsd: 1100, outputSummary: '22 detik audio, 1 giliran' });
  });

  it('generateImagesOnce: priced per image', async () => {
    const o = await makeOrg();
    const out = await generateImagesOnce({ db, ctx: o.ownerCtx, provider: new FakeProvider({ image: [images(3)] }), request: { prompt: 'poster' } });
    if (!out.ok) throw new Error('unreachable');
    expect(await row(out.runId)).toMatchObject({ feature: 'image', status: 'ok', images: 3, costMicroUsd: 30_000 });
  });
});

describe('failures become a message, never a crash (BR-M07-11)', () => {
  it('returns the not-AI label and a friendly message, and records the failed run', async () => {
    const o = await makeOrg();
    const out = await generateImagesOnce({ db, ctx: o.ownerCtx, provider: new FakeProvider({ image: [fail('content_policy', 'Meta Model API 400 (content_policy_violation)')] }), request: { prompt: 'x' } });
    expect(out).toMatchObject({ ok: false, kind: 'content_policy', label: 'ini bukan hasil AI' });
    if (out.ok) throw new Error('unreachable');
    expect(out.message).toMatch(/kebijakan konten/);
    expect(out.message).not.toContain('Meta Model API');
    expect(await row(out.runId!)).toMatchObject({ status: 'error', costMicroUsd: 0 });
  });

  it('blocks on a spent budget without calling the provider, per feature', async () => {
    const o = await makeOrg();
    await setAiBudget(db, o.ownerCtx, 'image', 0);
    const provider = new FakeProvider({ image: [images(1)], transcribe: [transcript] });
    const blocked = await generateImagesOnce({ db, ctx: o.ownerCtx, provider, request: { prompt: 'x' } });
    expect(blocked).toMatchObject({ ok: false, kind: 'budget', runId: null });
    expect(provider.imageCalls).toHaveLength(0);
    // Speech has its own budget and still works.
    expect((await transcribeOnce({ db, ctx: o.ownerCtx, provider, request: { wav } })).ok).toBe(true);
  });

  it('bills a call that used tokens but returned nothing usable', async () => {
    const o = await makeOrg();
    const empty = new AiProviderError('empty', 'cut off', { usage: { inputTokens: 500, outputTokens: 1000, cachedTokens: 0, reasoningTokens: 1000 } });
    const out = await chatOnce({ db, ctx: o.ownerCtx, provider: new FakeProvider({ chat: [empty] }), feature: 'agent', request: { messages: [{ role: 'user', content: 'x' }], effort: 'low', maxTokens: 1000 } });
    expect(out).toMatchObject({ ok: false, kind: 'empty' });
    if (out.ok) throw new Error('unreachable');
    expect(Number((await row(out.runId!)).costMicroUsd)).toBe(Math.ceil(500 * 1.25 + 1000 * 4.25));
  });

  it('records an unexpected error honestly and lets it surface', async () => {
    const o = await makeOrg();
    let runId = '';
    await expect(
      guardedCall({ db, ctx: o.ownerCtx, provider: new FakeProvider() }, { feature: 'agent', model: 'muse-spark-1.3' }, async (run) => {
        runId = run.id;
        throw new TypeError('bug in our code');
      }),
    ).rejects.toThrow('bug in our code');
    expect(await row(runId)).toMatchObject({ status: 'error', error: 'unexpected error' });
  });
});
