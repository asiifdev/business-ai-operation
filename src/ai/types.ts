/** Provider-neutral shapes for the AI layer (PRD §5). Nothing outside `src/ai` should know the wire format. */

/** Mirrors the `ai_feature` enum in the database. */
export type AiFeature = 'agent' | 'minutes' | 'transcribe' | 'image';

/** `none` is rejected by Muse Spark (HTTP 400), so it is not offered. */
export type Effort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ToolSpec {
  /** `^[a-zA-Z0-9_-]+$`: no dots, so the one-dot limit and the reserved `browser.*` names can never bite. */
  name: string;
  description: string;
  /** JSON Schema object. The registry builds it from the Zod schema of the tool. */
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text from the model. Untrusted: the registry parses and validates it (BR-M07-05). */
  argumentsJson: string;
}

/** A picture handed to the model to look at. Bytes are re-encoded by the caller; the model only reads them. */
export interface InputImage {
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
}

/** A document handed to the model to read. Chat Completions takes a PDF as a `file` part (text of the first 100 pages, pictures of the first 50). */
export interface InputFile {
  bytes: Uint8Array;
  mime: 'application/pdf';
  name: string;
}

/** A video the model watches. Only the Responses API reads it: a Chat `video_url` part is accepted and silently ignored (probed 2026-10-31). */
export interface InputVideo {
  bytes: Uint8Array;
  mime: 'video/mp4';
}

export interface VideoReadRequest {
  instruction: string;
  video: InputVideo;
  maxTokens: number;
  model?: string;
}

export type ChatMessage =
  | { role: 'developer'; content: string }
  | { role: 'user'; content: string; /** Pictures the model may look at (vision), for example to read the text on a finished poster. */ images?: InputImage[]; /** PDFs the model may read. */ files?: InputFile[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** Constrains the answer to a JSON Schema (structured output). The caller still validates with Zod. */
  schema?: { name: string; schema: Record<string, unknown>; strict?: boolean };
  /** Always explicit per feature (BR-M07-12, D-019). */
  effort: Effort;
  /** Reasoning shares this budget, so values below 1,000 are refused (BR-M07-12). */
  maxTokens: number;
  /** Overrides the provider default for this call. */
  model?: string;
  /** Stable per prompt prefix, never per user or request. */
  cacheKey?: string;
  /** Privacy-preserving end-user id (a hash), at most 64 characters. */
  safetyIdentifier?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Subset of `inputTokens` served from the prompt cache. */
  cachedTokens: number;
  /** Subset of `outputTokens` spent on reasoning. */
  reasoningTokens: number;
}

export interface CallMeta {
  model: string;
  /** Request id header, when the API sends one. Not documented, so it may be absent. */
  requestId?: string;
  /** `x-ratelimit-*` response headers, lower-cased. */
  rateLimit: Record<string, string>;
  attempts: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'other';

export interface ChatResult {
  text: string | null;
  toolCalls: ToolCall[];
  /** Parsed JSON when `schema` was given. Still untrusted until validated. */
  json?: unknown;
  finishReason: FinishReason;
  usage: Usage;
  meta: CallMeta;
}

export interface TranscribeRequest {
  /** RIFF/WAVE, mono, 16-bit PCM, 16 or 24 kHz. Convert with ffmpeg first (docs/02 §0). */
  wav: Uint8Array;
  mode?: 'PUSH_TO_TALK' | 'ENDPOINTING' | 'DIARIZATION';
  /** Product and client names only: broad biasing adds noise (docs/02 §0). */
  keywords?: string[];
  languageBias?: string[];
}

export interface TranscribeTurn {
  turnId: number;
  startMs: number;
  endMs: number;
  transcript: string;
  /** Session-scoped label such as `A`; not an identity. */
  speaker?: string;
}

export interface TranscribeResult {
  transcript: string;
  durationMs: number;
  turns: TranscribeTurn[];
  meta: CallMeta;
}

/** An edit or composition: the prompt says how to use each reference picture, in order (`/images/edits`, 1 to 10 pictures). */
export interface ImageEditRequest extends ImageRequest {
  images: InputImage[];
}

export interface ImageRequest {
  prompt: string;
  /** 1 to 10. */
  n?: number;
  /** `"WxH"`: sets the aspect ratio only, the real pixel size differs. */
  size?: string;
  /**
   * Muse Image searches the web and runs code by default and may pull in real brands and logos. Marketing Studio
   * must only use our own data, so grounding is off unless a caller asks for it.
   */
  grounding?: boolean;
  lowEffort?: boolean;
  safetyIdentifier?: string;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mime: 'image/webp';
}

export interface ImageResult {
  images: GeneratedImage[];
  meta: CallMeta;
}
