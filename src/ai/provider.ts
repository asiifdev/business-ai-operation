import type { ChatRequest, ChatResult, ImageEditRequest, ImageRequest, ImageResult, TranscribeRequest, TranscribeResult } from './types';

/**
 * The only door to a model (BR-M07-01). `MetaProvider` is the real one, `FakeProvider` runs every test without a
 * network (BR-M07-16). Anything else lives behind the same four methods.
 */
export interface AiProvider {
  chat(request: ChatRequest): Promise<ChatResult>;
  transcribe(request: TranscribeRequest): Promise<TranscribeResult>;
  generateImage(request: ImageRequest): Promise<ImageResult>;
  /** Edits or composes from reference pictures such as a logo and a screenshot (`/images/edits`). */
  editImage(request: ImageEditRequest): Promise<ImageResult>;
}
