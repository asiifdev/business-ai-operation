import { describe, expect, it } from 'vitest';
import { chatCostMicroUsd } from '../pricing';
import { MetaProvider, type MetaProviderConfig } from '../meta/provider';
import type { ChatRequest } from '../types';
import { apiError, chatOk, fastHttp, json, stubFetch, wav, webpB64 } from './helpers';

function provider(replies: Parameters<typeof stubFetch>[0], config: Partial<MetaProviderConfig> = {}) {
  const stub = stubFetch(replies);
  const { options } = fastHttp(stub.fetch);
  const p = new MetaProvider({ apiKey: 'LLM_1_key', dataMode: 'standard', http: options, ...config });
  return { p, stub };
}

const base: ChatRequest = { messages: [{ role: 'developer', content: 'Be brief.' }, { role: 'user', content: 'Halo' }], effort: 'low', maxTokens: 1500 };

describe('MetaProvider.chat', () => {
  it('sends the Chat Completions fields Meta documents and nothing it rejects', async () => {
    const { p, stub } = provider([json(chatOk('Halo!'))]);
    await p.chat({ ...base, cacheKey: 'agent-v1', safetyIdentifier: 'hash123' });
    const body = stub.sent[0].body as Record<string, unknown>;
    expect(stub.sent[0].url).toBe('https://api.meta.ai/v1/chat/completions');
    expect(body).toMatchObject({
      model: 'muse-spark-1.3',
      reasoning_effort: 'low',
      max_completion_tokens: 1500,
      prompt_cache_key: 'agent-v1',
      safety_identifier: 'hash123',
    });
    expect((body.messages as Array<{ role: string }>)[0].role).toBe('developer');
    for (const rejected of ['max_tokens', 'temperature', 'top_p', 'stop', 'logprobs', 'n', 'seed', 'text']) expect(body).not.toHaveProperty(rejected);
  });

  it('nests tools under `function` and maps assistant tool calls and tool results back', async () => {
    const { p, stub } = provider([json(chatOk('ok'))]);
    await p.chat({
      ...base,
      tools: [{ name: 'get_invoice', description: 'Read one invoice', parameters: { type: 'object', properties: {} } }],
      messages: [
        { role: 'user', content: 'cek' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'call_9', name: 'get_invoice', argumentsJson: '{"id":"inv1"}' }] },
        { role: 'tool', toolCallId: 'call_9', content: '{"total":1000}' },
      ],
    });
    const body = stub.sent[0].body as { tools: unknown[]; messages: Array<Record<string, unknown>> };
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'get_invoice', description: 'Read one invoice', parameters: { type: 'object', properties: {} } } });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_invoice', arguments: '{"id":"inv1"}' } }] });
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call_9', content: '{"total":1000}' });
  });

  it('uses response_format for structured output and parses the JSON string', async () => {
    const { p, stub } = provider([json(chatOk('{"city":"Boyolali"}'))]);
    const result = await p.chat({ ...base, schema: { name: 'Place', schema: { type: 'object' }, strict: true } });
    expect((stub.sent[0].body as Record<string, unknown>).response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'Place', schema: { type: 'object' }, strict: true },
    });
    expect(result.json).toEqual({ city: 'Boyolali' });
  });

  it('reads usage, cached and reasoning tokens, and the cost follows from them', async () => {
    const { p } = provider([json(chatOk('x', {}, { prompt_tokens: 1000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens_details: { reasoning_tokens: 300 } }))]);
    const result = await p.chat(base);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 500, cachedTokens: 600, reasoningTokens: 300 });
    expect(chatCostMicroUsd(result.meta.model, result.usage)).toBe(Math.ceil(400 * 1.25 + 600 * 0.15 + 500 * 4.25));
  });

  it('returns tool calls untouched for the registry to validate', async () => {
    const calls = [{ id: 'call_1', type: 'function', function: { name: 'list_overdue_invoices', arguments: '{not json' } }];
    const { p } = provider([json({ ...chatOk(null, { tool_calls: calls }), choices: [{ message: { content: null, tool_calls: calls }, finish_reason: 'tool_calls' }] })]);
    const result = await p.chat(base);
    expect(result.finishReason).toBe('tool_calls');
    expect(result.toolCalls[0]).toEqual({ id: 'call_1', name: 'list_overdue_invoices', argumentsJson: '{not json' });
  });

  it('treats a null answer as a recorded failure that still carries its usage (D-019)', async () => {
    const reply = { choices: [{ message: { content: null }, finish_reason: 'length' }], usage: { prompt_tokens: 50, completion_tokens: 38 } };
    const { p } = provider([json(reply)]);
    const error = await p.chat(base).catch((e) => e);
    expect(error).toMatchObject({ kind: 'empty', details: { usage: { inputTokens: 50, outputTokens: 38 } } });
    expect(error.message).toMatch(/token limit/);
  });

  it('fails honestly when structured output is not valid JSON', async () => {
    const { p } = provider([json(chatOk('not json'))]);
    await expect(p.chat({ ...base, schema: { name: 'X', schema: {} } })).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it('refuses requests that would fail or waste money before sending anything', async () => {
    const { p, stub } = provider([json(chatOk('x'))]);
    await expect(p.chat({ ...base, maxTokens: 999 })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(p.chat({ ...base, messages: [] })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(p.chat({ ...base, tools: [{ name: 'browser.search', description: '', parameters: {} }] })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(stub.sent).toHaveLength(0);
  });

  it('only allows a contributor model with demo data (BR-M07-14)', async () => {
    expect(() => new MetaProvider({ apiKey: 'k', dataMode: 'standard', models: { chat: 'muse-spark-1.3-contributor' } })).toThrow(/AI_DATA_MODE=demo/);
    const { p, stub } = provider([json(chatOk('x'))]);
    await expect(p.chat({ ...base, model: 'muse-spark-1.3-contributor' })).rejects.toMatchObject({ kind: 'config' });
    expect(stub.sent).toHaveLength(0);
    expect(() => new MetaProvider({ apiKey: 'k', dataMode: 'demo', models: { chat: 'muse-spark-1.3-contributor' } })).not.toThrow();
  });

  it('defaults to standard data mode when the environment says nothing', () => {
    expect(() => MetaProvider.fromEnv({ MODEL_API_KEY: 'k', AI_CHAT_MODEL: 'muse-spark-1.3-contributor' })).toThrow();
    expect(() => MetaProvider.fromEnv({ MODEL_API_KEY: 'k', AI_DATA_MODE: 'demo', AI_CHAT_MODEL: 'muse-spark-1.3-contributor' })).not.toThrow();
    expect(() => MetaProvider.fromEnv({})).toThrow(/MODEL_API_KEY/);
  });
});

describe('MetaProvider.transcribe', () => {
  it('uploads WAV as multipart with the documented settings', async () => {
    const { p, stub } = provider([json({ transcript: 'Halo dunia', audioDurationMs: 2000, turns: [{ turnId: 1, startMs: 0, endMs: 2000, transcript: 'Halo dunia', speaker: 'A' }] })]);
    const result = await p.transcribe({ wav: wav({ seconds: 2 }), keywords: [' Orbyte ', ''], languageBias: ['Indonesian'] });
    expect(stub.sent[0].url).toBe('https://api.meta.ai/v1/asr/transcribe');
    expect(stub.sent[0].headers).not.toHaveProperty('Content-Type');
    const settings = JSON.parse(await (stub.sent[0].form?.get('request') as Blob).text());
    expect(settings).toEqual({ model: 'muse-voice-transcribe-1.0', mode: 'DIARIZATION', audioEncoding: 'WAV', keywords: ['Orbyte'], languageBias: ['Indonesian'] });
    expect(stub.sent[0].form?.get('audio')).toBeInstanceOf(Blob);
    expect(result).toMatchObject({ transcript: 'Halo dunia', durationMs: 2000, turns: [{ speaker: 'A' }] });
  });

  it('rejects the wrong audio before spending a request', async () => {
    const { p, stub } = provider([json({ transcript: '' })]);
    await expect(p.transcribe({ wav: wav({ channels: 2 }) })).rejects.toMatchObject({ kind: 'bad_request' });
    expect(stub.sent).toHaveLength(0);
  });

  it('retries a processing failure only once', async () => {
    const { p, stub } = provider([apiError(500, 'budget'), apiError(500, 'budget'), json({ transcript: 'x' })]);
    await expect(p.transcribe({ wav: wav() })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(stub.sent).toHaveLength(2);
  });
});

describe('MetaProvider.generateImage', () => {
  it('turns grounding off by default and decodes WebP bytes', async () => {
    const { p, stub } = provider([json({ data: [{ b64_json: webpB64() }] })]);
    const result = await p.generateImage({ prompt: 'Poster produk', size: '1024x1536' });
    expect(stub.sent[0].url).toBe('https://api.meta.ai/v1/images/generations');
    expect(stub.sent[0].body).toMatchObject({
      model: 'muse-image-1.0',
      n: 1,
      size: '1024x1536',
      response_format: 'b64_json',
      output_format: 'webp',
      reasoning_strength: 'high',
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    });
    expect(stub.sent[0].body).not.toHaveProperty('moderation');
    expect(result.images[0]).toMatchObject({ mime: 'image/webp' });
    expect(result.images[0].bytes.length).toBe(16);
  });

  it('turns grounding on only when asked, and uses the cheaper pass for drafts', async () => {
    const { p, stub } = provider([json({ data: [{ b64_json: webpB64() }] })]);
    await p.generateImage({ prompt: 'x', grounding: true, lowEffort: true });
    expect(stub.sent[0].body).toMatchObject({ reasoning_strength: 'low', tool_enablement: { enable_web_search: true } });
  });

  it('validates input, does not retry a plain 500, and separates a policy block', async () => {
    const { p, stub } = provider([apiError(500, 'boom'), apiError(400, 'no', 'content_policy_violation')]);
    await expect(p.generateImage({ prompt: '  ' })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(p.generateImage({ prompt: 'x', n: 11 })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(p.generateImage({ prompt: 'x', size: '1000x10' })).rejects.toMatchObject({ kind: 'bad_request' });
    await expect(p.generateImage({ prompt: 'x' })).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(p.generateImage({ prompt: 'x' })).rejects.toMatchObject({ kind: 'content_policy' });
    expect(stub.sent).toHaveLength(2);
  });

  it('rejects data that is not a WebP image', async () => {
    const { p } = provider([json({ data: [{ b64_json: Buffer.from('not an image at all').toString('base64') }] })]);
    await expect(p.generateImage({ prompt: 'x' })).rejects.toMatchObject({ kind: 'invalid_output' });
  });
});
