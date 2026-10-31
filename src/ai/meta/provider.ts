import { z } from 'zod';
import { AiProviderError } from '../errors';
import { isContributorModel } from '../pricing';
import type { AiProvider } from '../provider';
import type {
  ImageEditRequest,
  InputImage,
  CallMeta,
  ChatMessage,
  ChatRequest,
  ChatResult,
  FinishReason,
  GeneratedImage,
  ImageRequest,
  ImageResult,
  ToolCall,
  TranscribeRequest,
  TranscribeResult,
  Usage,
  VideoReadRequest,
} from '../types';
import { inspectWav } from '../wav';
import { MetaHttp, type MetaHttpOptions } from './http';

/** `demo` = fake data only, so the cheaper `-contributor` models (which train on our content) are allowed (BR-M07-14). */
export type DataMode = 'demo' | 'standard';

export interface MetaProviderConfig {
  apiKey: string;
  baseUrl?: string;
  dataMode: DataMode;
  models?: { chat?: string; image?: string; transcribe?: string };
  http?: Partial<MetaHttpOptions>;
}

const DEFAULT_BASE_URL = 'https://api.meta.ai/v1';
const MIN_MAX_TOKENS = 1000;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const chatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(z.object({ id: z.string(), function: z.object({ name: z.string(), arguments: z.string() }) }))
            .nullish(),
        }),
        finish_reason: z.string().nullish(),
      }),
    )
    .min(1),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).nullish(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish(),
  }),
});

const responsesResponse = z.object({
  output: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().nullish() })).nullish() })),
  usage: z.object({ input_tokens: z.number().nullish(), output_tokens: z.number().nullish(), output_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).nullish() }).nullish(),
});

const transcribeResponse = z.object({
  transcript: z.string(),
  audioDurationMs: z.number().nullish(),
  turns: z
    .array(
      z.object({
        turnId: z.number(),
        startMs: z.number(),
        endMs: z.number(),
        transcript: z.string(),
        speaker: z.string().nullish(),
      }),
    )
    .nullish(),
});

const imageResponse = z.object({ data: z.array(z.object({ b64_json: z.string() })) });

/** The real provider. Chat goes through Chat Completions, the path proven live (docs/02 §0, D-036). */
export class MetaProvider implements AiProvider {
  private readonly http: MetaHttp;
  private readonly models: { chat: string; image: string; transcribe: string };

  constructor(private readonly config: MetaProviderConfig) {
    this.http = new MetaHttp({ apiKey: config.apiKey, baseUrl: config.baseUrl ?? DEFAULT_BASE_URL, ...config.http });
    this.models = {
      chat: config.models?.chat ?? 'muse-spark-1.3',
      image: config.models?.image ?? 'muse-image-1.0',
      transcribe: config.models?.transcribe ?? 'muse-voice-transcribe-1.0',
    };
    this.assertModelAllowed(this.models.chat);
  }

