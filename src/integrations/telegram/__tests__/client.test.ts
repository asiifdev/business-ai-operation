import { describe, expect, it } from 'vitest';
import { TelegramClient } from '../client';
import { TelegramError } from '../errors';

const TOKEN = '123456:SECRET-token-value';

interface Sent { url: string; body: Record<string, unknown> | undefined; form?: FormData; method?: string }

function setup(replies: Array<Response | Error>, options: { maxAttempts?: number; maxWaitMs?: number } = {}) {
  const sent: Sent[] = [];
  const waits: number[] = [];
  const queue = [...replies];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, form: init?.body instanceof FormData ? init.body : undefined });
    const next = queue.shift();
    if (!next) throw new Error('no reply left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  const client = new TelegramClient({ token: TOKEN, fetch: fetchStub, sleep: async (ms) => void waits.push(ms), random: () => 0, ...options });
  return { client, sent, waits };
}

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const fail = (code: number, description: string, parameters?: Record<string, unknown>) =>
  new Response(JSON.stringify({ ok: false, error_code: code, description, parameters }), { status: code });

describe('TelegramClient', () => {
  it('posts JSON to the method url and drops undefined fields', async () => {
    const { client, sent } = setup([ok({ message_id: 5 })]);
    const result = await client.sendMessage({ chatId: 42, text: 'Halo', parseMode: 'HTML' });
    expect(result.message_id).toBe(5);
    expect(sent[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(sent[0].body).toEqual({ chat_id: 42, text: 'Halo', parse_mode: 'HTML' });
  });

  it('waits for retry_after on flood control and then succeeds', async () => {
    const { client, waits, sent } = setup([fail(429, 'Too Many Requests: retry after 7', { retry_after: 7 }), ok(true)]);
    await client.answerCallbackQuery({ id: 'cb1' });
    expect(sent).toHaveLength(2);
    expect(waits[0]).toBeGreaterThanOrEqual(7000);
  });

  it('hands a very long flood wait back instead of sleeping through it', async () => {
    const { client, waits } = setup([fail(429, 'slow', { retry_after: 600 })], { maxWaitMs: 30_000 });
    await expect(client.sendMessage({ chatId: 1, text: 'x' })).rejects.toMatchObject({ kind: 'rate_limited', details: { retryAfterMs: 600_000 } });
    expect(waits).toEqual([]);
  });

  it.each([
    [400, 'bad_request'],
    [401, 'auth'],
    [403, 'blocked'],
    [404, 'not_found'],
  ])('does not retry %i and reports %s', async (code, kind) => {
    const { client, sent } = setup([fail(code, 'nope'), ok(true)]);
    await expect(client.getMe()).rejects.toMatchObject({ kind });
    expect(sent).toHaveLength(1);
  });

  it('retries a 5xx and a network failure', async () => {
    const { client, sent } = setup([fail(502, 'bad gateway'), new TypeError('fetch failed'), ok({ id: 1 })]);
    await expect(client.getMe()).resolves.toEqual({ id: 1 });
    expect(sent).toHaveLength(3);
  });

  it('never leaks the token in an error message', async () => {
    const down = setup([new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/getMe`)], { maxAttempts: 1 });
    const error = (await down.client.getMe().catch((e) => e)) as TelegramError;
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.message).not.toContain('SECRET');
    const bad = setup([fail(400, 'Bad Request: message is too long')]);
    expect(String(((await bad.client.getMe().catch((e) => e)) as Error).message)).not.toContain('SECRET');
  });

  it('refuses a message that is empty or too long, and buttons Telegram would reject, before sending', async () => {
    const { client, sent } = setup([ok({ message_id: 1 })]);
    await expect(client.sendMessage({ chatId: 1, text: '' })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(client.sendMessage({ chatId: 1, text: 'x'.repeat(4200) })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(client.sendMessage({ chatId: 1, text: 'x', replyMarkup: { inline_keyboard: [[{ text: 'A', callback_data: 'x'.repeat(65) }]] } })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(client.sendMessage({ chatId: 1, text: 'x', replyMarkup: { inline_keyboard: [[{ text: 'A' }]] } })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(client.sendMessage({ chatId: 1, text: 'x', replyMarkup: { inline_keyboard: [[{ text: 'A', callback_data: 'a', url: 'https://x.test' }]] } })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(sent).toHaveLength(0);
  });

  it('clears the keyboard when a card is edited without a new one', async () => {
    const { client, sent } = setup([ok({})]);
    await client.editMessageText({ chatId: 1, messageId: 9, text: 'Disetujui' });
    expect(sent[0].body).toMatchObject({ chat_id: 1, message_id: 9, reply_markup: { inline_keyboard: [] } });
  });

  it('limits callback answers to 200 characters', async () => {
    const { client } = setup([ok(true)]);
    await expect(client.answerCallbackQuery({ id: 'a', text: 'x'.repeat(201) })).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('downloads a file through getFile and the file url, within the size limit', async () => {
    const { client, sent } = setup([ok({ file_id: 'f', file_unique_id: 'u', file_size: 3, file_path: 'voice/a.oga' }), new Response(new Uint8Array([1, 2, 3]))]);
    const bytes = await client.downloadFile('f');
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(sent[1].url).toBe(`https://api.telegram.org/file/bot${TOKEN}/voice/a.oga`);
    expect(sent[1].method).toBe('GET');
  });

  it('refuses a file over the limit before downloading, and checks again on what arrived', async () => {
    const big = setup([ok({ file_id: 'f', file_unique_id: 'u', file_size: 30 * 1024 * 1024, file_path: 'x' })]);
    await expect(big.client.downloadFile('f')).rejects.toMatchObject({ kind: 'too_large' });
    expect(big.sent).toHaveLength(1);
    const liar = setup([ok({ file_id: 'f', file_unique_id: 'u', file_size: 1, file_path: 'x' }), new Response(new Uint8Array(10))]);
    await expect(liar.client.downloadFile('f', 5)).rejects.toMatchObject({ kind: 'too_large' });
    const none = setup([ok({ file_id: 'f', file_unique_id: 'u' })]);
    await expect(none.client.downloadFile('f')).rejects.toMatchObject({ kind: 'not_found' });
  });

  it('registers a webhook only with https and a valid secret, and lists the allowed updates', async () => {
    const { client, sent } = setup([ok(true)]);
    await expect(client.setWebhook({ url: 'http://x.test/hook', secretToken: 'abc', allowedUpdates: [] })).rejects.toMatchObject({ kind: 'config' });
    await expect(client.setWebhook({ url: 'https://x.test/hook', secretToken: 'has space', allowedUpdates: [] })).rejects.toMatchObject({ kind: 'config' });
    await client.setWebhook({ url: 'https://x.test/hook', secretToken: 'abc_DEF-123', allowedUpdates: ['message', 'callback_query'], maxConnections: 10 });
    expect(sent[0].body).toEqual({ url: 'https://x.test/hook', secret_token: 'abc_DEF-123', allowed_updates: ['message', 'callback_query'], max_connections: 10 });
  });

  it('validates command names and descriptions', async () => {
    const { client } = setup([ok(true)]);
    await expect(client.setMyCommands([{ command: 'Status', description: 'x' }])).rejects.toMatchObject({ kind: 'config' });
    await expect(client.setMyCommands([{ command: 'status', description: '' }])).rejects.toMatchObject({ kind: 'config' });
    await expect(client.setMyCommands([{ command: 'status', description: 'Ringkasan' }])).resolves.toBe(true);
  });

  it('sends a document as multipart', async () => {
    const { client, sent } = setup([ok({ message_id: 3 })]);
    await client.sendDocument({ chatId: 7, bytes: new Uint8Array([37, 80, 68, 70]), filename: 'INV-1.pdf', mime: 'application/pdf', caption: 'Invoice' });
    expect(sent[0].form?.get('chat_id')).toBe('7');
    expect((sent[0].form?.get('document') as File).name).toBe('INV-1.pdf');
  });

  it('will not start without a token', () => {
    expect(() => new TelegramClient({ token: '' })).toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});
