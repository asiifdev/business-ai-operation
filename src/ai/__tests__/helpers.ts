import type { MetaHttpOptions } from '../meta/http';

export interface Sent {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  form?: FormData;
}

type Reply = Response | Error;

/** A fetch that answers from a queue and remembers what was sent. Never touches the network. */
export function stubFetch(replies: Reply[]) {
  const sent: Sent[] = [];
  const queue = [...replies];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const form = init?.body instanceof FormData ? init.body : undefined;
    sent.push({ url: String(url), headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, form });
    const next = queue.shift();
    if (!next) throw new Error('stubFetch: no reply left');
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { fetch: fetchStub, sent };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function apiError(status: number, message: string, code: string | null = null, headers: Record<string, string> = {}): Response {
  return json({ error: { message, type: 'invalid_request_error', param: null, code } }, status, headers);
}

/** Http options with no real waiting and no jitter, plus a record of the delays that would have happened. */
export function fastHttp(fetchStub: typeof fetch, overrides: Partial<MetaHttpOptions> = {}) {
  const waits: number[] = [];
  const options: Partial<MetaHttpOptions> = { fetch: fetchStub, sleep: async (ms) => void waits.push(ms), random: () => 0, ...overrides };
  return { options, waits };
}

export function chatOk(content: string | null, extra: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return {
    id: 'chatcmpl-1',
    choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 40, ...usage },
  };
}

/** Minimal RIFF/WAVE bytes: PCM, `seconds` long. */
export function wav({ seconds = 1, rate = 24000, channels = 1, bits = 16 }: { seconds?: number; rate?: number; channels?: number; bits?: number } = {}): Uint8Array {
  const byteRate = (rate * channels * bits) / 8;
  const dataSize = Math.round(byteRate * seconds);
  const out = new Uint8Array(44 + dataSize);
  const view = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  return out;
}

/** Smallest bytes that pass the WebP check (RIFF....WEBP). */
export function webpB64(): string {
  const bytes = new Uint8Array(16);
  [...'RIFF'].forEach((c, i) => (bytes[i] = c.charCodeAt(0)));
  [...'WEBP'].forEach((c, i) => (bytes[8 + i] = c.charCodeAt(0)));
  return Buffer.from(bytes).toString('base64');
}
