import { describe, expect, it } from 'vitest';
import { FakeProvider, callTools, fail, say, sayJson } from '../fake-provider';
import type { ChatRequest } from '../types';

const request: ChatRequest = { messages: [{ role: 'user', content: 'hi' }], effort: 'low', maxTokens: 1000 };

describe('FakeProvider', () => {
  it('answers in order and records every request', async () => {
    const fake = new FakeProvider({ chat: [say('one'), callTools([{ name: 'list_overdue_invoices', args: { limit: 5 } }]), sayJson({ ok: true })] });
    expect((await fake.chat(request)).text).toBe('one');
    const tools = await fake.chat(request);
    expect(tools.toolCalls).toEqual([{ id: 'call_1', name: 'list_overdue_invoices', argumentsJson: '{"limit":5}' }]);
    expect(tools.finishReason).toBe('tool_calls');
    expect((await fake.chat(request)).json).toEqual({ ok: true });
    expect(fake.chatCalls).toHaveLength(3);
  });

  it('throws a scripted failure and a clear error when the script runs out', async () => {
    const fake = new FakeProvider({ chat: [fail('rate_limited')] });
    await expect(fake.chat(request)).rejects.toMatchObject({ kind: 'rate_limited' });
    await expect(fake.chat(request)).rejects.toThrow(/no scripted answer left for chat/);
    await expect(fake.generateImage({ prompt: 'x' })).rejects.toThrow(/generateImage/);
  });
});
