import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { FakeProvider } from '../../../ai/fake-provider';
import { webSearchCostMicroUsd } from '../../../ai/pricing';
import type { WebSearchResult } from '../../../ai/types';
import { db, pg } from '../../../db/client';
import { aiRuns } from '../../../db/schema';
import { makeOrg } from '../../ai/__tests__/support';
import { leaksPrivateData, searchWeb } from '../search';

afterAll(async () => {
  await pg.end();
});

const answer = (extra: Partial<WebSearchResult> = {}): WebSearchResult => ({ text: 'Ada tiga kafe: A, B, C.', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1000, outputTokens: 200, cachedTokens: 0, reasoningTokens: 0 }, meta: { model: 'muse-spark-1.3', rateLimit: {}, attempts: 1 }, sources: [{ url: 'https://contoh.id/kafe', title: 'Daftar kafe' }], searches: 2, ...extra });

describe('web search for research and finding clients (D-085)', () => {
  it('keeps private data out of the query, in code', () => {
    for (const q of ['kafe di Bandung', 'Kopi Kenangan pendiri', 'startup logistik Surabaya 2026']) expect(leaksPrivateData(q), q).toBe(false);
    for (const q of ['kontak budi@toko.com', 'tagihan Rp 12.500.000 klien kami', 'telepon 0853 1111 1010', 'rekening 1234567890', 'IDR 5000000']) expect(leaksPrivateData(q), q).toBe(true);
  });

  it('refuses a query with private data without calling the model', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ search: [answer()] });
    const r = await searchWeb(o.ownerCtx, 'cari info Toko Maju email budi@toko.com', provider);
    expect(r).toMatchObject({ ok: false, reason: 'private' });
    expect(provider.searchCalls).toHaveLength(0);
    expect(await searchWeb(o.ownerCtx, 'ab', provider)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('returns wrapped data with sources, caps the searches, and bills every search in ai_runs', async () => {
    const o = await makeOrg();
    const provider = new FakeProvider({ search: [answer()] });
    const r = await searchWeb(o.ownerCtx, 'kafe di Bandung yang butuh aplikasi', provider);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toContain('Ada tiga kafe');
    expect(r.answer).not.toBe('Ada tiga kafe: A, B, C.'); // wrapped as data from outside
    expect(r.sources).toEqual([{ url: 'https://contoh.id/kafe', title: 'Daftar kafe' }]);
    expect(provider.searchCalls[0]).toMatchObject({ maxSearches: 3 });
    expect(provider.searchCalls[0].query).toContain('kafe di Bandung');
    const [run] = await db.select().from(aiRuns).where(and(eq(aiRuns.orgId, o.orgId), eq(aiRuns.feature, 'agent')));
    expect(run.status).toBe('ok');
    expect(Number(run.costMicroUsd)).toBeGreaterThanOrEqual(webSearchCostMicroUsd(2));
  });

  it('says so when the model fails, without a made-up answer', async () => {
    const o = await makeOrg();
    const { AiProviderError } = await import('../../../ai/errors');
    const provider = new FakeProvider({ search: [new AiProviderError('empty', 'no answer')] });
    expect(await searchWeb(o.ownerCtx, 'pesaing aplikasi sewa alat', provider)).toMatchObject({ ok: false, reason: 'ai' });
  });
});
