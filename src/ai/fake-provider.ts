import { AiProviderError } from './errors';
import type { AiProvider } from './provider';
import type {
  CallMeta,
  ChatRequest,
  ChatResult,
  ImageRequest,
  ImageResult,
  ToolCall,
  TranscribeRequest,
  TranscribeResult,
  Usage,
} from './types';

const META: CallMeta = { model: 'fake', rateLimit: {}, attempts: 1 };
const USAGE: Usage = { inputTokens: 100, outputTokens: 50, cachedTokens: 0, reasoningTokens: 0 };

/** A scripted chat answer: either a thrown error or a result. Build one with `say`, `callTools` or `fail`. */
export type ChatStep = ChatResult | AiProviderError;

export function say(text: string, usage: Partial<Usage> = {}): ChatResult {
  return { text, toolCalls: [], finishReason: 'stop', usage: { ...USAGE, ...usage }, meta: META };
}

export function sayJson(value: unknown, usage: Partial<Usage> = {}): ChatResult {
  return { ...say(JSON.stringify(value), usage), json: value };
}

export function callTools(calls: Array<{ name: string; args: unknown; id?: string }>, usage: Partial<Usage> = {}): ChatResult {
  const toolCalls: ToolCall[] = calls.map((c, i) => ({ id: c.id ?? `call_${i + 1}`, name: c.name, argumentsJson: typeof c.args === 'string' ? c.args : JSON.stringify(c.args) }));
  return { text: null, toolCalls, finishReason: 'tool_calls', usage: { ...USAGE, ...usage }, meta: META };
}

export function fail(kind: AiProviderError['kind'], message = 'scripted failure'): AiProviderError {
  return new AiProviderError(kind, message);
}

/**
 * Deterministic provider for tests (BR-M07-16): replies are queued in order and every request is recorded.
 * Running out of script is an error, so a test never silently talks to nothing.
 */
export class FakeProvider implements AiProvider {
  readonly chatCalls: ChatRequest[] = [];
  readonly transcribeCalls: TranscribeRequest[] = [];
  readonly imageCalls: ImageRequest[] = [];

  private readonly chatQueue: ChatStep[];
  private readonly transcribeQueue: Array<TranscribeResult | AiProviderError>;
  private readonly imageQueue: Array<ImageResult | AiProviderError>;

  constructor(script: { chat?: ChatStep[]; transcribe?: Array<TranscribeResult | AiProviderError>; image?: Array<ImageResult | AiProviderError> } = {}) {
    this.chatQueue = [...(script.chat ?? [])];
    this.transcribeQueue = [...(script.transcribe ?? [])];
    this.imageQueue = [...(script.image ?? [])];
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    this.chatCalls.push(request);
    return next(this.chatQueue, 'chat');
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    this.transcribeCalls.push(request);
    return next(this.transcribeQueue, 'transcribe');
  }

  async generateImage(request: ImageRequest): Promise<ImageResult> {
    this.imageCalls.push(request);
    return next(this.imageQueue, 'generateImage');
  }
}

function next<T>(queue: Array<T | AiProviderError>, method: string): T {
  const step = queue.shift();
  if (step === undefined) throw new Error(`FakeProvider: no scripted answer left for ${method}()`);
  if (step instanceof AiProviderError) throw step;
  return step;
}
