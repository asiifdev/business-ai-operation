import { describe, expect, it } from 'vitest';
import { EmailError } from '../provider';
import { ResendProvider } from '../resend';

const message = { to: 'a@b.id', subject: 'Hai', html: '<p>Hai</p>', text: 'Hai' };
const make = (res: () => Response) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return res();
  }) as unknown as typeof globalThis.fetch;
  return { provider: new ResendProvider({ apiKey: 're_secret', from: 'Orbyte <noreply@x.id>', fetch }), calls };
};
const outcome = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as EmailError);
const status = (code: number) => make(() => new Response('{}', { status: code })).provider.send(message, { idempotencyKey: 'k' });

describe('ResendProvider', () => {
  it('posts to /emails with the key, an idempotency key and a user agent, and returns the id', async () => {
    const { provider, calls } = make(() => Response.json({ id: 'abc' }));
    expect(await provider.send(message, { idempotencyKey: 'k1' })).toEqual({ id: 'abc' });
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer re_secret');
    expect(h['idempotency-key']).toBe('k1');
    expect(h['user-agent']).toBeTruthy();
    expect(JSON.parse(String(init.body))).toMatchObject({ from: 'Orbyte <noreply@x.id>', to: ['a@b.id'], subject: 'Hai', text: 'Hai' });
  });

  it('sorts failures: key problems, a bad message, and things worth retrying', async () => {
    expect((await outcome(status(403)))?.kind).toBe('auth');
    expect((await outcome(status(422)))?.kind).toBe('rejected');
    for (const code of [429, 409, 503]) expect((await outcome(status(code)))?.kind).toBe('transient');
    const offline = make(() => { throw new Error('offline'); }).provider.send(message, { idempotencyKey: 'k' });
    expect((await outcome(offline))?.kind).toBe('transient');
  });

  it('never puts the key into an error message', async () => {
    expect((await outcome(status(401)))?.message).not.toContain('re_secret');
  });
});
