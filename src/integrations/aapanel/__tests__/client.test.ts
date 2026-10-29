import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aapanelPing, AapanelError, panelMessage, signRequest } from '../client';

/** A local HTTP server that answers the way the real panel did on 2026-10-29: HTTP 200 and `{status:false,msg}` on refusal. */
const KEY = 'api-key-for-tests-0123456789abcdef';
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
let mode: 'ok' | 'v1' | 'ip' | 'badkey' | 'html' | 'weird' = 'ok';
const seen: Array<{ url: string; body: string }> = [];
let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url ?? '', body });
      const form = new URLSearchParams(body);
      const reply = (o: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(o));
      if (mode === 'html') return void res.writeHead(200, { 'content-type': 'text/html' }).end('<html>login</html>');
      if (mode === 'ip') return reply({ status: false, msg: `IP validation failed, your access IP is[203.0.113.9] key=${KEY}` });
      const t = form.get('request_time') ?? '';
      if (form.get('request_token') !== md5(t + md5(KEY))) return reply({ status: false, msg: 'Secret key verification failed' });
      if (mode === 'weird') return reply({ hello: 'world' });
      // v2 paths answer `{status: 0, timestamp, message}`; v1 paths answer the data itself
      if (mode === 'v1') return (req.url ?? '').startsWith('/v2/') ? res.writeHead(404).end('not found') : reply({ data: [], page: '' });
      return (req.url ?? '').startsWith('/v2/') ? reply({ status: 0, timestamp: 1, message: { data: [] } }) : reply({ data: [], page: '' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as AapanelError | null;

describe('aaPanel client', () => {
  it('signs with md5(time + md5(key)), as the official docs say', () => {
    expect(signRequest('k', 1700000000)).toEqual({ request_time: '1700000000', request_token: md5('1700000000' + md5('k')) });
  });

  it('accepts a panel that answers a correctly signed request, and sends the signature, never the key', async () => {
    mode = 'ok';
    seen.length = 0;
    expect(await aapanelPing({ url }, KEY)).toBe('ok');
    expect(seen[0].body).toContain('request_token=');
    expect(seen[0].body).not.toContain(KEY);
    expect(seen[0].url).toBe('/v2/data?action=getData');
  });

  it('works on a v2 panel, and on an old panel that only has the v1 paths', async () => {
    mode = 'ok';
    expect(await aapanelPing({ url }, KEY)).toBe('ok');
    mode = 'v1';
    seen.length = 0;
    expect(await aapanelPing({ url }, KEY)).toBe('ok');
    expect(seen.map((s) => s.url)).toEqual(['/v2/data?action=getData', '/data?action=getData']); // v2 first, then the fallback
  });

  it('does not take an answer without a positive sign for success', async () => {
    mode = 'weird';
    expect((await fail(aapanelPing({ url }, KEY)))?.kind).toBe('unexpected');
  });

  it('reads a refusal from status:false (HTTP 200), keeps the panel\'s explanation, and masks the key if it was echoed', async () => {
    mode = 'ip';
    const err = await fail(aapanelPing({ url }, KEY));
    expect(err).toBeInstanceOf(AapanelError);
    expect(err?.kind).toBe('rejected');
    expect(err?.detail).toContain('[203.0.113.9]');
    expect(err?.detail).not.toContain(KEY);
  });

  it('a wrong key is rejected; an HTML login page is not mistaken for success', async () => {
    mode = 'badkey';
    expect((await fail(aapanelPing({ url }, 'another-key-another-key-0000')))?.kind).toBe('rejected');
    mode = 'html';
    expect((await fail(aapanelPing({ url }, KEY)))?.kind).toBe('unexpected');
  });

  it('cleans the panel message', () => {
    expect(panelMessage({ msg: 'a\u0000b\n' + 'x'.repeat(500) }, 'zzz')?.length).toBeLessThanOrEqual(200);
    expect(panelMessage({ msg: 5 }, 'k')).toBeUndefined();
    expect(panelMessage({}, 'k')).toBeUndefined();
  });

  it('an unreachable panel is unreachable', async () => {
    expect((await fail(aapanelPing({ url: 'http://127.0.0.1:1' }, KEY)))?.kind).toBe('unreachable');
  });
});
