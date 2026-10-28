import { describe, expect, it } from 'vitest';
import { AiProviderError } from '../errors';
import { MetaHttp } from '../meta/http';
import { apiError, fastHttp, json, stubFetch } from './helpers';

function client(replies: Parameters<typeof stubFetch>[0], overrides = {}) {
  const stub = stubFetch(replies);
  const { options, waits } = fastHttp(stub.fetch, overrides);
  return { http: new MetaHttp({ apiKey: 'LLM_1_secret-value', baseUrl: 'https://api.test/v1/', ...options }), stub, waits };
}

describe('MetaHttp', () => {
  it('sends the key only as a Bearer header and joins the base url cleanly', async () => {
    const { http, stub } = client([json({ ok: true })]);
    await http.post({ path: '/chat/completions', json: { a: 1 } });
    expect(stub.sent[0].url).toBe('https://api.test/v1/chat/completions');
    expect(stub.sent[0].headers.Authorization).toBe('Bearer LLM_1_secret-value');
    expect(JSON.stringify(stub.sent[0].body)).not.toContain('secret-value');
  });

  it('retries 429, waiting at least as long as Retry-After', async () => {
    const { http, waits, stub } = client([apiError(429, 'slow down', 'rate_limit_exceeded', { 'retry-after': '15' }), json({ done: 1 })]);
    const result = await http.post<{ done: number }>({ path: '/x' });
    expect(result.body.done).toBe(1);
    expect(result.meta.attempts).toBe(2);
    expect(stub.sent).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(15_000);
  });

  it('backs off exponentially without a Retry-After header', async () => {
    const { http, waits } = client([apiError(503, 'down'), apiError(503, 'down'), json({})], { baseDelayMs: 100 });
    await http.post({ path: '/x' });
    expect(waits).toEqual([100, 200]);
  });

  it('retries a 500 for text models but not when the caller says it is not retryable (images)', async () => {
    const retried = client([apiError(500, 'oops'), json({})]);
    await retried.http.post({ path: '/x' });
    expect(retried.stub.sent).toHaveLength(2);

    const once = client([apiError(500, 'oops'), json({})]);
    await expect(once.http.post({ path: '/x', retry500: false })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(once.stub.sent).toHaveLength(1);
  });

  it.each([
    [400, 'bad_request'],
    [401, 'auth'],
    [402, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [413, 'too_large'],
    [504, 'timeout'],
  ])('does not retry %i and reports it as %s', async (status, kind) => {
    const { http, stub } = client([apiError(status, 'nope'), json({})]);
    await expect(http.post({ path: '/x' })).rejects.toMatchObject({ kind, details: { status } });
    expect(stub.sent).toHaveLength(1);
  });

  it('separates a content-policy block from an ordinary bad request', async () => {
    const { http } = client([apiError(400, 'blocked', 'content_policy_violation')]);
    await expect(http.post({ path: '/x' })).rejects.toMatchObject({ kind: 'content_policy' });
  });

  it('gives up after the allowed attempts and reports the last error', async () => {
    const { http, stub } = client([apiError(429, 'a'), apiError(429, 'b'), apiError(429, 'c')], { maxAttempts: 3 });
    await expect(http.post({ path: '/x' })).rejects.toMatchObject({ kind: 'rate_limited' });
    expect(stub.sent).toHaveLength(3);
  });

  it('hands a very long Retry-After back to the caller instead of sleeping through it', async () => {
    const { http, waits, stub } = client([apiError(503, 'busy', 'service_overloaded', { 'retry-after': '600' })], { maxWaitMs: 90_000 });
    await expect(http.post({ path: '/x' })).rejects.toMatchObject({ kind: 'unavailable', details: { retryAfterMs: 600_000 } });
    expect(waits).toEqual([]);
    expect(stub.sent).toHaveLength(1);
  });

  it('retries a network failure, and a per-request attempt limit wins over the default', async () => {
    const { http, stub } = client([new TypeError('fetch failed'), new TypeError('fetch failed'), json({})]);
    await expect(http.post({ path: '/x', maxAttempts: 2 })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(stub.sent).toHaveLength(2);
  });

  it('turns a timeout into a timeout error without retrying', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { http, stub } = client([abort, json({})]);
    await expect(http.post({ path: '/x' })).rejects.toMatchObject({ kind: 'timeout' });
    expect(stub.sent).toHaveLength(1);
  });

  it('keeps the key out of error messages and reads rate-limit and request-id headers', async () => {
    const ok = client([json({ a: 1 }, 200, { 'x-ratelimit-remaining-tokens': '999', 'x-request-id': 'req-7' })]);
    const result = await ok.http.post({ path: '/x' });
    expect(result.meta.rateLimit).toEqual({ 'x-ratelimit-remaining-tokens': '999' });
    expect(result.meta.requestId).toBe('req-7');

    const bad = client([apiError(401, 'Unauthorized', 'invalid_api_key')]);
    const error = await bad.http.post({ path: '/x' }).catch((e: AiProviderError) => e);
    expect(String((error as Error).message)).not.toContain('secret-value');
  });

  it('copes with an empty 404 body and a plain-text error', async () => {
    const { http } = client([new Response('', { status: 404 })]);
    await expect(http.post({ path: '/typo' })).rejects.toMatchObject({ kind: 'not_found' });
    const text = client([new Response('Bad order value', { status: 400 })]);
    await expect(text.http.post({ path: '/x' })).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('refuses to start without a key', () => {
    expect(() => new MetaHttp({ apiKey: '', baseUrl: 'https://api.test/v1' })).toThrow(/MODEL_API_KEY/);
  });
});
