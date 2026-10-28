/**
 * Manual live check of MetaProvider against the real Meta Model API (BR-M07-16: real calls are manual and few).
 *
 *   pnpm ai:smoke                    chat, tool call and structured output (about a cent)
 *   pnpm ai:smoke --image            also one image ($0.01)
 *   pnpm ai:smoke --stt file.wav     also speech-to-text on a mono 16-bit WAV (convert with ffmpeg first)
 *
 * Prompts are tiny and contain no customer data. The key is read from the environment and never printed.
 */
import { readFileSync } from 'node:fs';
import { AiProviderError } from '../src/ai/errors';
import { MetaProvider } from '../src/ai/meta/provider';
import { chatCostMicroUsd } from '../src/ai/pricing';
import type { ChatMessage } from '../src/ai/types';

const args = process.argv.slice(2);
const provider = MetaProvider.fromEnv({ MODEL_API_KEY: process.env.MODEL_API_KEY, MODEL_API_BASE_URL: process.env.MODEL_API_BASE_URL, AI_DATA_MODE: process.env.AI_DATA_MODE, AI_CHAT_MODEL: process.env.AI_CHAT_MODEL });

let failures = 0;
let totalMicro = 0;

async function check(name: string, fn: () => Promise<string>) {
  const started = Date.now();
  try {
    const detail = await fn();
    console.log(`PASS  ${name} (${Date.now() - started} ms)  ${detail}`);
  } catch (error) {
    failures += 1;
    const detail = error instanceof AiProviderError ? `${error.kind}: ${error.message}` : String(error);
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

const money = (micro: number) => `$${(micro / 1_000_000).toFixed(5)}`;

await check('chat: plain answer', async () => {
  const r = await provider.chat({ messages: [{ role: 'user', content: 'Balas dengan satu kata saja: siap' }], effort: 'low', maxTokens: 1000 });
  if (!r.text?.trim()) throw new Error('empty text');
  const cost = chatCostMicroUsd(r.meta.model, r.usage);
  totalMicro += cost;
  return `"${r.text.trim().slice(0, 40)}" tokens in/out ${r.usage.inputTokens}/${r.usage.outputTokens} (reasoning ${r.usage.reasoningTokens}, cached ${r.usage.cachedTokens}) ${money(cost)} ratelimit headers: ${Object.keys(r.meta.rateLimit).length}, request id: ${r.meta.requestId ?? 'none'}`;
});

await check('chat: tool call and tool result round trip', async () => {
  const tools = [{ name: 'get_invoice_total', description: 'Returns the total in Rupiah of one invoice by its number.', parameters: { type: 'object', properties: { invoiceNumber: { type: 'string' } }, required: ['invoiceNumber'], additionalProperties: false } }];
  const messages: ChatMessage[] = [{ role: 'user', content: 'Berapa total invoice INV-1? Gunakan tool yang tersedia.' }];
  const first = await provider.chat({ messages, tools, effort: 'low', maxTokens: 1500 });
  if (first.toolCalls.length !== 1 || first.toolCalls[0].name !== 'get_invoice_total') throw new Error(`expected one get_invoice_total call, got ${JSON.stringify(first.toolCalls)} finish=${first.finishReason}`);
  const parsedArgs = JSON.parse(first.toolCalls[0].argumentsJson) as { invoiceNumber?: string };
  if (!parsedArgs.invoiceNumber) throw new Error('arguments missing invoiceNumber');
  messages.push({ role: 'assistant', content: first.text, toolCalls: first.toolCalls });
  messages.push({ role: 'tool', toolCallId: first.toolCalls[0].id, content: JSON.stringify({ total: 12500000 }) });
  const second = await provider.chat({ messages, tools, effort: 'low', maxTokens: 1500 });
  if (!second.text) throw new Error('no final answer after the tool result');
  const mentions = /12\.?,?500\.?,?000/.test(second.text);
  totalMicro += chatCostMicroUsd(first.meta.model, first.usage) + chatCostMicroUsd(second.meta.model, second.usage);
  return `args ${first.toolCalls[0].argumentsJson} -> "${second.text.trim().slice(0, 70)}" (uses tool number: ${mentions})`;
});

await check('chat: structured output (response_format)', async () => {
  const r = await provider.chat({
    messages: [{ role: 'user', content: 'Ekstrak: "Budi dari Boyolali butuh website, anggaran 15 juta rupiah, 6 minggu."' }],
    schema: { name: 'Lead', strict: true, schema: { type: 'object', properties: { name: { type: 'string' }, city: { type: 'string' }, budgetIdr: { type: 'integer' }, weeks: { type: 'integer' } }, required: ['name', 'city', 'budgetIdr', 'weeks'], additionalProperties: false } },
    effort: 'low',
    maxTokens: 1500,
  });
  totalMicro += chatCostMicroUsd(r.meta.model, r.usage);
  const json = r.json as { name?: string; city?: string; budgetIdr?: number; weeks?: number };
  if (json?.name !== 'Budi' || json.weeks !== 6) throw new Error(`unexpected JSON ${JSON.stringify(json)}`);
  return JSON.stringify(json);
});

await check('chat: refuses maxTokens below 1000 before sending', async () => {
  try {
    await provider.chat({ messages: [{ role: 'user', content: 'x' }], effort: 'low', maxTokens: 100 });
  } catch (error) {
    if (error instanceof AiProviderError && error.kind === 'bad_request') return 'rejected locally, no request made';
    throw error;
  }
  throw new Error('should have been rejected');
});

if (args.includes('--image')) {
  await check('image: one WebP with grounding off', async () => {
    const r = await provider.generateImage({ prompt: 'Poster sederhana bertema kopi, warna hangat, tanpa teks', size: '1024x1024', lowEffort: true });
    totalMicro += 10_000;
    return `${r.images.length} image(s), ${r.images[0].bytes.length} bytes, ${r.images[0].mime}`;
  });
}

const sttIndex = args.indexOf('--stt');
if (sttIndex >= 0) {
  const file = args[sttIndex + 1];
  await check(`stt: ${file}`, async () => {
    const r = await provider.transcribe({ wav: new Uint8Array(readFileSync(file)), mode: 'DIARIZATION' });
    return `${r.durationMs} ms, ${r.turns.length} turn(s): "${r.transcript.slice(0, 80)}"`;
  });
}

console.log(`\n${failures === 0 ? 'All checks passed' : `${failures} check(s) FAILED`}. Estimated spend (chat/image only): ${money(totalMicro)}`);
process.exit(failures === 0 ? 0 : 1);