  /** Reads `MODEL_API_KEY`, `MODEL_API_BASE_URL` and `AI_DATA_MODE`. Real data is the safe default. */
  static fromEnv(env: Record<string, string | undefined>): MetaProvider {
    return new MetaProvider({
      apiKey: env.MODEL_API_KEY ?? '',
      baseUrl: env.MODEL_API_BASE_URL || undefined,
      dataMode: env.AI_DATA_MODE === 'demo' ? 'demo' : 'standard',
      models: { chat: env.AI_CHAT_MODEL || undefined },
    });
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    const model = request.model ?? this.models.chat;
    this.assertModelAllowed(model);
    if (request.maxTokens < MIN_MAX_TOKENS) {
      throw new AiProviderError('bad_request', `maxTokens must be at least ${MIN_MAX_TOKENS}: reasoning uses the same budget`);
    }
    if (request.messages.length === 0) throw new AiProviderError('bad_request', 'A chat needs at least one message');
    for (const tool of request.tools ?? []) {
      if (!TOOL_NAME.test(tool.name)) throw new AiProviderError('bad_request', `Tool name "${tool.name}" is not allowed`);
    }

    const body: Record<string, unknown> = {
      model,
      messages: request.messages.map(toWireMessage),
      reasoning_effort: request.effort,
      max_completion_tokens: request.maxTokens,
    };
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    if (request.schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: request.schema.name, schema: request.schema.schema, ...(request.schema.strict ? { strict: true } : {}) },
      };
    }
    if (request.cacheKey) body.prompt_cache_key = request.cacheKey;
    if (request.safetyIdentifier) body.safety_identifier = request.safetyIdentifier.slice(0, 64);

    const { body: raw, meta } = await this.http.post<unknown>({ path: '/chat/completions', json: body });
    const parsed = chatResponse.safeParse(raw);
    if (!parsed.success) throw new AiProviderError('invalid_output', 'Chat response did not have the expected shape');

    const choice = parsed.data.choices[0];
    const usage = readUsage(parsed.data.usage);
    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, argumentsJson: c.function.arguments }));
    const text = choice.message.content ?? null;
    const finishReason = toFinishReason(choice.finish_reason);

    // A null answer is a recorded failure, never an empty reply (D-019).
    if (toolCalls.length === 0 && (text === null || text.trim() === '')) {
      const why = finishReason === 'length' ? 'the token limit was reached before the model answered' : 'the model returned no content';
      throw new AiProviderError('empty', `Chat failed: ${why}`, { usage });
    }

    let json: unknown;
    if (request.schema && toolCalls.length === 0) {
      try {
        json = JSON.parse(text ?? '');
      } catch {
        throw new AiProviderError('invalid_output', 'Structured output was not valid JSON', { usage });
      }
    }

    return { text, toolCalls, json, finishReason, usage, meta: { ...meta, model } };
  }

  /** `/responses` with an `input_video` part: the only route that actually shows the model the video. */
  async readVideo(request: VideoReadRequest): Promise<ChatResult> {
    const model = request.model ?? this.models.chat;
    this.assertModelAllowed(model);
    if (request.maxTokens < MIN_MAX_TOKENS) throw new AiProviderError('bad_request', `maxTokens must be at least ${MIN_MAX_TOKENS}: reasoning uses the same budget`);
    const body = {
      model,
      max_output_tokens: request.maxTokens,
      input: [{ role: 'user', content: [{ type: 'input_text', text: request.instruction }, { type: 'input_video', video_url: `data:${request.video.mime};base64,${Buffer.from(request.video.bytes).toString('base64')}` }] }],
    };
    const { body: raw, meta } = await this.http.post<unknown>({ path: '/responses', json: body });
    const parsed = responsesResponse.safeParse(raw);
    if (!parsed.success) throw new AiProviderError('invalid_output', 'Video response did not have the expected shape');
    const usage: Usage = { inputTokens: parsed.data.usage?.input_tokens ?? 0, outputTokens: parsed.data.usage?.output_tokens ?? 0, cachedTokens: 0, reasoningTokens: parsed.data.usage?.output_tokens_details?.reasoning_tokens ?? 0 };
    const text = parsed.data.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('')
      .trim();
    if (!text) throw new AiProviderError('empty', 'The model returned no text about the video', { usage });
    return { text, toolCalls: [], finishReason: 'stop', usage, meta: { ...meta, model } };
  }

  async transcribe(request: TranscribeRequest): Promise<TranscribeResult> {
    const wav = inspectWav(request.wav);
    const settings: Record<string, unknown> = {
      model: this.models.transcribe,
      mode: request.mode ?? 'DIARIZATION',
      audioEncoding: 'WAV',
    };
    const keywords = (request.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    if (keywords.length) settings.keywords = keywords;
    if (request.languageBias?.length) settings.languageBias = request.languageBias;

    const form = new FormData();
    form.append('request', new Blob([JSON.stringify(settings)], { type: 'application/json' }));
    form.append('audio', new Blob([request.wav as BlobPart], { type: 'audio/wav' }), 'audio.wav');

    // Meta asks for a single retry on a processing failure.
    const { body: raw, meta } = await this.http.post<unknown>({ path: '/asr/transcribe', form, maxAttempts: 2 });
    const parsed = transcribeResponse.safeParse(raw);
    if (!parsed.success) throw new AiProviderError('invalid_output', 'Transcription response did not have the expected shape');
    return {
      transcript: parsed.data.transcript,
      durationMs: parsed.data.audioDurationMs ?? wav.durationMs,
      turns: (parsed.data.turns ?? []).map((t) => ({ ...t, speaker: t.speaker ?? undefined })),
      meta: { ...meta, model: this.models.transcribe },
    };
  }

  async generateImage(request: ImageRequest): Promise<ImageResult> {
    return this.makeImages('/images/generations', request);
  }

  /** `/images/edits`: the pictures are references (a logo to keep, a screenshot to show), 1 to 10, in the order the prompt names them. */
  async editImage(request: ImageEditRequest): Promise<ImageResult> {
    if (request.images.length < 1 || request.images.length > 10) throw new AiProviderError('bad_request', 'An edit needs 1 to 10 pictures');
    return this.makeImages('/images/edits', request, request.images.map((img) => ({ image_url: toDataUri(img) })));
  }

  private async makeImages(path: '/images/generations' | '/images/edits', request: ImageRequest, references?: Array<{ image_url: string }>): Promise<ImageResult> {
    const prompt = request.prompt.trim();
    if (!prompt) throw new AiProviderError('bad_request', 'An image needs a prompt');
    const n = request.n ?? 1;
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new AiProviderError('bad_request', 'n must be between 1 and 10');
    if (request.size !== undefined) assertSize(request.size);

    const grounding = request.grounding === true;
    const body: Record<string, unknown> = {
      model: this.models.image,
      prompt,
      n,
      response_format: 'b64_json',
      output_format: 'webp',
      reasoning_strength: request.lowEffort ? 'low' : 'high',
      tool_enablement: { enable_image_search: grounding, enable_web_search: grounding, enable_shell: grounding },
    };
    if (references) body.images = references;
    if (request.size) body.size = request.size;
    if (request.safetyIdentifier) body.user = request.safetyIdentifier.slice(0, 64);

    // Muse Image says a plain 500 is not retryable, so only 429 and 503 are retried.
    const { body: raw, meta } = await this.http.post<unknown>({ path, json: body, retry500: false });
    const parsed = imageResponse.safeParse(raw);
    if (!parsed.success) throw new AiProviderError('invalid_output', 'Image response did not have the expected shape');
    if (parsed.data.data.length === 0) throw new AiProviderError('empty', 'The model returned no image');

    const images: GeneratedImage[] = parsed.data.data.map((item) => {
      const bytes = new Uint8Array(Buffer.from(item.b64_json, 'base64'));
      const isWebp = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
      if (!isWebp) throw new AiProviderError('invalid_output', 'Image data is not a WebP file');
      return { bytes, mime: 'image/webp' };
    });
    return { images, meta: { ...meta, model: this.models.image } satisfies CallMeta };
  }

  private assertModelAllowed(model: string): void {
    if (isContributorModel(model) && this.config.dataMode !== 'demo') {
      throw new AiProviderError('config', `Model "${model}" trains on our content and is only allowed with AI_DATA_MODE=demo`);
    }
  }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content ?? '',
      ...(message.toolCalls?.length
        ? { tool_calls: message.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.argumentsJson } })) }
        : {}),
    };
  }
  if (message.role === 'user' && (message.images?.length || message.files?.length)) {
    // Chat Completions takes pictures as `image_url` parts beside the text (a data URI keeps them off the network).
    return {
      role: 'user',
      content: [
        { type: 'text', text: message.content },
        ...(message.images ?? []).map((img) => ({ type: 'image_url', image_url: { url: toDataUri(img) } })),
        // A PDF is a `file` part with inline base64 (the one document form Chat Completions documents).
        ...(message.files ?? []).map((f) => ({ type: 'file', file: { filename: f.name, file_data: `data:${f.mime};base64,${Buffer.from(f.bytes).toString('base64')}` } })),
      ],
    };
  }
  return { role: message.role, content: message.content };
}

const toDataUri = (img: InputImage) => `data:${img.mime};base64,${Buffer.from(img.bytes).toString('base64')}`;

function readUsage(usage: z.infer<typeof chatResponse>['usage']): Usage {
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
  };
}

function toFinishReason(reason: string | null | undefined): FinishReason {
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'length') return reason;
  return 'other';
}

function assertSize(size: string): void {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size);
  if (!match) throw new AiProviderError('bad_request', 'size must look like 1024x1024');
  const [w, h] = [Number(match[1]), Number(match[2])];
  if (Math.max(w, h) / Math.min(w, h) > 16) throw new AiProviderError('bad_request', 'size aspect ratio cannot exceed 16:1');
}
